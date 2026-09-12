import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { ConflictError } from "@/server/core/errors";

export function hashRequest(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

/**
 * Request-level idempotency.
 *
 * The first call runs `work` and stores its result. Any replay with the same
 * (scope, key) returns the stored result without touching the database again —
 * so a payment provider or n8n retry cannot create a second customer, order,
 * payment or event.
 *
 * A replay carrying a *different* body under the same key is rejected: that is
 * a caller bug, and silently returning the old answer would hide it.
 */
export async function withIdempotency<T>(
  ctx: TenantContext,
  scope: string,
  key: string | null | undefined,
  request: unknown,
  work: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!key) return { result: await work(), replayed: false };

  const requestHash = hashRequest(request);
  const existing = await prisma.idempotencyRecord.findUnique({
    where: { restaurantId_scope_key: { restaurantId: ctx.restaurantId, scope, key } },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ConflictError(
        `Idempotency key "${key}" was already used with a different request body`,
        { scope, key },
      );
    }
    return { result: existing.response as T, replayed: true };
  }

  const result = await work();

  try {
    await prisma.idempotencyRecord.create({
      data: {
        restaurantId: ctx.restaurantId,
        scope,
        key,
        requestHash,
        response: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // Two concurrent replays raced: the other one stored the record first.
    // The work itself is independently idempotent, so this is safe to ignore.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }

  return { result, replayed: false };
}
