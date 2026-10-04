import { describe, expect, it } from "vitest";
import {
  ARCO_EFFECTIVE_BUSINESS_DAYS,
  ARCO_RESPONSE_BUSINESS_DAYS,
  addBusinessDays,
} from "./privacyNotice";

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("addBusinessDays", () => {
  it("moves from Friday to the following Monday for one business day", () => {
    // 2026-09-25 is a Friday.
    expect(isoDay(addBusinessDays(new Date(2026, 8, 25), 1))).toBe("2026-09-28");
  });

  it("never lands on a weekend when starting on Saturday or Sunday", () => {
    expect(isoDay(addBusinessDays(new Date(2026, 8, 26), 1))).toBe("2026-09-28");
    expect(isoDay(addBusinessDays(new Date(2026, 8, 27), 1))).toBe("2026-09-28");
  });

  it("counts five business days as one calendar week", () => {
    // Monday 2026-09-21 -> Monday 2026-09-28.
    expect(isoDay(addBusinessDays(new Date(2026, 8, 21), 5))).toBe("2026-09-28");
  });

  it("computes the 20 business-day ARCO response deadline", () => {
    expect(ARCO_RESPONSE_BUSINESS_DAYS).toBe(20);
    // Wednesday 2026-09-23 + 20 business days = Wednesday 2026-10-21.
    expect(
      isoDay(addBusinessDays(new Date(2026, 8, 23), ARCO_RESPONSE_BUSINESS_DAYS)),
    ).toBe("2026-10-21");
  });

  it("chains the 15 business-day effectiveness period after the response", () => {
    expect(ARCO_EFFECTIVE_BUSINESS_DAYS).toBe(15);
    const answered = addBusinessDays(new Date(2026, 8, 23), ARCO_RESPONSE_BUSINESS_DAYS);
    // Wednesday 2026-10-21 + 15 business days = Wednesday 2026-11-11.
    expect(isoDay(addBusinessDays(answered, ARCO_EFFECTIVE_BUSINESS_DAYS))).toBe(
      "2026-11-11",
    );
  });

  it("does not skip Mexican public holidays (documented approximation)", () => {
    // Monday 2026-11-16 is a public holiday (Revolution Day) and still counts.
    expect(isoDay(addBusinessDays(new Date(2026, 10, 13), 1))).toBe("2026-11-16");
  });

  it("returns the start date for zero days and never mutates the input", () => {
    const start = new Date(2026, 8, 23, 10, 30);
    const snapshot = start.getTime();
    expect(addBusinessDays(start, 0).getTime()).toBe(snapshot);
    addBusinessDays(start, 10);
    expect(start.getTime()).toBe(snapshot);
  });

  it("keeps the time of day", () => {
    const result = addBusinessDays(new Date(2026, 8, 23, 17, 45), 3);
    expect([result.getHours(), result.getMinutes()]).toEqual([17, 45]);
  });
});
