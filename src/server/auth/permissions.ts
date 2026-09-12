import type { UserRole } from "@prisma/client";
import { ForbiddenError } from "@/server/core/errors";
import type { TenantContext } from "@/server/core/context";

/**
 * The role matrix lives here rather than in a `roles` table: permissions are
 * code, not data — they change with releases, and keeping them as a typed
 * union means an unknown permission is a compile error instead of a 403 in
 * production. Adding a role is a one-line change below.
 */
export const PERMISSIONS = [
  "customers:read",
  "customers:write",
  "orders:read",
  "orders:write",
  "orders:status",
  "orders:cancel",
  "menu:read",
  "menu:write",
  "menu:availability",
  "payments:read",
  "payments:write",
  "deliveries:read",
  "deliveries:write",
  "deliveries:assigned",
  "reviews:read",
  "reviews:write",
  "conversations:read",
  "analytics:read",
  "staff:read",
  "staff:write",
  "settings:read",
  "settings:write",
  "events:read",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  ADMIN: ALL,

  MANAGER: [
    "customers:read",
    "customers:write",
    "orders:read",
    "orders:write",
    "orders:status",
    "orders:cancel",
    "menu:read",
    "menu:write",
    "menu:availability",
    "payments:read",
    "payments:write",
    "deliveries:read",
    "deliveries:write",
    "reviews:read",
    "reviews:write",
    "conversations:read",
    "analytics:read",
    "staff:read",
    "settings:read",
    "events:read",
    "audit:read",
  ],

  // Kitchen moves food along and flips menu availability — nothing financial.
  KITCHEN: ["orders:read", "orders:status", "menu:read", "menu:availability"],

  CASHIER: ["orders:read", "orders:write", "orders:status", "payments:read", "payments:write", "customers:read", "menu:read"],

  // Delivery staff see only what they need to complete a drop.
  DELIVERY: ["deliveries:assigned", "orders:read"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAny(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

/** Throws ForbiddenError when the context's role lacks the permission. */
export function assertCan(ctx: TenantContext, permission: Permission): void {
  if (!can(ctx.role, permission)) {
    throw new ForbiddenError(`Role ${ctx.role} is not allowed to ${permission}`);
  }
}

/** Nav visibility for the dashboard shell. */
export function visibleSections(role: UserRole) {
  return {
    dashboard: role !== "DELIVERY",
    customers: can(role, "customers:read"),
    orders: can(role, "orders:read"),
    menu: can(role, "menu:read"),
    payments: can(role, "payments:read"),
    deliveries: can(role, "deliveries:read") || can(role, "deliveries:assigned"),
    reviews: can(role, "reviews:read"),
    conversations: can(role, "conversations:read"),
    analytics: can(role, "analytics:read"),
    staff: can(role, "staff:read"),
    settings: can(role, "settings:read"),
  };
}
