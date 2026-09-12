import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma, type Db } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { BusinessRuleError, NotFoundError } from "@/server/core/errors";
import { assertCan } from "@/server/auth/permissions";
import { money } from "@/lib/money";
import { paginated } from "@/server/core/pagination";
import { emitEvent } from "@/server/events/emit";
import { recordAudit } from "@/server/audit/audit";
import { recalculateCustomerStats } from "@/server/modules/customers/customer.service";
import { assertTransition, BOARD_STATUSES, STATUS_EVENT, STATUS_TIMESTAMP_FIELD } from "./order.status";
import type { CreateOrderInput, ListOrdersInput, OrderItemInput, UpdateOrderInput } from "./order.schema";

const ORDER_INCLUDE = {
  items: true,
  customer: { select: { id: true, name: true, whatsappNumber: true, phone: true, customerType: true } },
  payments: { orderBy: { createdAt: "desc" } },
  delivery: { include: { driver: { select: { id: true, name: true, phone: true } } } },
  review: true,
} satisfies Prisma.OrderInclude;

/**
 * Human-friendly, per-restaurant-per-day sequence: ORD-260912-0007.
 *
 * The next number comes from the highest number already issued for today's
 * prefix, NOT from a row count — counting breaks the moment an order is
 * deleted, archived or backdated, and would then propose a number that is
 * already taken. Uniqueness itself is enforced by the
 * (restaurantId, orderNumber) constraint, with the caller retrying on
 * collision; that is the only fully race-safe approach short of a dedicated
 * sequence table.
 */
export async function nextOrderNumber(db: Db, restaurantId: string, attempt = 0) {
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `ORD-${stamp}-`;

  // Zero-padded suffixes sort lexicographically the same way they sort
  // numerically, so "highest string" is also "highest number".
  const latest = await db.order.findFirst({
    where: { restaurantId, orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  const lastSequence = latest ? Number.parseInt(latest.orderNumber.slice(prefix.length), 10) : 0;
  const next = (Number.isFinite(lastSequence) ? lastSequence : 0) + 1 + attempt;

  return `${prefix}${String(next).padStart(4, "0")}`;
}

/**
 * Unique constraints that two concurrent writers can legitimately collide on.
 * Retrying the whole transaction converges: the loser of the race re-reads and
 * finds the row the winner just committed.
 *
 * A Postgres transaction is poisoned once a statement fails, so the retry has
 * to happen at the transaction boundary — catching P2002 inside the callback
 * and re-reading would fail with "current transaction is aborted".
 */
const RETRYABLE_CONSTRAINTS = ["order_number", "whatsapp_number", "transaction_id", "checkout_session_id"];

export async function withConcurrencyRetry<T>(work: (attempt: number) => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (error.meta?.target as string[] | undefined)?.some((target) =>
          RETRYABLE_CONSTRAINTS.some((constraint) => target.includes(constraint)),
        );
      if (!retryable) throw error;
      lastError = error;
      // Small jittered backoff so racing writers do not re-collide in lockstep.
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 15));
    }
  }
  throw lastError;
}

export function computeOrderTotals(items: OrderItemInput[], deliveryFee = 0, discount = 0, tax = 0) {
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
    totalAmount: money(total.isNegative() ? 0 : total),
  };
}

/**
 * Low-level order writer shared by the manual flow and the payment flow.
 * Must be called inside a transaction.
 *
 * Item rows store a NAME and PRICE SNAPSHOT: re-pricing the menu tomorrow must
 * not rewrite what a customer was charged today.
 */
export async function createOrderRecord(
  db: Db,
  ctx: TenantContext,
  input: {
    customerId: string;
    orderNumber: string;
    items: OrderItemInput[];
    deliveryFee?: number;
    discount?: number;
    tax?: number;
    deliveryAddress?: string | null;
    notes?: string | null;
    status?: OrderStatus;
    paymentStatus?: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
    checkoutSessionId?: string | null;
    /** Caller's own order reference — unique per restaurant. */
    externalOrderId?: string | null;
    /** When the customer wants it (scheduled/pre-orders). */
    scheduledFor?: Date | null;
    /** Overrides the computed total, e.g. the exact amount a gateway charged. */
    totalAmountOverride?: number | null;
  },
) {
  const totals = computeOrderTotals(input.items, input.deliveryFee, input.discount, input.tax);
  const status = input.status ?? "CONFIRMED";

  return db.order.create({
    data: {
      restaurantId: ctx.restaurantId,
      orderNumber: input.orderNumber,
      customerId: input.customerId,
      checkoutSessionId: input.checkoutSessionId ?? null,
      externalOrderId: input.externalOrderId ?? null,
      status,
      paymentStatus: input.paymentStatus ?? "PENDING",
      ...totals,
      // A gateway-reported total wins over our arithmetic: that is the amount
      // the customer was actually charged, and the order must reflect it.
      ...(input.totalAmountOverride === undefined || input.totalAmountOverride === null
        ? {}
        : { totalAmount: money(input.totalAmountOverride) }),
      deliveryAddress: input.deliveryAddress ?? null,
      scheduledFor: input.scheduledFor ?? null,
      notes: input.notes ?? null,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
      items: {
        create: input.items.map((item) => ({
          restaurantId: ctx.restaurantId,
          productId: item.productId ?? null,
          productNameSnapshot: item.name,
          unitPriceSnapshot: money(item.price),
          quantity: item.quantity,
          total: money(money(item.price).times(item.quantity)),
          modifiers: item.modifiers?.length ? item.modifiers : undefined,
          notes: item.notes ?? null,
        })),
      },
    },
    include: ORDER_INCLUDE,
  });
}

