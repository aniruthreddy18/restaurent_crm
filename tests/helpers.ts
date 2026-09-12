import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import type { UserRole } from "@prisma/client";

/** Wipes every table between tests. Order is irrelevant — TRUNCATE CASCADE. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      event_deliveries, events, audit_logs, notifications, idempotency_records,
      reviews, deliveries, delivery_drivers, payments, order_items, orders,
      checkout_sessions, messages, conversation_sessions, customers,
      products, categories, api_keys, webhook_endpoints, users, restaurants
    RESTART IDENTITY CASCADE
  `);
}

export type Tenant = {
  restaurantId: string;
  ctx: TenantContext;
  contextFor: (role: UserRole, userId?: string) => TenantContext;
};

export async function createTenant(name = "Test Kitchen", slug = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): Promise<Tenant> {
  const restaurant = await prisma.restaurant.create({ data: { name, slug } });

  const ctx: TenantContext = {
    restaurantId: restaurant.id,
    role: "ADMIN",
    actorType: "API_KEY",
    actorLabel: "test-suite",
  };

  return {
    restaurantId: restaurant.id,
    ctx,
    contextFor: (role, userId) => ({
      restaurantId: restaurant.id,
      role,
      userId,
      actorType: userId ? "USER" : "API_KEY",
      actorLabel: `test-${role}`,
    }),
  };
}

export async function createStaffUser(restaurantId: string, role: UserRole, email = `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@test.local`) {
  return prisma.user.create({
    data: { restaurantId, name: `${role} user`, email, role, passwordHash: "x" },
  });
}

/** A cart the AI agent might have assembled, in the shape n8n posts. */
export function cartItems() {
  return [
    { name: "Butter Chicken", price: 420, quantity: 1 },
    { name: "Garlic Naan", price: 90, quantity: 2 },
  ];
}

export const CART_TOTAL = 420 + 90 * 2; // 600
