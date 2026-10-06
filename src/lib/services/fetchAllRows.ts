import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Rows asked for per request. PostgREST never returns more than `max_rows`
 * (1000, supabase/config.toml and the hosted default) per request. A smaller
 * server limit is handled too: the next page starts after the rows actually
 * received, never after the rows asked for.
 */
export const FETCH_PAGE_SIZE = 1000;

/** Hard cap: past this many rows the caller gets an error, never a partial list. */
export const FETCH_MAX_ROWS = 50_000;

/** Default message past the cap; callers with a period filter pass their own. */
export const TOO_MANY_ROWS_MESSAGE =
  "Hay demasiados registros para cargarlos completos.";

interface PageResult<T> {
  data: T[] | null;
  error: PostgrestError | null;
}

interface FetchAllRowsOptions {
  pageSize?: number;
  maxRows?: number;
  /** Error message when `maxRows` is exceeded. */
  tooManyMessage?: string;
}

const rowId = (row: unknown): unknown =>
  row !== null && typeof row === "object" && "id" in row
    ? (row as { id: unknown }).id
    : undefined;

/**
 * Reads every row of a query, one page at a time, so nothing is silently cut
 * at PostgREST's `max_rows`.
 *
 * `page(from, to)` must build a FRESH query each time, ending in
 * `.range(from, to)` and ordered by a unique key (e.g. `created_at` plus `id`
 * as a tiebreaker); otherwise rows can repeat or be skipped between pages.
 *
 * Stops only on an EMPTY page (a short page can be a server limit below
 * `pageSize`, not the end), or on a page whose rows were all listed already.
 * Rows inserted or deleted between two requests can shift an offset page;
 * rows that carry an `id` are de-duplicated by it, so a shifted row is never
 * listed twice.
 *
 * Returns `{ data, error }` like a single query, so callers keep their own
 * error handling. Throws `tooManyMessage` when more than `maxRows` rows come
 * back.
 */
export const fetchAllRows = async <T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  {
    pageSize = FETCH_PAGE_SIZE,
    maxRows = FETCH_MAX_ROWS,
    tooManyMessage = TOO_MANY_ROWS_MESSAGE,
  }: FetchAllRowsOptions = {},
): Promise<{ data: T[]; error: PostgrestError | null }> => {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : FETCH_PAGE_SIZE;
  const rows: T[] = [];
  const seen = new Set<unknown>();
  let received = 0;

  for (;;) {
    const { data, error } = await page(received, received + size - 1);
    if (error) return { data: [], error };
    const batch = data ?? [];
    if (batch.length === 0) return { data: rows, error: null };

    received += batch.length;
    if (received > maxRows) {
      console.error(`[fetchAllRows] More than ${maxRows} rows; refusing a partial list.`);
      throw new Error(tooManyMessage);
    }

    let added = 0;
    for (const row of batch) {
      const id = rowId(row);
      if (id !== undefined) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      rows.push(row);
      added += 1;
    }
    // A page of rows already listed means the source ignores the range:
    // asking again would only repeat them.
    if (added === 0) return { data: rows, error: null };
  }
};