export async function createOrder(ctx: TenantContext, input: CreateOrderInput) {
  assertCan(ctx, "orders:write");

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, restaurantId: ctx.restaurantId },
  });
  if (!customer) throw new NotFoundError("Customer");

  return withConcurrencyRetry((attempt) =>
    prisma.$transaction(async (tx) => {
      const orderNumber = await nextOrderNumber(tx, ctx.restaurantId, attempt);
      const order = await createOrderRecord(tx, ctx, {
        ...input,
        orderNumber,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        totalAmountOverride: input.totalAmount ?? null,
      });

      await recordAudit(tx, ctx, {
        action: "order.created",
        entityType: "order",
        entityId: order.id,
        newValue: { orderNumber: order.orderNumber, total: order.totalAmount.toString(), source: "manual" },
      });

      await emitEvent(tx, ctx, {
        type: "ORDER_CONFIRMED",
        entityType: "order",
        entityId: order.id,
        payload: orderEventPayload(order),
      });

      if (order.paymentStatus === "SUCCESS") {
        await recalculateCustomerStats(tx, ctx, order.customerId);
      }

      return order;
    }),
  );
}

export function orderEventPayload(order: Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalAmount: order.totalAmount.toString(),
    currency: "INR",
    deliveryAddress: order.deliveryAddress,
    customer: {
      id: order.customer.id,
      name: order.customer.name,
      whatsappNumber: order.customer.whatsappNumber,
    },
    items: order.items.map((item) => ({
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot.toString(),
      total: item.total.toString(),
    })),
  };
}

