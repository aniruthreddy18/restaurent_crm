import type { UserRole } from "@prisma/client";

/**
 * Every service call carries the tenant it acts on. Services never accept a
 * bare restaurantId from a request body — it always comes from the
 * authenticated principal, which is what makes cross-tenant access impossible.
 */
export type TenantContext = {
  restaurantId: string;
  /** Present for dashboard users; absent for n8n API-key calls. */
  userId?: string;
  role: UserRole;
  /** How this call authenticated — used for audit attribution. */
  actorType: "USER" | "API_KEY" | "SYSTEM";
  actorLabel?: string;
  ipAddress?: string;
};

/** Context used by background jobs (seeding, dispatcher) — full privileges. */
export function systemContext(restaurantId: string, label = "system"): TenantContext {
  return { restaurantId, role: "ADMIN", actorType: "SYSTEM", actorLabel: label };
}
