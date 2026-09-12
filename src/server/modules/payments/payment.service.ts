import { Prisma, type PaymentStatus } from "@prisma/client";
import { prisma, type Db } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { BusinessRuleError, NotFoundError } from "@/server/core/errors";
import { assertCan } from "@/server/auth/permissions";
import { normalizeWhatsAppNumber } from "@/lib/phone";
import { money } from "@/lib/money";
import { paginated } from "@/server/core/pagination";
import { emitEvent } from "@/server/events/emit";
import { recordAudit } from "@/server/audit/audit";
import {
  recalculateCustomerStats,
  upsertCustomerFromTerminalPayment,
} from "@/server/modules/customers/customer.service";
import {
  createOrderRecord,
  nextOrderNumber,
  orderEventPayload,
  withConcurrencyRetry,
} from "@/server/modules/orders/order.service";
import type { OrderItemInput } from "@/server/modules/orders/order.schema";
import {
  sanitizePaymentMetadata,
  type ListPaymentsInput,
  type PaymentResultInput,
  type UpdatePaymentInput,
} from "./payment.schema";

/** SUCCESS and FAILED are terminal. Nothing else may create a CRM customer. */
export function isTerminalPaymentStatus(status: PaymentStatus): status is "SUCCESS" | "FAILED" {
  return status === "SUCCESS" || status === "FAILED";
}

function countryCode() {
  return process.env.DEFAULT_COUNTRY_CODE ?? "91";
}

export type PaymentResultOutcome = {
  replayed: boolean;
  customerCreated: boolean;
  customerId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  paymentId: string;
  paymentStatus: PaymentStatus;
  orderStatus: string | null;
};

/**
 * ============================================================================
 * THE CORE BUSINESS FLOW
 * ============================================================================
 *
 * n8n calls this once a payment attempt reaches a result.
 *
 *  - PENDING / anything non-terminal: we record the payment intent and nothing
 *    else. No customer. No order. Somebody who says hello, browses the menu,
 *    builds a cart and walks away leaves no trace in the permanent CRM.
 *
 *  - SUCCESS or FAILED: the interaction has become commercial history, so we
 *    upsert the customer by WhatsApp number, materialise the order with price
 *    snapshots, write the payment, and emit the events n8n turns into WhatsApp
 *    messages.
 *
 * The whole terminal path is one transaction and is idempotent at three
 * independent levels — the externalEventId/idempotency key, the unique
 * (restaurantId, transactionId) on payments, and the unique checkout-session
 * link on orders — so a provider that fires the same webhook five times still
 * produces exactly one customer, one order, one payment and one event.
 */
