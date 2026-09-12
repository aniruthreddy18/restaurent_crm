import { Prisma } from "@prisma/client";

export type Money = Prisma.Decimal;

/** Builds a Decimal rounded to 2dp. Rejects NaN/Infinity early. */
export function money(value: number | string | Prisma.Decimal): Prisma.Decimal {
  const d = new Prisma.Decimal(value ?? 0);
  if (!d.isFinite()) throw new Error(`Invalid monetary value: ${String(value)}`);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return new Prisma.Decimal(value).toNumber();
}

export function formatMoney(value: Prisma.Decimal | number | string | null | undefined, currency = "INR") {
  const n = toNumber(value);
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
