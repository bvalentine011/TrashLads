import { describe, expect, it } from "vitest";
import { priceFor } from "../src/pricing";
import { easternNow, isBeforeCancelCutoff, serviceDateProblem } from "../src/dates";

describe("pricing", () => {
  it("charges $8 base plus $3 per bag", () => {
    expect([1, 2, 3].map((n) => priceFor(n).totalCents)).toEqual([1100, 1400, 1700]);
    expect(priceFor(2)).toMatchObject({ baseFeeCents: 800, bagSubtotalCents: 600, subtotalCents: 1400, taxCents: 0, currency: "usd" });
  });

  it.each([0, 4, 2.5, -1, NaN])("rejects %s bags", (n) => {
    expect(() => priceFor(n)).toThrow(/1, 2 or 3/);
  });
});

describe("service dates (Eastern time)", () => {
  const monNoon = new Date("2026-11-23T17:00:00Z");
  it("reads Eastern time across the UTC date line", () => {
    // 01:30 UTC Tuesday is 8:30 PM Monday in New York.
    expect(easternNow(new Date("2026-11-24T01:30:00Z"))).toEqual({ date: "2026-11-23", minutes: 20 * 60 + 30 });
  });
  it("accepts a future weeknight", () => expect(serviceDateProblem("2026-11-24", monNoon)).toBeNull());
  it("accepts today before 8 PM", () => expect(serviceDateProblem("2026-11-23", monNoon)).toBeNull());
  it("closes same-day booking at 8 PM Eastern", () => {
    expect(serviceDateProblem("2026-11-23", new Date("2026-11-24T01:00:00Z"))).toBe("same-day-closed");
  });
  it("rejects past dates, weekends, holidays and dates too far ahead", () => {
    expect(serviceDateProblem("2026-11-20", monNoon)).toBe("past");
    expect(serviceDateProblem("2026-11-28", monNoon)).toBe("weekend");
    expect(serviceDateProblem("2026-11-26", monNoon)).toBe("closed");
    expect(serviceDateProblem("2026-12-21", monNoon)).toBe("too-far");
    expect(serviceDateProblem("2026-02-30", monNoon)).toBe("invalid");
    expect(serviceDateProblem(20261124, monNoon)).toBe("invalid");
  });
  it("allows cancellation until 5 PM Eastern on the pickup date", () => {
    expect(isBeforeCancelCutoff("2026-11-23", new Date("2026-11-23T21:59:00Z"))).toBe(true); // 4:59 PM
    expect(isBeforeCancelCutoff("2026-11-23", new Date("2026-11-23T22:00:00Z"))).toBe(false); // 5:00 PM
    expect(isBeforeCancelCutoff("2026-11-24", monNoon)).toBe(true);
    expect(isBeforeCancelCutoff("2026-11-20", monNoon)).toBe(false);
  });
});