export async function recordPaymentResult(
  ctx: TenantContext,
  input: PaymentResultInput,
): Promise<PaymentResultOutcome> {
  const whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber, countryCode());
  const metadata = sanitizePaymentMetadata(input.metadata) as Prisma.InputJsonValue;

  // ---- Non-terminal: intent only. The permanent layer is not touched. ----
  if (!isTerminalPaymentStatus(input.status)) {
    const payment = await prisma.payment.upsert({
      where: { restaurantId_transactionId: { restaurantId: ctx.restaurantId, transactionId: input.transactionId } },
      create: {
        restaurantId: ctx.restaurantId,
        amount: money(input.amount),
        currency: input.currency,
        paymentMethod: input.paymentMethod ?? null,
        gateway: input.gateway ?? null,
        transactionId: input.transactionId,
        status: input.status,
        metadata,
      },
      update: { status: input.status, amount: money(input.amount), metadata },
    });

    if (input.checkoutSessionId) {
      await prisma.checkoutSession.updateMany({
        where: { restaurantId: ctx.restaurantId, sessionId: input.checkoutSessionId },
        data: { paymentStatus: input.status },
      });
    }

    return {
      replayed: false,
      customerCreated: false,
      customerId: null,
      orderId: null,
      orderNumber: null,
      paymentId: payment.id,
      paymentStatus: payment.status,
      orderStatus: null,
    };
  }

  // ---- Terminal: create the permanent record. ----
  return withConcurrencyRetry((attempt) =>
    prisma.$transaction(
      async (tx) => {
        const existingPayment = await tx.payment.findUnique({
          where: {
            restaurantId_transactionId: { restaurantId: ctx.restaurantId, transactionId: input.transactionId },
          },
        });

        // Exact replay of an already-processed terminal result: return the
        // stored outcome untouched.
        if (existingPayment && existingPayment.status === input.status && existingPayment.orderId) {
          const order = await tx.order.findUnique({
            where: { id: existingPayment.orderId },
            select: { id: true, orderNumber: true, status: true },
          });
          return {
            replayed: true,
            customerCreated: false,
            customerId: existingPayment.customerId,
            orderId: order?.id ?? null,
            orderNumber: order?.orderNumber ?? null,
            paymentId: existingPayment.id,
            paymentStatus: existingPayment.status,
            orderStatus: order?.status ?? null,
          };
        }

        const checkout = input.checkoutSessionId
          ? await tx.checkoutSession.findUnique({
              where: {
                restaurantId_sessionId: { restaurantId: ctx.restaurantId, sessionId: input.checkoutSessionId },
              },
            })
          : null;

        if (input.checkoutSessionId && !checkout) {
          throw new NotFoundError(`Checkout session "${input.checkoutSessionId}"`);
        }

        const items = resolveItems(input, checkout?.items);
        if (items.length === 0) {
          throw new BusinessRuleError(
            "A payment result must carry order items, either inline or via a checkout session",
            "MISSING_ORDER_ITEMS",
          );
        }

        // --- 1. Customer (the only place this ever happens from WhatsApp) ---
        const { customer, created: customerCreated } = await upsertCustomerFromTerminalPayment(tx, ctx, {
          whatsappNumber,
          name: input.customer?.name ?? checkout?.customerName ?? null,
          phone: input.customer?.phone ?? null,
          email: input.customer?.email ?? null,
          address: input.customer?.address ?? input.deliveryAddress ?? checkout?.deliveryAddress ?? null,
          city: input.customer?.city ?? null,
        });

        // --- 2. Order ---
        const succeeded = input.status === "SUCCESS";
        // Three independent ways to recognise an order we have already created:
        // the caller's own reference, the cart it came from, or the payment row.
        // Any of them hitting means this is a replay, not a new order.
        const linkedOrder = input.externalOrderId
          ? await tx.order.findUnique({
              where: {
                restaurantId_externalOrderId: {
                  restaurantId: ctx.restaurantId,
                  externalOrderId: input.externalOrderId,
                },
              },
              select: { id: true },
            })
          : null;

        const resolvedOrder =
          linkedOrder ??
          (checkout
            ? await tx.order.findUnique({ where: { checkoutSessionId: checkout.id }, select: { id: true } })
            : existingPayment?.orderId
              ? await tx.order.findUnique({ where: { id: existingPayment.orderId }, select: { id: true } })
              : null);

        let order;
        let orderCreated = false;

        if (resolvedOrder) {
          // A prior attempt already produced this order (typically a failed
          // payment the customer is now retrying, or a replayed callback).
          // Re-point it at the new result rather than creating a duplicate.
          const before = await tx.order.findUniqueOrThrow({ where: { id: resolvedOrder.id } });
          order = await tx.order.update({
            where: { id: resolvedOrder.id },
            data: {
              paymentStatus: input.status,
              // A retry that succeeds revives a FAILED order. This crosses the
              // fulfilment state machine on purpose: it is a payment-axis
              // change, not a kitchen move.
              status: succeeded && before.status === "FAILED" ? "CONFIRMED" : succeeded ? before.status : "FAILED",
              confirmedAt: succeeded && !before.confirmedAt ? new Date() : before.confirmedAt,
            },
            include: ORDER_EVENT_INCLUDE,
          });
        } else {
          const orderNumber = await nextOrderNumber(tx, ctx.restaurantId, attempt);
          order = await createOrderRecord(tx, ctx, {
            customerId: customer.id,
            orderNumber,
            items,
            deliveryFee: input.deliveryFee ?? decimalToNumber(checkout?.deliveryFee),
            discount: input.discount ?? decimalToNumber(checkout?.discount),
            tax: input.tax ?? decimalToNumber(checkout?.tax),
            deliveryAddress: input.deliveryAddress ?? checkout?.deliveryAddress ?? null,
            notes: input.notes ?? null,
            status: succeeded ? "CONFIRMED" : "FAILED",
            paymentStatus: input.status,
            checkoutSessionId: checkout?.id ?? null,
            externalOrderId: input.externalOrderId ?? null,
            scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
            // The gateway charged this exact amount, so it is authoritative.
            totalAmountOverride: input.totalAmount ?? null,
          });
          orderCreated = true;
        }

        // --- 3. Payment ---
        const payment = await tx.payment.upsert({
          where: {
            restaurantId_transactionId: { restaurantId: ctx.restaurantId, transactionId: input.transactionId },
          },
          create: {
            restaurantId: ctx.restaurantId,
            customerId: customer.id,
            orderId: order.id,
            amount: money(input.amount),
            currency: input.currency,
            paymentMethod: input.paymentMethod ?? null,
            gateway: input.gateway ?? null,
            transactionId: input.transactionId,
            status: input.status,
            failureReason: input.failureReason ?? null,
            paidAt: succeeded ? (input.paidAt ? new Date(input.paidAt) : new Date()) : null,
            metadata,
          },
          update: {
            customerId: customer.id,
            orderId: order.id,
            status: input.status,
            amount: money(input.amount),
            failureReason: input.failureReason ?? null,
            paidAt: succeeded ? (input.paidAt ? new Date(input.paidAt) : new Date()) : null,
            metadata,
          },
        });

        // --- 4. Retire the temporary session ---
        if (checkout) {
          await tx.checkoutSession.update({
            where: { id: checkout.id },
            data: { status: "CONVERTED", paymentStatus: input.status },
          });
        }

        // --- 5. Delivery shell for successful, address-bearing orders ---
        if (succeeded && order.deliveryAddress) {
          await tx.delivery.upsert({
            where: { orderId: order.id },
            create: {
              restaurantId: ctx.restaurantId,
              orderId: order.id,
              deliveryAddress: order.deliveryAddress,
              status: "PENDING",
            },
            update: { deliveryAddress: order.deliveryAddress },
          });
        }

        // --- 6. Audit + events ---
        await recordAudit(tx, ctx, {
          action: succeeded ? "payment.succeeded" : "payment.failed",
          entityType: "payment",
          entityId: payment.id,
          newValue: {
            transactionId: payment.transactionId,
            amount: payment.amount.toString(),
            orderNumber: order.orderNumber,
            customerCreated,
          },
        });

        await emitEvent(tx, ctx, {
          type: succeeded ? "PAYMENT_SUCCESS" : "PAYMENT_FAILED",
          entityType: "payment",
          entityId: payment.id,
          // Same provider webhook twice -> one event row, thanks to the unique
          // (restaurantId, externalEventId) constraint.
          externalEventId: input.externalEventId ?? null,
          payload: {
            paymentId: payment.id,
            transactionId: payment.transactionId,
            status: payment.status,
            amount: payment.amount.toString(),
            currency: payment.currency,
            failureReason: payment.failureReason,
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: customer.id,
            whatsappNumber: customer.whatsappNumber,
            customerName: customer.name,
          },
        });

        // ORDER_CONFIRMED is what n8n turns into the WhatsApp confirmation.
        // Only a genuinely new (or revived) paid order earns one.
        if (succeeded && (orderCreated || order.status === "CONFIRMED")) {
          await emitEvent(tx, ctx, {
            type: "ORDER_CONFIRMED",
            entityType: "order",
            entityId: order.id,
            externalEventId: `ORDER_CONFIRMED:${order.id}`,
            payload: orderEventPayload(order),
          });
        }

        // --- 7. Refresh lifetime value / tier ---
        await recalculateCustomerStats(tx, ctx, customer.id);

        return {
          replayed: false,
          customerCreated,
          customerId: customer.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          paymentId: payment.id,
          paymentStatus: payment.status,
          orderStatus: order.status,
        };
      },
      { timeout: 15_000 },
    ),
  );
}

