import { prisma } from "@/server/db/prisma";
import { env } from "@/lib/env";
import { signPayload } from "@/server/events/signature";

/**
 * Push side of the outbox. Safe to run on a timer, from a cron job, or not at
 * all — n8n can equally poll `GET /api/events?status=PENDING` and acknowledge.
 *
 * Retries use exponential backoff capped at ~1 hour; after
 * EVENT_MAX_ATTEMPTS the row is marked DEAD and left for a human.
 */
function backoffMs(attempt: number) {
  return Math.min(60 * 60_000, 2 ** attempt * 1000);
}

export type DispatchSummary = { picked: number; delivered: number; failed: number };

/** How long a claimed event stays leased before another dispatcher may retry it. */
const CLAIM_LEASE_MINUTES = 2;

export async function dispatchPendingEvents(limit?: number): Promise<DispatchSummary> {
  const cfg = env();
  const batchSize = limit ?? cfg.EVENT_DISPATCH_BATCH_SIZE;

  /*
   * Claim a batch atomically before touching it.
   *
   * Dispatch runs after every mutating request (see http/handler.ts) as well as
   * from cron and the CLI, so several dispatchers can overlap. Selecting rows
   * and then processing them would let two of them pick the same event and
   * deliver it twice.
   *
   * FOR UPDATE SKIP LOCKED hands each concurrent claimer a disjoint set, and
   * flipping the row to DELIVERING with a future next_attempt_at turns the
   * claim into a lease: if this process dies mid-flight, the row becomes
   * eligible again once the lease expires rather than being stranded.
   */
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE events
       SET status = 'DELIVERING',
           next_attempt_at = NOW() + (${CLAIM_LEASE_MINUTES} || ' minutes')::interval,
           updated_at = NOW()
     WHERE id IN (
       SELECT id FROM events
        WHERE next_attempt_at <= NOW()
          AND (status = 'PENDING' OR status = 'DELIVERING')
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id
  `;

  if (claimed.length === 0) return { picked: 0, delivered: 0, failed: 0 };

  const events = await prisma.event.findMany({
    where: { id: { in: claimed.map((c) => c.id) } },
    orderBy: { createdAt: "asc" },
  });

  const summary: DispatchSummary = { picked: events.length, delivered: 0, failed: 0 };

  for (const event of events) {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        restaurantId: event.restaurantId,
        isActive: true,
        OR: [{ eventTypes: { isEmpty: true } }, { eventTypes: { has: event.type } }],
      },
    });

    // No subscriber configured: hand the event straight back to PENDING so
    // that GET /api/events still offers it for polling. This is the normal
    // state when n8n consumes by polling only.
    if (endpoints.length === 0) {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          status: "PENDING",
          lastError: "No active webhook endpoint subscribed",
          nextAttemptAt: new Date(Date.now() + 300_000),
        },
      });
      continue;
    }

    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      restaurantId: event.restaurantId,
      entityType: event.entityType,
      entityId: event.entityId,
      externalEventId: event.externalEventId,
      occurredAt: event.createdAt.toISOString(),
      data: event.payload,
    });

    let allDelivered = true;
    let lastError: string | null = null;

    for (const endpoint of endpoints) {
      const timestamp = Math.floor(Date.now() / 1000);
      try {
        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-crm-event": event.type,
            "x-crm-event-id": event.id,
            "x-crm-timestamp": String(timestamp),
            "x-crm-signature": signPayload(endpoint.secret, body, timestamp),
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        const delivered = response.ok;
        if (!delivered) {
          allDelivered = false;
          lastError = `Endpoint ${endpoint.name} responded ${response.status}`;
        }

        await prisma.eventDelivery.upsert({
          where: { eventId_endpointId: { eventId: event.id, endpointId: endpoint.id } },
          create: {
            eventId: event.id,
            endpointId: endpoint.id,
            status: delivered ? "DELIVERED" : "FAILED",
            attempts: 1,
            responseCode: response.status,
            lastError: delivered ? null : lastError,
            deliveredAt: delivered ? new Date() : null,
          },
          update: {
            status: delivered ? "DELIVERED" : "FAILED",
            attempts: { increment: 1 },
            responseCode: response.status,
            lastError: delivered ? null : lastError,
            deliveredAt: delivered ? new Date() : null,
          },
        });
      } catch (error) {
        allDelivered = false;
        lastError = error instanceof Error ? error.message : "Webhook request failed";
        await prisma.eventDelivery.upsert({
          where: { eventId_endpointId: { eventId: event.id, endpointId: endpoint.id } },
          create: { eventId: event.id, endpointId: endpoint.id, status: "FAILED", attempts: 1, lastError },
          update: { status: "FAILED", attempts: { increment: 1 }, lastError },
        });
      }
    }

    const attempts = event.attempts + 1;
    if (allDelivered) {
      summary.delivered += 1;
      await prisma.event.update({
        where: { id: event.id },
        data: { status: "DELIVERED", attempts, deliveredAt: new Date(), lastError: null },
      });
    } else {
      summary.failed += 1;
      const exhausted = attempts >= cfg.EVENT_MAX_ATTEMPTS;
      await prisma.event.update({
        where: { id: event.id },
        data: {
          status: exhausted ? "DEAD" : "PENDING",
          attempts,
          lastError,
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        },
      });
    }
  }

  return summary;
}
