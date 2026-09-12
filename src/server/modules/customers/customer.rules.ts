import { Prisma, type CustomerType } from "@prisma/client";

/**
 * Customer tiering thresholds. Read from `restaurants.settings.customerTiers`
 * so a restaurant can re-tune them without a deployment; the values below are
 * only the fallback.
 */
export type TierConfig = {
  regularMinOrders: number;
  loyalMinOrders: number;
  vipMinOrders: number;
  vipMinSpend: number;
  inactiveAfterDays: number;
};

export const DEFAULT_TIER_CONFIG: TierConfig = {
  regularMinOrders: 2,
  loyalMinOrders: 5,
  vipMinOrders: 10,
  vipMinSpend: 10_000,
  inactiveAfterDays: 90,
};

export function tierConfigFromSettings(settings: unknown): TierConfig {
  const raw = (settings as { customerTiers?: Partial<TierConfig> } | null)?.customerTiers ?? {};
  return {
    regularMinOrders: numberOr(raw.regularMinOrders, DEFAULT_TIER_CONFIG.regularMinOrders),
    loyalMinOrders: numberOr(raw.loyalMinOrders, DEFAULT_TIER_CONFIG.loyalMinOrders),
    vipMinOrders: numberOr(raw.vipMinOrders, DEFAULT_TIER_CONFIG.vipMinOrders),
    vipMinSpend: numberOr(raw.vipMinSpend, DEFAULT_TIER_CONFIG.vipMinSpend),
    inactiveAfterDays: numberOr(raw.inactiveAfterDays, DEFAULT_TIER_CONFIG.inactiveAfterDays),
  };
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Derives the tier from commercial history. Pure and side-effect free so it can
 * be unit-tested and re-run as a nightly sweep without touching the services.
 */
export function deriveCustomerType(
  input: { totalOrders: number; totalSpent: Prisma.Decimal | number; lastOrderAt: Date | null },
  config: TierConfig = DEFAULT_TIER_CONFIG,
  now: Date = new Date(),
): CustomerType {
  const spent = new Prisma.Decimal(input.totalSpent ?? 0).toNumber();

  // Dormancy outranks volume: a lapsed VIP needs winning back, not a badge.
  if (input.lastOrderAt) {
    const daysSince = (now.getTime() - input.lastOrderAt.getTime()) / 86_400_000;
    if (daysSince > config.inactiveAfterDays) return "INACTIVE";
  }

  if (input.totalOrders >= config.vipMinOrders || spent >= config.vipMinSpend) return "VIP";
  if (input.totalOrders >= config.loyalMinOrders) return "LOYAL";
  if (input.totalOrders >= config.regularMinOrders) return "REGULAR";
  return "NEW";
}
