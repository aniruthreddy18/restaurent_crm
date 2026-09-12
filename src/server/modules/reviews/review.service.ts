import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { BusinessRuleError, NotFoundError } from "@/server/core/errors";
import { assertCan } from "@/server/auth/permissions";
import { paginated } from "@/server/core/pagination";
import { emitEvent } from "@/server/events/emit";
import { recordAudit } from "@/server/audit/audit";
import type { CreateReviewInput, ListReviewsInput } from "./review.schema";

/**
 * Ratings arrive from WhatsApp via n8n. The review is bound to the order it is
 * about, and the customer is taken from that order rather than the request —
 * so a rating can never be attributed to the wrong person, and a replayed n8n
 * call cannot create a second review (orderId is unique).
 */
export async function createReview(ctx: TenantContext, input: CreateReviewInput) {
  assertCan(ctx, "reviews:write");

  const order = await prisma.order.findFirst({
    where: {
      restaurantId: ctx.restaurantId,
      ...(input.orderId ? { id: input.orderId } : { orderNumber: input.orderNumber! }),
    },
    select: { id: true, orderNumber: true, customerId: true, status: true },
  });
  if (!order) throw new NotFoundError("Order");

  if (order.status === "CANCELLED" || order.status === "FAILED") {
    throw new BusinessRuleError("A cancelled or failed order cannot be reviewed", "ORDER_NOT_REVIEWABLE");
  }

  const existing = await prisma.review.findUnique({ where: { orderId: order.id } });
  if (existing) return { review: existing, created: false };

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        restaurantId: ctx.restaurantId,
        customerId: order.customerId,
        orderId: order.id,
        rating: input.rating,
        comment: input.comment ?? null,
        source: input.source,
      },
    });

    await recordAudit(tx, ctx, {
      action: "review.created",
      entityType: "review",
      entityId: created.id,
      newValue: { orderNumber: order.orderNumber, rating: created.rating },
    });

    await emitEvent(tx, ctx, {
      type: "REVIEW_RECEIVED",
      entityType: "review",
      entityId: created.id,
      externalEventId: input.externalEventId ?? `REVIEW_RECEIVED:${order.id}`,
      payload: {
        reviewId: created.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        rating: created.rating,
        comment: created.comment,
      },
    });

    return created;
  });

  return { review, created: true };
}

export async function listReviews(ctx: TenantContext, input: ListReviewsInput) {
  assertCan(ctx, "reviews:read");

  const where: Prisma.ReviewWhereInput = { restaurantId: ctx.restaurantId };
  if (input.rating) where.rating = input.rating;
  if (input.customerId) where.customerId = input.customerId;

  const [rows, total, aggregate] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, whatsappNumber: true } },
        order: { select: { id: true, orderNumber: true } },
      },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.review.count({ where }),
    prisma.review.aggregate({
      where: { restaurantId: ctx.restaurantId },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);

  return {
    ...paginated(rows, total, { page: input.page, pageSize: input.pageSize }),
    summary: {
      averageRating: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(2)) : null,
      totalReviews: aggregate._count._all,
    },
  };
}

export async function ratingBreakdown(ctx: TenantContext) {
  const rows = await prisma.review.groupBy({
    by: ["rating"],
    where: { restaurantId: ctx.restaurantId },
    _count: { _all: true },
  });
  return [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: rows.find((r) => r.rating === rating)?._count._all ?? 0,
  }));
}
