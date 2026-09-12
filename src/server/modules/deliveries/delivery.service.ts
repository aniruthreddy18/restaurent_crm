import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/server/core/errors";
import { can } from "@/server/auth/permissions";
import { paginated } from "@/server/core/pagination";
import { recordAudit } from "@/server/audit/audit";
import { changeOrderStatus, getOrder } from "@/server/modules/orders/order.service";
import type { CreateDeliveryInput, ListDeliveriesInput, UpdateDeliveryInput } from "./delivery.schema";

/**
 * Delivery V1 is deliberately small: READY -> OUT_FOR_DELIVERY -> DELIVERED,
 * plus who is carrying it. No GPS, no routing, no location streaming.
 *
 * `deliveries.latitude/longitude` exist in the schema but are never written —
 * they are the seam a future tracking version plugs into without a migration.
 */

const DELIVERY_INCLUDE = {
  driver: { select: { id: true, name: true, phone: true } },
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      totalAmount: true,
      deliveryAddress: true,
      createdAt: true,
      readyAt: true,
      customer: { select: { id: true, name: true, whatsappNumber: true, phone: true } },
      items: { select: { productNameSnapshot: true, quantity: true } },
    },
  },
} satisfies Prisma.DeliveryInclude;

/** Resolves the driver profile of the signed-in user, if they have one. */
async function currentDriverId(ctx: TenantContext) {
  if (!ctx.userId) return null;
  const driver = await prisma.deliveryDriver.findFirst({
    where: { restaurantId: ctx.restaurantId, userId: ctx.userId },
    select: { id: true },
  });
  return driver?.id ?? null;
}

/**
 * Authorisation for a single delivery. A DELIVERY-role user may only touch
 * rows assigned to them; managers and admins see everything.
 */
async function assertDeliveryAccess(ctx: TenantContext, delivery: { driverId: string | null }) {
  if (can(ctx.role, "deliveries:write") || can(ctx.role, "deliveries:read")) return;
  if (!can(ctx.role, "deliveries:assigned")) {
    throw new ForbiddenError("You do not have access to deliveries");
  }
  const driverId = await currentDriverId(ctx);
  if (!driverId || delivery.driverId !== driverId) {
    throw new ForbiddenError("This delivery is not assigned to you");
  }
}

export async function listDeliveries(ctx: TenantContext, input: ListDeliveriesInput) {
  const isDriverOnly = !can(ctx.role, "deliveries:read") && can(ctx.role, "deliveries:assigned");
  if (!isDriverOnly && !can(ctx.role, "deliveries:read")) {
    throw new ForbiddenError("You do not have access to deliveries");
  }

  const where: Prisma.DeliveryWhereInput = { restaurantId: ctx.restaurantId };
  if (input.status) where.status = input.status;
  if (input.driverId) where.driverId = input.driverId;

  // Drivers are hard-scoped to their own work regardless of query parameters.
  if (isDriverOnly || input.scope === "me") {
    const driverId = await currentDriverId(ctx);
    where.driverId = driverId ?? "__no_driver_profile__";
  }

  const [rows, total] = await Promise.all([
    prisma.delivery.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: DELIVERY_INCLUDE,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.delivery.count({ where }),
  ]);

  return paginated(rows, total, { page: input.page, pageSize: input.pageSize });
}

export async function getDelivery(ctx: TenantContext, deliveryId: string) {
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, restaurantId: ctx.restaurantId },
    include: DELIVERY_INCLUDE,
  });
  if (!delivery) throw new NotFoundError("Delivery");
  await assertDeliveryAccess(ctx, delivery);
  return delivery;
}

export async function createDelivery(ctx: TenantContext, input: CreateDeliveryInput) {
  if (!can(ctx.role, "deliveries:write")) throw new ForbiddenError("You cannot create deliveries");
  const order = await getOrder(ctx, input.orderId);

  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.upsert({
      where: { orderId: order.id },
      create: {
        restaurantId: ctx.restaurantId,
        orderId: order.id,
        driverId: input.driverId ?? null,
        deliveryAddress: input.deliveryAddress ?? order.deliveryAddress,
        notes: input.notes ?? null,
        status: input.driverId ? "ASSIGNED" : "PENDING",
        assignedAt: input.driverId ? new Date() : null,
      },
      update: {
        driverId: input.driverId ?? null,
        deliveryAddress: input.deliveryAddress ?? order.deliveryAddress,
        notes: input.notes ?? undefined,
        status: input.driverId ? "ASSIGNED" : undefined,
        assignedAt: input.driverId ? new Date() : undefined,
      },
      include: DELIVERY_INCLUDE,
    });

    await recordAudit(tx, ctx, {
      action: "delivery.created",
      entityType: "delivery",
      entityId: delivery.id,
      newValue: { orderNumber: order.orderNumber, driverId: delivery.driverId },
    });

    return delivery;
  });
}

