import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { assertCan } from "@/server/auth/permissions";
import { BusinessRuleError, NotFoundError } from "@/server/core/errors";
import { generateApiKey } from "@/server/auth/api-key";
import { recordAudit } from "@/server/audit/audit";
import { DEFAULT_TIER_CONFIG, tierConfigFromSettings } from "@/server/modules/customers/customer.rules";

export async function getRestaurant(ctx: TenantContext) {
  assertCan(ctx, "settings:read");
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: ctx.restaurantId } });
  return { ...restaurant, tiers: tierConfigFromSettings(restaurant.settings) };
}

export async function updateRestaurant(
  ctx: TenantContext,
  input: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    currency?: string;
    timezone?: string;
    tiers?: Partial<typeof DEFAULT_TIER_CONFIG>;
  },
) {
  assertCan(ctx, "settings:write");
  const existing = await prisma.restaurant.findUniqueOrThrow({ where: { id: ctx.restaurantId } });

  const settings = {
    ...((existing.settings as Record<string, unknown>) ?? {}),
    ...(input.tiers ? { customerTiers: { ...tierConfigFromSettings(existing.settings), ...input.tiers } } : {}),
  } as Prisma.InputJsonValue;

  return prisma.$transaction(async (tx) => {
    const restaurant = await tx.restaurant.update({
      where: { id: ctx.restaurantId },
      data: {
        name: input.name ?? undefined,
        phone: input.phone ?? undefined,
        email: input.email ?? undefined,
        address: input.address ?? undefined,
        city: input.city ?? undefined,
        currency: input.currency ?? undefined,
        timezone: input.timezone ?? undefined,
        settings,
      },
    });
    await recordAudit(tx, ctx, {
      action: "restaurant.updated",
      entityType: "restaurant",
      entityId: restaurant.id,
      oldValue: { name: existing.name, currency: existing.currency },
      newValue: { name: restaurant.name, currency: restaurant.currency },
    });
    return restaurant;
  });
}

export async function listApiKeys(ctx: TenantContext) {
  assertCan(ctx, "settings:read");
  return prisma.apiKey.findMany({
    where: { restaurantId: ctx.restaurantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, keyPrefix: true, isActive: true, lastUsedAt: true, createdAt: true },
  });
}

/** The raw key is returned exactly once — only its SHA-256 digest is stored. */
export async function createApiKey(ctx: TenantContext, name: string) {
  assertCan(ctx, "settings:write");
  const { raw, hash, displayPrefix } = generateApiKey();

  const record = await prisma.$transaction(async (tx) => {
    const key = await tx.apiKey.create({
      data: { restaurantId: ctx.restaurantId, name, keyHash: hash, keyPrefix: displayPrefix },
    });
    await recordAudit(tx, ctx, {
      action: "api_key.created",
      entityType: "api_key",
      entityId: key.id,
      newValue: { name, keyPrefix: displayPrefix },
    });
    return key;
  });

  return { id: record.id, name: record.name, keyPrefix: record.keyPrefix, key: raw };
}

export async function revokeApiKey(ctx: TenantContext, keyId: string) {
  assertCan(ctx, "settings:write");
  const key = await prisma.apiKey.findFirst({ where: { id: keyId, restaurantId: ctx.restaurantId } });
  if (!key) return null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.apiKey.update({ where: { id: key.id }, data: { isActive: false } });
    await recordAudit(tx, ctx, {
      action: "api_key.revoked",
      entityType: "api_key",
      entityId: key.id,
      oldValue: { isActive: true },
      newValue: { isActive: false },
    });
    return updated;
  });
}

/**
 * Permanently removes a revoked key. Only revoked keys can be deleted — an
 * active key must be revoked first, so nobody can silently cut off a running
 * integration with one click. The audit row survives the deletion.
 */
export async function deleteApiKey(ctx: TenantContext, keyId: string) {
  assertCan(ctx, "settings:write");

  const key = await prisma.apiKey.findFirst({ where: { id: keyId, restaurantId: ctx.restaurantId } });
  if (!key) throw new NotFoundError("API key");

  if (key.isActive) {
    throw new BusinessRuleError(
      "Revoke this key before deleting it — deleting an active key would break whatever is using it without warning",
      "API_KEY_STILL_ACTIVE",
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.apiKey.delete({ where: { id: key.id } });
    await recordAudit(tx, ctx, {
      action: "api_key.deleted",
      entityType: "api_key",
      entityId: key.id,
      oldValue: { name: key.name, keyPrefix: key.keyPrefix, revokedWhileActive: false },
    });
    return { id: key.id, name: key.name };
  });
}

export async function listWebhookEndpoints(ctx: TenantContext) {
  assertCan(ctx, "settings:read");
  return prisma.webhookEndpoint.findMany({
    where: { restaurantId: ctx.restaurantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, url: true, eventTypes: true, isActive: true, createdAt: true },
  });
}

export async function getAuditLog(ctx: TenantContext, page = 1, pageSize = 50) {
  assertCan(ctx, "audit:read");
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { restaurantId: ctx.restaurantId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where: { restaurantId: ctx.restaurantId } }),
  ]);
  return { rows, total, page, pageSize };
}
