import { vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

/**
 * In-memory stand-in for the Supabase client exported by src/lib/supabase.ts.
 *
 * src/test/setup.ts mocks that module for EVERY test file, so no test can
 * reach the network. Tests stub responses and assert on what was called:
 *
 *   supabaseMock.onRpc("register_me", { data: "patient-id" });
 *   supabaseMock.onFrom("inventory", { data: [] });
 *   supabaseMock.lastRpc("register_me")?.args
 *   supabaseMock.queries("inventory")[0].args("insert")
 *
 * Query builders record the whole chain (select, eq, order, insert, ...) and
 * only resolve when awaited, so the recorded chain is always complete.
 */

export interface MockResult {
  data?: unknown;
  error?: { message: string; code?: string; details?: string; hint?: string } | null;
  count?: number | null;
}

export interface RecordedOp {
  method: string;
  args: unknown[];
}

/** One `supabase.from(table)...` chain, as the code under test built it. */
export class RecordedQuery {
  readonly ops: RecordedOp[] = [];
  readonly table: string;

  constructor(table: string) {
    this.table = table;
  }

  /** True when the chain called `method` at least once. */
  has(method: string): boolean {
    return this.ops.some((op) => op.method === method);
  }

  /** Arguments of the first call to `method`, or undefined. */
  args(method: string): unknown[] | undefined {
    return this.ops.find((op) => op.method === method)?.args;
  }

  /** Arguments of every call to `method`, in order. */
  allArgs(method: string): unknown[][] {
    return this.ops.filter((op) => op.method === method).map((op) => op.args);
  }
}

export interface RecordedRpc {
  name: string;
  args: Record<string, unknown> | undefined;
}

type QueryResponder = MockResult | ((query: RecordedQuery) => MockResult);
type RpcResponder =
  | MockResult
  | ((args: Record<string, unknown> | undefined) => MockResult);

const toResponse = (result: MockResult) => ({
  data: result.data ?? null,
  error: result.error ?? null,
  count: result.count ?? null,
  status: result.error ? 400 : 200,
  statusText: result.error ? "Bad Request" : "OK",
});

/**
 * A thenable that records every chained call and resolves through `resolve`
 * once awaited. Any method name is accepted, like the real PostgREST builder.
 */
const createChain = (
  query: RecordedQuery,
  resolve: () => MockResult,
): unknown => {
  const chain: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) =>
            Promise.resolve()
              .then(() => toResponse(resolve()))
              .then(onFulfilled, onRejected);
        }
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => {
          query.ops.push({ method: prop, args });
          return chain;
        };
      },
    },
  );
  return chain;
};

interface StorageResponse {
  data: unknown;
  error: { message: string } | null;
}

type StorageMethod = (path: string, ...rest: unknown[]) => Promise<StorageResponse>;

const createBucket = () => {
  const empty: StorageMethod = async () => ({ data: null, error: null });
  return {
    upload: vi.fn<StorageMethod>(empty),
    createSignedUrl: vi.fn<StorageMethod>(empty),
    list: vi.fn<StorageMethod>(empty),
    remove: vi.fn<StorageMethod>(empty),
    download: vi.fn<StorageMethod>(empty),
  };
};

export type MockBucket = ReturnType<typeof createBucket>;

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;

