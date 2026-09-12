import type { EventType, Prisma } from "@prisma/client";
import type { Db } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";

export type EmitInput = {
  type: EventType;
  entityType: string;
  entityId: string;
  payload: Prisma.InputJsonValue;
  /** Caller-supplied de-dup key. A replay with the same key is a no-op. */
  externalEventId?: string | null;
};

/**
 * Transactional outbox write.
 *
 * Called with the *same* transaction client as the state change it describes,
 * so an event can never be emitted for a change that rolled back, and a change
 * can never commit without its event. Delivery to n8n happens separately
 * (push via the dispatcher, or pull via GET /api/events) — which is what lets
 * the CRM keep working while n8n is offline.
 */
export async function emitEvent(db: Db, ctx: TenantContext, input: EmitInput) {
  const externalEventId = input.externalEventId ?? null;

  if (externalEventId) {
    // Unique on (restaurantId, externalEventId): a duplicate webhook replay
    // resolves to the existing row instead of a second event.
    const existing = await db.event.findFirst({
      where: { restaurantId: ctx.restaurantId, externalEventId },
    });
    if (existing) return existing;
  }

  return db.event.create({
    data: {
      restaurantId: ctx.restaurantId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload,
      externalEventId,
    },
  });
}

/** Deterministic de-dup key for an event that describes one entity transition. */
export function transitionKey(type: EventType, entityId: string) {
  return `${type}:${entityId}`;
}
