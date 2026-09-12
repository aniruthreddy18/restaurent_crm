import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { NotFoundError } from "@/server/core/errors";
import { normalizeWhatsAppNumber } from "@/lib/phone";
import { money } from "@/lib/money";
import { paginated } from "@/server/core/pagination";
import type { CheckoutItemInput, ListCheckoutInput, UpsertCheckoutInput } from "./checkout.schema";

/**
 * TEMPORARY LAYER.
 *
 * Everything in this file is disposable. Creating, updating or abandoning a
 * checkout session deliberately writes NOTHING to customers/orders/payments —
 * a cart is a conversation artefact, not commercial history. The only bridge
 * to the permanent layer is payment.service.ts, and it is crossed exactly once,
 * when a payment reaches SUCCESS or FAILED.
 */

function countryCode() {
  return process.env.DEFAULT_COUNTRY_CODE ?? "91";
}

export function computeTotals(items: CheckoutItemInput[], deliveryFee = 0, discount = 0, tax = 0) {
  const subtotal = items.reduce(
    (sum, item) => sum.plus(money(item.price).times(item.quantity)),
    new Prisma.Decimal(0),
  );
  const total = subtotal.plus(money(deliveryFee)).minus(money(discount)).plus(money(tax));
  return {
    subtotal: money(subtotal),
    deliveryFee: money(deliveryFee),
    discount: money(discount),
    tax: money(tax),
    // A discount larger than the cart must not produce a negative charge.
    totalAmount: money(total.isNegative() ? 0 : total),
  };
}

/** Idempotent on (restaurantId, sessionId) — n8n can call it on every turn. */
export async function upsertCheckoutSession(ctx: TenantContext, input: UpsertCheckoutInput) {
  const whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber, countryCode());
  const totals = computeTotals(input.items, input.deliveryFee, input.discount, input.tax);
  const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);

  const data = {
    whatsappNumber,
    customerName: input.customerName ?? null,
    items: input.items as unknown as Prisma.InputJsonValue,
    deliveryAddress: input.deliveryAddress ?? null,
    ...totals,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    expiresAt,
  };

  return prisma.checkoutSession.upsert({
    where: { restaurantId_sessionId: { restaurantId: ctx.restaurantId, sessionId: input.sessionId } },
    create: { restaurantId: ctx.restaurantId, sessionId: input.sessionId, ...data },
    update: data,
  });
}

export async function getCheckoutSession(ctx: TenantContext, sessionId: string) {
  const session = await prisma.checkoutSession.findFirst({
    where: { restaurantId: ctx.restaurantId, OR: [{ sessionId }, { id: sessionId }] },
  });
  if (!session) throw new NotFoundError("Checkout session");
  return session;
}

export async function listCheckoutSessions(ctx: TenantContext, input: ListCheckoutInput) {
  const where: Prisma.CheckoutSessionWhereInput = { restaurantId: ctx.restaurantId };
  if (input.status) where.status = input.status;
  if (input.whatsappNumber) {
    where.whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber, countryCode());
  }

  const [rows, total] = await Promise.all([
    prisma.checkoutSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.checkoutSession.count({ where }),
  ]);

  return paginated(rows, total, { page: input.page, pageSize: input.pageSize });
}

/** Marks a cart abandoned. Explicitly does NOT create a customer. */
export async function abandonCheckoutSession(ctx: TenantContext, sessionId: string) {
  const session = await getCheckoutSession(ctx, sessionId);
  return prisma.checkoutSession.update({
    where: { id: session.id },
    data: { status: "ABANDONED" },
  });
}

/**
 * Housekeeping for the temporary layer: expire stale carts, then delete the
 * ones that have been expired long enough to be worthless. Converted sessions
 * are never touched — they are referenced by an order.
 */
export async function purgeExpiredSessions(ctx: TenantContext, deleteAfterDays = 7) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - deleteAfterDays * 86_400_000);

  const expired = await prisma.checkoutSession.updateMany({
    where: { restaurantId: ctx.restaurantId, status: "ACTIVE", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });

  const deleted = await prisma.checkoutSession.deleteMany({
    where: {
      restaurantId: ctx.restaurantId,
      status: { in: ["EXPIRED", "ABANDONED"] },
      updatedAt: { lt: cutoff },
      order: null,
    },
  });

  return { expired: expired.count, deleted: deleted.count };
}

/**
 * Idempotency records only need to outlive a provider's retry window. Keeping
 * them forever would grow the table without bound for no benefit.
 */
export async function purgeIdempotencyRecords(ctx: TenantContext, keepDays = 30) {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000);
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { restaurantId: ctx.restaurantId, createdAt: { lt: cutoff } },
  });
  return count;
}
