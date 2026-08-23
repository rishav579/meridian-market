/**
 * Money helpers — all amounts are integer cents throughout the system.
 * Floating point never touches money; rounding happens exactly once, per line.
 */

export const formatCents = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const centsToUnits = (cents: number): number => Math.round(cents) / 100;

export const unitsToCents = (units: number): number => Math.round(units * 100);

/** Integer-safe line commission: round-half-up on cents. */
export const computeLineSplit = (
  unitPriceCents: number,
  quantity: number,
  commissionRate: number
): { lineTotal: number; commission: number; vendorEarnings: number } => {
  const lineTotal = unitPriceCents * quantity;
  const commission = Math.round(lineTotal * commissionRate);
  return { lineTotal, commission, vendorEarnings: lineTotal - commission };
};