const ORDER_EVENT_INCLUDE = {
  items: true,
  customer: { select: { id: true, name: true, whatsappNumber: true, phone: true, customerType: true } },
  payments: { orderBy: { createdAt: "desc" } },
  delivery: { include: { driver: { select: { id: true, name: true, phone: true } } } },
  review: true,
} satisfies Prisma.OrderInclude;

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value ? new Prisma.Decimal(value).toNumber() : 0;
}

/** Inline items win; otherwise fall back to the cart the AI agent assembled. */
function resolveItems(input: PaymentResultInput, checkoutItems: Prisma.JsonValue | undefined): OrderItemInput[] {
  if (input.items?.length) return input.items;
  if (!Array.isArray(checkoutItems)) return [];

  const parsed: OrderItemInput[] = [];
  for (const raw of checkoutItems) {
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : null;
    const price = Number(item.price ?? 0);
    const quantity = Number(item.quantity ?? 0);
    // Skip malformed cart lines rather than failing the whole payment — the
    // cart is untrusted agent output, the payment result is not.
    if (!name || !Number.isFinite(price) || !Number.isInteger(quantity) || quantity < 1) continue;
    parsed.push({
      productId: typeof item.productId === "string" ? item.productId : null,
      name,
      price,
      quantity,
      notes: typeof item.notes === "string" ? item.notes : undefined,
    });
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Read + admin operations
// ---------------------------------------------------------------------------

export async function listPayments(ctx: TenantContext, input: ListPaymentsInput) {
  assertCan(ctx, "payments:read");

  const where: Prisma.PaymentWhereInput = { restaurantId: ctx.restaurantId };
  if (input.status) where.status = input.status;
  if (input.customerId) where.customerId = input.customerId;
  if (input.orderId) where.orderId = input.orderId;
  if (input.search) {
    where.OR = [
      { transactionId: { contains: input.search, mode: "insensitive" } },
      { order: { orderNumber: { contains: input.search, mode: "insensitive" } } },
      { customer: { name: { contains: input.search, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, whatsappNumber: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
      },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.payment.count({ where }),
  ]);

  return paginated(rows, total, { page: input.page, pageSize: input.pageSize });
}

export async function getPayment(ctx: TenantContext, paymentId: string) {
  assertCan(ctx, "payments:read");
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, restaurantId: ctx.restaurantId },
    include: { customer: true, order: { include: { items: true } } },
  });
  if (!payment) throw new NotFoundError("Payment");
  return payment;
}

/** Manual correction / refund marking. Never re-runs the customer-creation flow. */
export async function updatePayment(ctx: TenantContext, paymentId: string, input: UpdatePaymentInput) {
  assertCan(ctx, "payments:write");
  const existing = await prisma.payment.findFirst({
    where: { id: paymentId, restaurantId: ctx.restaurantId },
  });
  if (!existing) throw new NotFoundError("Payment");

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.update({
      where: { id: existing.id },
      data: {
        status: input.status ?? undefined,
        failureReason: input.failureReason ?? undefined,
        metadata: input.metadata ? (sanitizePaymentMetadata(input.metadata) as Prisma.InputJsonValue) : undefined,
      },
    });

    if (input.status && existing.orderId) {
      await tx.order.update({ where: { id: existing.orderId }, data: { paymentStatus: input.status } });
    }

    await recordAudit(tx, ctx, {
      action: "payment.updated",
      entityType: "payment",
      entityId: payment.id,
      oldValue: { status: existing.status },
      newValue: { status: payment.status, reason: input.failureReason ?? null },
    });

    if (payment.customerId) await recalculateCustomerStats(tx, ctx, payment.customerId);

    return payment;
  });
}

/** Used by the dashboard tiles. */
export async function paymentTotals(db: Db, restaurantId: string, from: Date, to: Date) {
  const [success, pending, failed] = await Promise.all([
    db.payment.aggregate({
      where: { restaurantId, status: "SUCCESS", createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.payment.count({ where: { restaurantId, status: "PENDING" } }),
    db.payment.count({ where: { restaurantId, status: "FAILED", createdAt: { gte: from, lte: to } } }),
  ]);

  return {
    revenue: new Prisma.Decimal(success._sum.amount ?? 0),
    successCount: success._count._all,
    pendingCount: pending,
    failedCount: failed,
  };
}
