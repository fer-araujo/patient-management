import { describe, expect, it } from "vitest";
import { yAxisScale, yDomain } from "./trendScale";

describe("yDomain", () => {
  it("adds air around the values, on the indicator's precision", () => {
    // Range 3.9 -> 20 % pad = 0.78 each side.
    expect(yDomain([68.5, 72.4], 1)).toEqual([67.7, 73.2]);
  });

  it("gives an all-equal series a band around its value", () => {
    expect(yDomain([70, 70, 70], 1)).toEqual([69.5, 70.5]);
    expect(yDomain([0.88, 0.88], 2)).toEqual([0.83, 0.93]);
    expect(yDomain([8, 8], 0)).toEqual([7, 9]);
  });

  it("keeps whole-number ends for an integer indicator", () => {
    const [lo, hi] = yDomain([7, 8, 12], 0);
    expect(Number.isInteger(lo)).toBe(true);
    expect(Number.isInteger(hi)).toBe(true);
    expect(lo).toBeLessThan(7);
    expect(hi).toBeGreaterThan(12);
  });

  it("never goes below zero", () => {
    expect(yDomain([1, 2], 0)[0]).toBe(0);
  });
});

describe("yAxisScale", () => {
  it("allows no fractional ticks and at most one tick per whole number for an integer scale", () => {
    expect(yAxisScale([8, 8], 0)).toEqual({ domain: [7, 9], allowDecimals: false, tickCount: 3 });
    expect(yAxisScale([5, 15], 0)).toMatchObject({ allowDecimals: false, tickCount: 5 });
  });

  it("keeps five ticks with decimals for a decimal scale", () => {
    expect(yAxisScale([68.5, 72.4], 1)).toMatchObject({ allowDecimals: true, tickCount: 5 });
  });
});
