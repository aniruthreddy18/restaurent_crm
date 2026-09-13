/**
 * API key lifecycle. Deleting a key that something is still using would break
 * an integration with no warning, so deletion is gated behind revocation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import {
  createApiKey,
  deleteApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/server/modules/restaurants/restaurant.service";
import { authenticateApiKey } from "@/server/auth/api-key";
import { BusinessRuleError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/server/core/errors";
import { createTenant, resetDatabase, type Tenant } from "./helpers";

let tenant: Tenant;
let other: Tenant;

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant("Alpha", "alpha");
  other = await createTenant("Beta", "beta");
});

describe("creating and using a key", () => {
  it("returns the raw key once and stores only a hash", async () => {
    const created = await createApiKey(tenant.ctx, "n8n");

    expect(created.key).toMatch(/^rk_live_/);
    const stored = await prisma.apiKey.findFirstOrThrow();
    expect(stored.keyHash).not.toBe(created.key);
    expect(JSON.stringify(stored)).not.toContain(created.key);

    // The raw key authenticates into its own restaurant.
    const ctx = await authenticateApiKey(created.key);
    expect(ctx.restaurantId).toBe(tenant.restaurantId);
  });
});

describe("revoking", () => {
  it("stops the key working but keeps it listed", async () => {
    const created = await createApiKey(tenant.ctx, "n8n");
    await revokeApiKey(tenant.ctx, created.id);

    await expect(authenticateApiKey(created.key)).rejects.toBeInstanceOf(UnauthorizedError);
    const listed = await listApiKeys(tenant.ctx);
    expect(listed).toHaveLength(1);
    expect(listed[0].isActive).toBe(false);
  });
});

describe("deleting", () => {
  it("refuses to delete a key that is still active", async () => {
    const created = await createApiKey(tenant.ctx, "n8n");

    await expect(deleteApiKey(tenant.ctx, created.id)).rejects.toBeInstanceOf(BusinessRuleError);
    // Still usable — nothing was broken by the attempt.
    await expect(authenticateApiKey(created.key)).resolves.toBeTruthy();
  });

  it("removes a revoked key from the list for good", async () => {
    const created = await createApiKey(tenant.ctx, "n8n");
    await revokeApiKey(tenant.ctx, created.id);

    const result = await deleteApiKey(tenant.ctx, created.id);
    expect(result.name).toBe("n8n");
    expect(await listApiKeys(tenant.ctx)).toHaveLength(0);
    expect(await prisma.apiKey.count()).toBe(0);
  });

  it("keeps an audit record of the deletion", async () => {
    const created = await createApiKey(tenant.ctx, "n8n");
    await revokeApiKey(tenant.ctx, created.id);
    await deleteApiKey(tenant.ctx, created.id);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "api_key.deleted" } });
    expect((audit.oldValue as Record<string, string>).name).toBe("n8n");
  });

  it("cannot delete another restaurant's key", async () => {
    const created = await createApiKey(other.ctx, "beta key");
    await revokeApiKey(other.ctx, created.id);

    await expect(deleteApiKey(tenant.ctx, created.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.apiKey.count()).toBe(1);
  });

  it("is refused for roles without settings:write", async () => {
    const created = await createApiKey(tenant.ctx, "n8n");
    await revokeApiKey(tenant.ctx, created.id);

    await expect(deleteApiKey(tenant.contextFor("MANAGER"), created.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteApiKey(tenant.contextFor("CASHIER"), created.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
