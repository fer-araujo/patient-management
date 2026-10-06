import { describe, expect, it, vi } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { fetchAllRows, TOO_MANY_ROWS_MESSAGE } from "./fetchAllRows";

/**
 * A fake paged source of `total` numbered rows, recording each range asked.
 * `serverMax` imitates a PostgREST `max_rows` below the asked page size.
 */
const source = (total: number, serverMax = Infinity) => {
  const ranges: [number, number][] = [];
  const page = async (from: number, to: number) => {
    ranges.push([from, to]);
    const last = Math.min(to, total - 1, from + serverMax - 1);
    const rows = Array.from({ length: Math.max(0, last - from + 1) }, (_, i) => from + i);
    return { data: rows, error: null };
  };
  return { page, ranges };
};

describe("fetchAllRows", () => {
  it("joins every page and stops on the first empty one", async () => {
    const { page, ranges } = source(25);
    const { data, error } = await fetchAllRows(page, { pageSize: 10 });

    expect(error).toBeNull();
    expect(data).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(ranges).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
      [25, 34],
    ]);
  });

  it("asks one more (empty) page when the total is an exact multiple of the page size", async () => {
    const { page, ranges } = source(20);
    const { data } = await fetchAllRows(page, { pageSize: 10 });

    expect(data).toHaveLength(20);
    expect(ranges).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it("does not stop on a short page: a server limit below the page size loses no rows", async () => {
    const { page, ranges } = source(25, 4);
    const { data } = await fetchAllRows(page, { pageSize: 10 });

    expect(data).toEqual(Array.from({ length: 25 }, (_, i) => i));
    // Each page starts right after the rows actually received.
    expect(ranges.map(([from]) => from)).toEqual([0, 4, 8, 12, 16, 20, 24, 25]);
  });

  it("uses 1,000-row pages by default (PostgREST's max_rows)", async () => {
    const { page, ranges } = source(1500);
    const { data } = await fetchAllRows(page);

    expect(data).toHaveLength(1500);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [1500, 2499],
    ]);
  });

  it.each([0, -5, Number.NaN, 2.7])("clamps a page size of %s to at least one row", async (size) => {
    const { page, ranges } = source(3);
    const { data } = await fetchAllRows(page, { pageSize: size });

    expect(data).toEqual([0, 1, 2]);
    for (const [from, to] of ranges) expect(to).toBeGreaterThanOrEqual(from);
  });

  it("de-duplicates rows by id when an insert shifts the offset between pages", async () => {
    const pages = [
      [{ id: "a" }, { id: "b" }],
      // A row was inserted before "b": "b" comes back again at the next offset.
      [{ id: "b" }, { id: "c" }],
      [],
    ];
    let call = 0;
    const page = async () => ({ data: pages[call++], error: null });

    const { data } = await fetchAllRows<{ id: string }>(page, { pageSize: 2 });

    expect(data.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps rows without an id as they come", async () => {
    const pages = [[{ total: 1 }, { total: 1 }], []];
    let call = 0;
    const page = async () => ({ data: pages[call++], error: null });

    const { data } = await fetchAllRows<{ total: number }>(page, { pageSize: 2 });

    expect(data).toEqual([{ total: 1 }, { total: 1 }]);
  });

  it("returns the query error and no partial rows", async () => {
    let calls = 0;
    const page = async () => {
      calls += 1;
      return calls === 1
        ? { data: [1, 2], error: null }
        : { data: null, error: { message: "boom", code: "500" } as unknown as PostgrestError };
    };

    const { data, error } = await fetchAllRows(page, { pageSize: 2 });

    expect(data).toEqual([]);
    expect(error?.message).toBe("boom");
  });

  it("throws a clear, neutral Spanish error past the cap instead of returning a partial list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { page } = source(100);

    expect(TOO_MANY_ROWS_MESSAGE).not.toMatch(/periodo/);
    await expect(fetchAllRows(page, { pageSize: 10, maxRows: 30 })).rejects.toThrow(
      TOO_MANY_ROWS_MESSAGE,
    );
    await expect(
      fetchAllRows(page, { pageSize: 10, maxRows: 30, tooManyMessage: "Demasiados." }),
    ).rejects.toThrow("Demasiados.");
  });

  it("accepts exactly the cap", async () => {
    const { page } = source(30);
    const { data } = await fetchAllRows(page, { pageSize: 10, maxRows: 30 });
    expect(data).toHaveLength(30);
  });
});