const createSupabaseMock = () => {
  const rpcResponders = new Map<string, RpcResponder>();
  const tableResponders = new Map<string, QueryResponder[]>();
  const recordedQueries: RecordedQuery[] = [];
  const recordedRpcs: RecordedRpc[] = [];
  const buckets = new Map<string, MockBucket>();
  const authListeners = new Set<AuthListener>();
  let currentSession: Session | null = null;

  const resolveTable = (query: RecordedQuery): MockResult => {
    const queue = tableResponders.get(query.table);
    if (!queue || queue.length === 0) return { data: null, error: null };
    // Responders are consumed in order; the last one keeps answering.
    const responder = queue.length > 1 ? queue.shift()! : queue[0];
    return typeof responder === "function" ? responder(query) : responder;
  };

  const resolveRpc = (name: string, args: Record<string, unknown> | undefined) => {
    const responder = rpcResponders.get(name);
    if (!responder) return { data: null, error: null };
    return typeof responder === "function" ? responder(args) : responder;
  };

  const unsubscribe = vi.fn();

  const client = {
    from: vi.fn((table: string) => {
      const query = new RecordedQuery(table);
      recordedQueries.push(query);
      return createChain(query, () => resolveTable(query));
    }),

    rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
      recordedRpcs.push({ name, args });
      return createChain(new RecordedQuery(`rpc:${name}`), () =>
        resolveRpc(name, args),
      );
    }),

    storage: {
      from: vi.fn((bucket: string) => {
        let api = buckets.get(bucket);
        if (!api) {
          api = createBucket();
          buckets.set(bucket, api);
        }
        return api;
      }),
    },

    auth: {
      getSession: vi.fn(async () => ({
        data: { session: currentSession },
        error: null,
      })),
      onAuthStateChange: vi.fn((listener: AuthListener) => {
        authListeners.add(listener);
        return {
          data: {
            subscription: {
              id: "mock-subscription",
              callback: listener,
              unsubscribe: () => {
                authListeners.delete(listener);
                unsubscribe();
              },
            },
          },
        };
      }),
      signInWithPassword: vi.fn(async () => ({
        data: { session: null, user: null },
        error: null,
      })),
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
      verifyOtp: vi.fn(async () => ({
        data: { session: null, user: null },
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };

  return {
    /** Pass this object where code expects the real Supabase client. */
    client,

    /** Stub the answer of `supabase.rpc(name, ...)`. */
    onRpc(name: string, responder: RpcResponder): void {
      rpcResponders.set(name, responder);
    },

    /**
     * Stub the answers of `supabase.from(table)` chains. Several responders
     * are consumed in call order; the last one answers every later call.
     */
    onFrom(table: string, ...responders: QueryResponder[]): void {
      tableResponders.set(table, [...responders]);
    },

    /** Storage bucket double; its methods are vi.fn() for stubbing/asserting. */
    bucket(name: string): MockBucket {
      return client.storage.from(name);
    },

    /** Every RPC call, optionally filtered by function name. */
    rpcCalls(name?: string): RecordedRpc[] {
      return name ? recordedRpcs.filter((c) => c.name === name) : [...recordedRpcs];
    },

    lastRpc(name: string): RecordedRpc | undefined {
      return this.rpcCalls(name).at(-1);
    },

    /** Every `from()` chain, optionally filtered by table. */
    queries(table?: string): RecordedQuery[] {
      return table
        ? recordedQueries.filter((q) => q.table === table)
        : [...recordedQueries];
    },

    /** Session returned by `auth.getSession()`. */
    setSession(session: Session | null): void {
      currentSession = session;
    },

    /** Fires `onAuthStateChange` listeners, like a real sign-in/out. */
    emitAuthChange(event: AuthChangeEvent, session: Session | null): void {
      currentSession = session;
      for (const listener of [...authListeners]) listener(event, session);
    },

    authUnsubscribe: unsubscribe,

    /** Called after every test by src/test/setup.ts. */
    reset(): void {
      rpcResponders.clear();
      tableResponders.clear();
      recordedQueries.length = 0;
      recordedRpcs.length = 0;
      buckets.clear();
      authListeners.clear();
      currentSession = null;
    },
  };
};

export const supabaseMock = createSupabaseMock();

/** A minimal Session carrying the fields the app reads. */
export const makeSession = (
  userId: string,
  extra: { phone?: string; email?: string } = {},
): Session =>
  ({
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: userId,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      phone: extra.phone,
      email: extra.email,
    },
  }) as Session;
