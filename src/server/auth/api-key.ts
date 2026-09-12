import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { UnauthorizedError } from "@/server/core/errors";

/**
 * API keys authenticate n8n (and any other machine caller). Only the SHA-256
 * digest is stored, so a database leak does not hand over working keys.
 */
export function generateApiKey(prefix = "rk_live") {
  const raw = `${prefix}_${randomBytes(24).toString("base64url")}`;
  return { raw, hash: hashApiKey(raw), displayPrefix: raw.slice(0, 12) };
}

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Extracts a bearer token from either `Authorization` or `X-Api-Key`. */
export function extractApiKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const direct = headers.get("x-api-key");
  return direct?.trim() || null;
}

/**
 * Resolves an API key into a tenant context. API-key callers act with ADMIN
 * capability *within their own restaurant only* — the restaurantId comes from
 * the key record, never from the request.
 */
export async function authenticateApiKey(rawKey: string, ipAddress?: string): Promise<TenantContext> {
  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(rawKey) },
    select: { id: true, restaurantId: true, name: true, isActive: true, expiresAt: true, keyHash: true },
  });

  if (!record || !safeEqual(record.keyHash, hashApiKey(rawKey))) {
    throw new UnauthorizedError("Invalid API key");
  }
  if (!record.isActive) throw new UnauthorizedError("API key has been revoked");
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("API key has expired");
  }

  // Fire-and-forget: last-used tracking must never fail the request.
  void prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    restaurantId: record.restaurantId,
    role: "ADMIN",
    actorType: "API_KEY",
    actorLabel: record.name,
    ipAddress,
  };
}
