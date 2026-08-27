import { describe, expect, it } from "vitest";
import { centsToUnits, computeLineSplit, formatCents, unitsToCents } from "@/lib/money";

describe("computeLineSplit (real money.ts)", () => {
  it("splits a clean line at the default 10% platform rate", () => {
    const split = computeLineSplit(10_000, 1, 0.1);
    expect(split.lineTotal).toBe(10_000);
    expect(split.commission).toBe(1_000);
    expect(split.vendorEarnings).toBe(9_000);
  });

  it("multiplies by quantity before applying the rate", () => {
    const split = computeLineSplit(4_000, 3, 0.25);
    expect(split.lineTotal).toBe(12_000);
    expect(split.commission).toBe(3_000);
    expect(split.vendorEarnings).toBe(9_000);
  });

  it("rounds commission half-up on fractional cents", () => {
    // 995 * 0.1 = 99.5 → round half-up → 100 (not banker's rounding to 100? Math.round(99.5)=100)
    expect(computeLineSplit(995, 1, 0.1).commission).toBe(100);
    // 985 * 0.1 = 98.5 → 99
    expect(computeLineSplit(985, 1, 0.1).commission).toBe(99);
  });

  it("never loses or invents a cent across odd rates and quantities", () => {
    const rates = [0.1, 0.07, 0.33, 0.5, 0.03];
    const prices = [1, 997, 1050, 2500, 999_999];
    for (const rate of rates) {
      for (const price of prices) {
        for (const qty of [1, 2, 7]) {
          const split = computeLineSplit(price, qty, rate);
          expect(split.commission + split.vendorEarnings).toBe(split.lineTotal);
          expect(Number.isInteger(split.commission)).toBe(true);
          expect(Number.isInteger(split.vendorEarnings)).toBe(true);
          expect(split.lineTotal).toBe(price * qty);
        }
      }
    }
  });

  it("handles zero-quantity lines without NaN", () => {
    const split = computeLineSplit(5_000, 0, 0.1);
    expect(split.lineTotal).toBe(0);
    expect(split.commission).toBe(0);
    expect(split.vendorEarnings).toBe(0);
  });

  it("keeps conservation for a negative (adjustment) rate too", () => {
    const split = computeLineSplit(1_000, 1, -0.1);
    expect(split.commission).toBe(-100);
    expect(split.commission + split.vendorEarnings).toBe(1_000);
  });
});

describe("money formatting/conversion (real money.ts)", () => {
  it("formats integer cents as USD", () => {
    expect(formatCents(123_456)).toBe("$1,234.56");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("converts units↔cents without float drift", () => {
    expect(unitsToCents(19.99)).toBe(1999);
    expect(unitsToCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    expect(centsToUnits(1999)).toBeCloseTo(19.99, 10);
  });
});
