/**
 * Role-based access control. A role that lacks a permission must be refused at
 * the service layer — not merely hidden in the UI.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { can, ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";
import { changeOrderStatus, markOrderReady, cancelOrder, listOrders } from "@/server/modules/orders/order.service";
import { listCustomers } from "@/server/modules/customers/customer.service";
import { listPayments } from "@/server/modules/payments/payment.service";
import { updateProduct, createProduct } from "@/server/modules/menu/menu.service";
import { markDelivered } from "@/server/modules/deliveries/delivery.service";
import { ForbiddenError } from "@/server/core/errors";
import { CART_TOTAL, cartItems, createStaffUser, createTenant, resetDatabase, type Tenant } from "./helpers";

let tenant: Tenant;
let orderId: string;

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant();
  const result = await recordPaymentResult(tenant.ctx, {
    transactionId: "txn-1",
    status: "SUCCESS",
    amount: CART_TOTAL,
    currency: "INR",
    whatsappNumber: "919876543210",
    items: cartItems(),
    deliveryAddress: "1 Test Road",
  });
  orderId = result.orderId!;
});

describe("the role matrix", () => {
  it("gives ADMIN everything and DELIVERY almost nothing", () => {
    expect(can("ADMIN", "settings:write")).toBe(true);
    expect(can("ADMIN", "orders:cancel")).toBe(true);

    expect(can("DELIVERY", "deliveries:assigned")).toBe(true);
    expect(can("DELIVERY", "orders:read")).toBe(true);
    expect(can("DELIVERY", "payments:read")).toBe(false);
    expect(can("DELIVERY", "customers:read")).toBe(false);
    expect(can("DELIVERY", "orders:status")).toBe(false);
  });

  it("keeps KITCHEN away from money and customers", () => {
    expect(can("KITCHEN", "orders:status")).toBe(true);
    expect(can("KITCHEN", "menu:availability")).toBe(true);
    expect(can("KITCHEN", "menu:write")).toBe(false);
    expect(can("KITCHEN", "payments:read")).toBe(false);
    expect(can("KITCHEN", "customers:read")).toBe(false);
  });

  it("gives CASHIER orders and payments but not staff or settings", () => {
    expect(can("CASHIER", "payments:write")).toBe(true);
    expect(can("CASHIER", "orders:write")).toBe(true);
    expect(can("CASHIER", "staff:write")).toBe(false);
    expect(can("CASHIER", "settings:write")).toBe(false);
  });

  it("stops MANAGER short of staff creation and settings changes", () => {
    expect(can("MANAGER", "analytics:read")).toBe(true);
    expect(can("MANAGER", "orders:cancel")).toBe(true);
    expect(can("MANAGER", "staff:write")).toBe(false);
    expect(can("MANAGER", "settings:write")).toBe(false);
  });

  it("defines a permission set for every role", () => {
    for (const role of ["ADMIN", "MANAGER", "KITCHEN", "CASHIER", "DELIVERY"] as const) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });
});

describe("unauthorised users cannot change order status", () => {
  it("refuses a DELIVERY user pressing [ORDER IS READY]", async () => {
    const ctx = tenant.contextFor("DELIVERY");
    await expect(markOrderReady(ctx, orderId)).rejects.toBeInstanceOf(ForbiddenError);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("CONFIRMED");
  });

  it("refuses a KITCHEN user cancelling an order", async () => {
    const ctx = tenant.contextFor("KITCHEN");
    await expect(cancelOrder(ctx, orderId, "nope")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows a KITCHEN user to advance the order", async () => {
    const ctx = tenant.contextFor("KITCHEN");
    const order = await changeOrderStatus(ctx, orderId, "PREPARING");
    expect(order.status).toBe("PREPARING");
  });

  it("refuses a DELIVERY user reading customers or payments", async () => {
    const ctx = tenant.contextFor("DELIVERY");
    await expect(listCustomers(ctx, { page: 1, pageSize: 10, sort: "recent" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPayments(ctx, { page: 1, pageSize: 10 })).rejects.toBeInstanceOf(ForbiddenError);
    // Reading orders is allowed — a driver needs to know what they are carrying.
    await expect(listOrders(ctx, { page: 1, pageSize: 10 })).resolves.toBeTruthy();
  });
});

describe("menu permissions", () => {
  it("lets KITCHEN flip availability but not edit a price", async () => {
    const product = await createProduct(tenant.ctx, {
      name: "Butter Chicken",
      price: 420,
      isAvailable: true,
    });

    const ctx = tenant.contextFor("KITCHEN");
    const updated = await updateProduct(ctx, product.id, { isAvailable: false });
    expect(updated.isAvailable).toBe(false);

    await expect(updateProduct(ctx, product.id, { price: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createProduct(ctx, { name: "Sneaky", price: 1, isAvailable: true })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("delivery scoping", () => {
  it("lets a driver complete only their own assignment", async () => {
    const assigned = await createStaffUser(tenant.restaurantId, "DELIVERY", "driver-a@test.local");
    const other = await createStaffUser(tenant.restaurantId, "DELIVERY", "driver-b@test.local");

    const assignedDriver = await prisma.deliveryDriver.create({
      data: { restaurantId: tenant.restaurantId, userId: assigned.id, name: "Driver A", phone: "1" },
    });
    await prisma.deliveryDriver.create({
      data: { restaurantId: tenant.restaurantId, userId: other.id, name: "Driver B", phone: "2" },
    });

    const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId } });
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: { driverId: assignedDriver.id, status: "ASSIGNED" },
    });

    await changeOrderStatus(tenant.ctx, orderId, "PREPARING");
    await changeOrderStatus(tenant.ctx, orderId, "READY");
    await changeOrderStatus(tenant.ctx, orderId, "OUT_FOR_DELIVERY");

    const otherCtx = tenant.contextFor("DELIVERY", other.id);
    await expect(markDelivered(otherCtx, delivery.id)).rejects.toBeInstanceOf(ForbiddenError);

    const assignedCtx = tenant.contextFor("DELIVERY", assigned.id);
    const done = await markDelivered(assignedCtx, delivery.id);
    expect(done.status).toBe("DELIVERED");
  });
});