export async function listOrders(ctx: TenantContext, input: ListOrdersInput) {
  assertCan(ctx, "orders:read");

  const where: Prisma.OrderWhereInput = { restaurantId: ctx.restaurantId };
  if (input.status) where.status = input.status;
  if (input.paymentStatus) where.paymentStatus = input.paymentStatus;
  if (input.customerId) where.customerId = input.customerId;
  if (input.from || input.to) {
    where.createdAt = {
      ...(input.from ? { gte: new Date(input.from) } : {}),
      ...(input.to ? { lte: new Date(input.to) } : {}),
    };
  }
  if (input.search) {
    where.OR = [
      { orderNumber: { contains: input.search, mode: "insensitive" } },
      { customer: { name: { contains: input.search, mode: "insensitive" } } },
      { customer: { whatsappNumber: { contains: input.search.replace(/\D/g, "") || input.search } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: ORDER_INCLUDE,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return paginated(rows, total, { page: input.page, pageSize: input.pageSize });
}

export async function getOrder(ctx: TenantContext, orderId: string) {
  assertCan(ctx, "orders:read");
  const order = await prisma.order.findFirst({
    where: { restaurantId: ctx.restaurantId, OR: [{ id: orderId }, { orderNumber: orderId }] },
    include: ORDER_INCLUDE,
  });
  if (!order) throw new NotFoundError("Order");
  return order;
}

/** The order's own history, read straight out of the audit + event tables. */
export async function getOrderTimeline(ctx: TenantContext, orderId: string) {
  const [events, audits] = await Promise.all([
    prisma.event.findMany({
      where: { restaurantId: ctx.restaurantId, entityType: { in: ["order", "review"] }, entityId: orderId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { restaurantId: ctx.restaurantId, entityType: "order", entityId: orderId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true } } },
    }),
  ]);
  return { events, audits };
}

/** Board data for the Kanban view: one query, grouped in memory. */
export async function getOrderBoard(ctx: TenantContext, limitPerColumn = 40) {
  assertCan(ctx, "orders:read");

  // Delivered is noisy — only show today's, so the column stays useful.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const orders = await prisma.order.findMany({
    where: {
      restaurantId: ctx.restaurantId,
      OR: [
        { status: { in: ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] } },
        { status: "DELIVERED", deliveredAt: { gte: startOfDay } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: ORDER_INCLUDE,
  });

  const columns = BOARD_STATUSES.map((status) => ({
    status,
    orders: orders.filter((o) => o.status === status).slice(0, limitPerColumn),
    total: orders.filter((o) => o.status === status).length,
  }));

  return columns;
}

export type BoardColumn = Awaited<ReturnType<typeof getOrderBoard>>[number];

/**
 * The single entry point for every fulfilment status change — the Kanban board,
 * the [ORDER IS READY] button, the delivery screen and the n8n API all come
 * through here, so validation, timestamps, audit and events can never diverge.
 */
export async function changeOrderStatus(
  ctx: TenantContext,
  orderId: string,
  nextStatus: OrderStatus,
  options: { reason?: string; skipPermissionCheck?: boolean } = {},
) {
  if (!options.skipPermissionCheck) {
    assertCan(ctx, nextStatus === "CANCELLED" ? "orders:cancel" : "orders:status");
  }

  const existing = await prisma.order.findFirst({
    where: { id: orderId, restaurantId: ctx.restaurantId },
    select: { id: true, status: true, orderNumber: true, customerId: true, paymentStatus: true },
  });
  if (!existing) throw new NotFoundError("Order");

  assertTransition(existing.status, nextStatus);

  if (nextStatus === "OUT_FOR_DELIVERY" && existing.paymentStatus === "FAILED") {
    throw new BusinessRuleError(
      "This order's payment failed — it cannot be dispatched until payment succeeds",
      "PAYMENT_NOT_SETTLED",
    );
  }

  return prisma.$transaction(async (tx) => {
    const timestampField = STATUS_TIMESTAMP_FIELD[nextStatus];
    const order = await tx.order.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
      },
      include: ORDER_INCLUDE,
    });

    await recordAudit(tx, ctx, {
      action: "order.status_changed",
      entityType: "order",
      entityId: order.id,
      oldValue: { status: existing.status },
      newValue: { status: nextStatus, reason: options.reason ?? null },
    });

    const eventType = STATUS_EVENT[nextStatus];
    if (eventType) {
      await emitEvent(tx, ctx, {
        type: eventType,
        entityType: "order",
        entityId: order.id,
        payload: { ...orderEventPayload(order), previousStatus: existing.status, reason: options.reason ?? null },
      });
    }

    // A cancelled order stops counting towards lifetime value.
    if (nextStatus === "CANCELLED" || nextStatus === "DELIVERED") {
      await recalculateCustomerStats(tx, ctx, order.customerId);
    }

    // Keep the delivery record in step with the order it belongs to.
    if (nextStatus === "OUT_FOR_DELIVERY" || nextStatus === "DELIVERED") {
      await tx.delivery.updateMany({
        where: { orderId: order.id, restaurantId: ctx.restaurantId },
        data:
          nextStatus === "DELIVERED"
            ? { status: "DELIVERED", deliveredAt: new Date() }
            : { status: "OUT_FOR_DELIVERY", dispatchedAt: new Date() },
      });
    }

    return order;
  });
}

/**
 * [ ORDER IS READY ] — the button the kitchen presses.
 * Thin wrapper so the intent is explicit in the audit trail and at the call
 * site; all the machinery lives in changeOrderStatus.
 */
export async function markOrderReady(ctx: TenantContext, orderId: string) {
  return changeOrderStatus(ctx, orderId, "READY");
}

export async function cancelOrder(ctx: TenantContext, orderId: string, reason?: string) {
  return changeOrderStatus(ctx, orderId, "CANCELLED", { reason });
}

export async function updateOrder(ctx: TenantContext, orderId: string, input: UpdateOrderInput) {
  const existing = await getOrder(ctx, orderId);

  if (input.deliveryAddress !== undefined || input.notes !== undefined) {
    assertCan(ctx, "orders:write");
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: existing.id },
        data: { deliveryAddress: input.deliveryAddress ?? undefined, notes: input.notes ?? undefined },
      });
      await recordAudit(tx, ctx, {
        action: "order.updated",
        entityType: "order",
        entityId: existing.id,
        oldValue: { deliveryAddress: existing.deliveryAddress, notes: existing.notes },
        newValue: { deliveryAddress: input.deliveryAddress, notes: input.notes },
      });
    });
  }

  if (input.status && input.status !== existing.status) {
    return changeOrderStatus(ctx, existing.id, input.status, { reason: input.reason });
  }

  return getOrder(ctx, existing.id);
}