export async function assignDriver(ctx: TenantContext, deliveryId: string, driverId: string | null) {
  if (!can(ctx.role, "deliveries:write")) throw new ForbiddenError("You cannot assign drivers");

  const existing = await prisma.delivery.findFirst({
    where: { id: deliveryId, restaurantId: ctx.restaurantId },
  });
  if (!existing) throw new NotFoundError("Delivery");

  if (driverId) {
    const driver = await prisma.deliveryDriver.findFirst({
      where: { id: driverId, restaurantId: ctx.restaurantId, isActive: true },
    });
    if (!driver) throw new NotFoundError("Delivery driver");
  }

  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.update({
      where: { id: existing.id },
      data: {
        driverId,
        status: driverId && existing.status === "PENDING" ? "ASSIGNED" : existing.status,
        assignedAt: driverId ? new Date() : null,
      },
      include: DELIVERY_INCLUDE,
    });

    await recordAudit(tx, ctx, {
      action: "delivery.driver_assigned",
      entityType: "delivery",
      entityId: delivery.id,
      oldValue: { driverId: existing.driverId },
      newValue: { driverId },
    });

    return delivery;
  });
}

/**
 * Dispatch: READY -> OUT_FOR_DELIVERY. Drives the order status change, which
 * is what emits ORDER_OUT_FOR_DELIVERY for n8n.
 */
export async function dispatchDelivery(ctx: TenantContext, deliveryId: string) {
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, restaurantId: ctx.restaurantId },
    include: { order: { select: { id: true, status: true } } },
  });
  if (!delivery) throw new NotFoundError("Delivery");
  await assertDeliveryAccess(ctx, delivery);

  if (delivery.order.status !== "READY") {
    throw new BusinessRuleError(
      `Order must be READY before dispatch (currently ${delivery.order.status})`,
      "ORDER_NOT_READY",
    );
  }

  // Drivers legitimately move their own deliveries even though they lack the
  // general orders:status permission — access was checked above.
  await changeOrderStatus(ctx, delivery.order.id, "OUT_FOR_DELIVERY", { skipPermissionCheck: true });
  return getDelivery(ctx, deliveryId);
}

/**
 * [ MARK DELIVERED ] — the button delivery staff press.
 *
 * Sets delivery + order status, stamps the delivery time, writes the audit row
 * and produces the ORDER_DELIVERED event that n8n turns into the "your order
 * has been delivered" message and the rating request.
 */
export async function markDelivered(ctx: TenantContext, deliveryId: string, notes?: string) {
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, restaurantId: ctx.restaurantId },
    include: { order: { select: { id: true, status: true, orderNumber: true } } },
  });
  if (!delivery) throw new NotFoundError("Delivery");
  await assertDeliveryAccess(ctx, delivery);

  if (delivery.status === "DELIVERED") {
    // Double-tap on a phone must not produce a second event.
    return getDelivery(ctx, deliveryId);
  }
  if (delivery.order.status !== "OUT_FOR_DELIVERY") {
    throw new BusinessRuleError(
      `Order must be OUT_FOR_DELIVERY before it can be marked delivered (currently ${delivery.order.status})`,
      "ORDER_NOT_DISPATCHED",
    );
  }

  const deliveredAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: delivery.id },
      data: { status: "DELIVERED", deliveredAt, notes: notes ?? undefined },
    });
    await recordAudit(tx, ctx, {
      action: "delivery.marked_delivered",
      entityType: "delivery",
      entityId: delivery.id,
      oldValue: { status: delivery.status },
      newValue: { status: "DELIVERED", orderNumber: delivery.order.orderNumber, deliveredAt: deliveredAt.toISOString() },
    });
  });

  // Emits ORDER_DELIVERED.
  await changeOrderStatus(ctx, delivery.order.id, "DELIVERED", { skipPermissionCheck: true });

  return getDelivery(ctx, deliveryId);
}

export async function updateDelivery(ctx: TenantContext, deliveryId: string, input: UpdateDeliveryInput) {
  const existing = await prisma.delivery.findFirst({
    where: { id: deliveryId, restaurantId: ctx.restaurantId },
  });
  if (!existing) throw new NotFoundError("Delivery");
  await assertDeliveryAccess(ctx, existing);

  if (input.driverId !== undefined) await assignDriver(ctx, deliveryId, input.driverId);

  if (input.status === "OUT_FOR_DELIVERY") return dispatchDelivery(ctx, deliveryId);
  if (input.status === "DELIVERED") return markDelivered(ctx, deliveryId, input.notes);

  if (input.status === "FAILED") {
    if (!can(ctx.role, "deliveries:write") && !can(ctx.role, "deliveries:assigned")) {
      throw new ForbiddenError("You cannot fail a delivery");
    }
    await prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: existing.id },
        data: { status: "FAILED", failureReason: input.failureReason ?? null, notes: input.notes ?? undefined },
      });
      await recordAudit(tx, ctx, {
        action: "delivery.failed",
        entityType: "delivery",
        entityId: existing.id,
        oldValue: { status: existing.status },
        newValue: { status: "FAILED", reason: input.failureReason ?? null },
      });
    });
    return getDelivery(ctx, deliveryId);
  }

  if (input.deliveryAddress !== undefined || input.notes !== undefined) {
    await prisma.delivery.update({
      where: { id: existing.id },
      data: { deliveryAddress: input.deliveryAddress ?? undefined, notes: input.notes ?? undefined },
    });
  }

  return getDelivery(ctx, deliveryId);
}

export async function listDrivers(ctx: TenantContext) {
  return prisma.deliveryDriver.findMany({
    where: { restaurantId: ctx.restaurantId, isActive: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { deliveries: true } } },
  });
}
