import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";

const querySchema = z.object({
  status: z.enum(["PENDING", "DELIVERED", "FAILED", "DEAD"]).default("PENDING"),
  type: z
    .enum([
      "CUSTOMER_CREATED",
      "PAYMENT_SUCCESS",
      "PAYMENT_FAILED",
      "ORDER_CONFIRMED",
      "ORDER_PREPARING",
      "ORDER_READY",
      "ORDER_OUT_FOR_DELIVERY",
      "ORDER_DELIVERED",
      "ORDER_CANCELLED",
      "REVIEW_RECEIVED",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.string().datetime().optional(),
});

/**
 * PULL side of the event system.
 *
 * n8n can poll this instead of (or alongside) receiving webhooks — useful when
 * n8n runs locally with no public URL. Acknowledge each event with
 * POST /api/events/:id/ack so it is not handed out again.
 */
export const GET = withApi({ permission: "events:read", querySchema }, async ({ ctx, query }) => {
  const events = await prisma.event.findMany({
    where: {
      restaurantId: ctx.restaurantId,
      status: query.status,
      ...(query.type ? { type: query.type } : {}),
      ...(query.since ? { createdAt: { gt: new Date(query.since) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: query.limit,
  });

  return ok(
    events.map((event) => ({
      id: event.id,
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      externalEventId: event.externalEventId,
      status: event.status,
      attempts: event.attempts,
      occurredAt: event.createdAt,
      data: event.payload,
    })),
  );
});
