import { Prisma } from "@prisma/client";
import { prisma, type Db } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { BusinessRuleError, NotFoundError } from "@/server/core/errors";
import { assertCan } from "@/server/auth/permissions";
import { normalizeWhatsAppNumber } from "@/lib/phone";
import { paginated, type Paginated } from "@/server/core/pagination";
import { emitEvent } from "@/server/events/emit";
import { recordAudit } from "@/server/audit/audit";
import { deriveCustomerType, tierConfigFromSettings } from "./customer.rules";
import type { CreateCustomerInput, ListCustomersInput, UpdateCustomerInput } from "./customer.schema";

function countryCode() {
  return process.env.DEFAULT_COUNTRY_CODE ?? "91";
}

/**
 * THE CORE BUSINESS RULE.
 *
 * This is the ONLY function in the codebase that brings a permanent customer
 * into existence from a WhatsApp interaction, and it is called from exactly one
 * place: the terminal-payment flow in payment.service.ts. Chatting, browsing
 * the menu, building a cart or abandoning checkout never reach it.
 *
 * Must run inside a transaction — the customer, order and payment it anchors
 * commit together or not at all.
 */
export async function upsertCustomerFromTerminalPayment(
  db: Db,
  ctx: TenantContext,
  input: {
    whatsappNumber: string;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
  },
): Promise<{ customer: Awaited<ReturnType<Db["customer"]["findFirstOrThrow"]>>; created: boolean }> {
  const whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber, countryCode());

  const existing = await db.customer.findUnique({
    where: { restaurantId_whatsappNumber: { restaurantId: ctx.restaurantId, whatsappNumber } },
  });

  if (existing) {
    // Never overwrite known details with blanks — WhatsApp payloads are patchy.
    const patch: Prisma.CustomerUpdateInput = {};
    if (input.name && input.name !== existing.name) patch.name = input.name;
    if (input.phone && input.phone !== existing.phone) patch.phone = input.phone;
    if (input.email && input.email !== existing.email) patch.email = input.email;
    if (input.address && input.address !== existing.address) patch.address = input.address;
    if (input.city && input.city !== existing.city) patch.city = input.city;

    const customer = Object.keys(patch).length
      ? await db.customer.update({ where: { id: existing.id }, data: patch })
      : existing;

    return { customer, created: false };
  }

  const customer = await db.customer.create({
    data: {
      restaurantId: ctx.restaurantId,
      whatsappNumber,
      name: input.name ?? null,
      phone: input.phone ?? whatsappNumber,
      email: input.email || null,
      address: input.address ?? null,
      city: input.city ?? null,
      customerType: "NEW",
    },
  });

  await recordAudit(db, ctx, {
    action: "customer.created",
    entityType: "customer",
    entityId: customer.id,
    newValue: { whatsappNumber, name: customer.name, reason: "terminal_payment_result" },
  });

  await emitEvent(db, ctx, {
    type: "CUSTOMER_CREATED",
    entityType: "customer",
    entityId: customer.id,
    payload: {
      customerId: customer.id,
      whatsappNumber: customer.whatsappNumber,
      name: customer.name,
      customerType: customer.customerType,
    },
  });

  // Any conversation already open for this number now has a customer behind it.
  await db.conversationSession.updateMany({
    where: { restaurantId: ctx.restaurantId, whatsappNumber, customerId: null },
    data: { customerId: customer.id },
  });
  await db.message.updateMany({
    where: { restaurantId: ctx.restaurantId, whatsappNumber, customerId: null },
    data: { customerId: customer.id },
  });

  return { customer, created: true };
}

/**
 * Recomputes commercial aggregates from the orders table rather than
 * incrementing counters. Recomputation is naturally idempotent, so a replayed
 * webhook cannot inflate a customer's lifetime value.
 */
export async function recalculateCustomerStats(db: Db, ctx: TenantContext, customerId: string) {
  const restaurant = await db.restaurant.findUniqueOrThrow({
    where: { id: ctx.restaurantId },
    select: { settings: true },
  });

  // Only paid, non-cancelled orders count towards lifetime value.
  const where: Prisma.OrderWhereInput = {
    restaurantId: ctx.restaurantId,
    customerId,
    paymentStatus: "SUCCESS",
    status: { notIn: ["CANCELLED", "FAILED"] },
  };

  const [aggregate, first, last] = await Promise.all([
    db.order.aggregate({ where, _count: { _all: true }, _sum: { totalAmount: true } }),
    db.order.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.order.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const totalOrders = aggregate._count._all;
  const totalSpent = new Prisma.Decimal(aggregate._sum.totalAmount ?? 0);
  const averageOrderValue = totalOrders
    ? totalSpent.dividedBy(totalOrders).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : new Prisma.Decimal(0);

  const customerType = deriveCustomerType(
    { totalOrders, totalSpent, lastOrderAt: last?.createdAt ?? null },
    tierConfigFromSettings(restaurant.settings),
  );

  return db.customer.update({
    where: { id: customerId },
    data: {
      totalOrders,
      totalSpent,
      averageOrderValue,
      firstOrderAt: first?.createdAt ?? null,
      lastOrderAt: last?.createdAt ?? null,
      customerType,
    },
  });
}

export async function listCustomers(ctx: TenantContext, input: ListCustomersInput): Promise<Paginated<CustomerListRow>> {
  assertCan(ctx, "customers:read");

  const where: Prisma.CustomerWhereInput = { restaurantId: ctx.restaurantId };
  if (input.customerType) where.customerType = input.customerType;
  if (input.city) where.city = { equals: input.city, mode: "insensitive" };
  if (input.search) {
    const term = input.search.trim();
    // Search the normalised number too, so "+91 98765 43210" finds the record.
    let normalized: string | null = null;
    try {
      normalized = normalizeWhatsAppNumber(term, countryCode());
    } catch {
      normalized = null;
    }
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { phone: { contains: term.replace(/\D/g, "") || term } },
      { whatsappNumber: { contains: normalized ?? (term.replace(/\D/g, "") || term) } },
    ];
  }

  const orderBy: Prisma.CustomerOrderByWithRelationInput =
    input.sort === "spend"
      ? { totalSpent: "desc" }
      : input.sort === "orders"
        ? { totalOrders: "desc" }
        : input.sort === "name"
          ? { name: "asc" }
          : { lastOrderAt: { sort: "desc", nulls: "last" } };

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.customer.count({ where }),
  ]);

  return paginated(rows, total, { page: input.page, pageSize: input.pageSize });
}

export type CustomerListRow = Prisma.CustomerGetPayload<Record<string, never>>;

/**
 * Look up a customer by phone/WhatsApp number. Lookup ONLY — it never creates,
 * so n8n can safely call it on every turn of a conversation without putting a
 * permanent record in the CRM for someone who is only asking questions.
 *
 * The number is normalised first, so "+91 98765 43210", "09876543210" and
 * "919876543210" all resolve to the same person.
 */
export async function findCustomerByPhone(ctx: TenantContext, rawNumber: string) {
  assertCan(ctx, "customers:read");

  let whatsappNumber: string;
  try {
    whatsappNumber = normalizeWhatsAppNumber(rawNumber, countryCode());
  } catch {
    // An unparseable number is a bad request, not a missing customer.
    throw new BusinessRuleError(`"${rawNumber}" is not a valid phone number`, "INVALID_PHONE_NUMBER");
  }

  const customer = await prisma.customer.findUnique({
    where: { restaurantId_whatsappNumber: { restaurantId: ctx.restaurantId, whatsappNumber } },
  });

  return { customer, whatsappNumber };
}

export async function getCustomer(ctx: TenantContext, customerId: string) {
  assertCan(ctx, "customers:read");
  // restaurantId in the WHERE is the tenant boundary — an id from another
  // restaurant simply does not match.
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, restaurantId: ctx.restaurantId },
  });
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}

/** Full profile: history, payments, reviews and a merged activity timeline. */
export async function getCustomerProfile(ctx: TenantContext, customerId: string) {
  const customer = await getCustomer(ctx, customerId);

  const [orders, payments, reviews, events] = await Promise.all([
    prisma.order.findMany({
      where: { restaurantId: ctx.restaurantId, customerId },
      orderBy: { createdAt: "desc" },
      include: { items: true, delivery: true },
      take: 50,
    }),
    prisma.payment.findMany({
      where: { restaurantId: ctx.restaurantId, customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.review.findMany({
      where: { restaurantId: ctx.restaurantId, customerId },
      orderBy: { createdAt: "desc" },
      include: { order: { select: { orderNumber: true } } },
    }),
    prisma.event.findMany({
      where: { restaurantId: ctx.restaurantId, entityType: "customer", entityId: customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // The timeline is assembled from the event outbox: it is already the
  // authoritative record of every state change, so nothing extra to maintain.
  const orderIds = orders.map((o) => o.id);
  const orderEvents = orderIds.length
    ? await prisma.event.findMany({
        where: {
          restaurantId: ctx.restaurantId,
          entityType: { in: ["order", "review", "payment"] },
          entityId: { in: orderIds },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];

  const timeline = [...events, ...orderEvents]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 60);

  const deliveries = orders.map((o) => o.delivery).filter((d): d is NonNullable<typeof d> => Boolean(d));

  return { customer, orders, payments, reviews, deliveries, timeline };
}

export async function createCustomer(ctx: TenantContext, input: CreateCustomerInput) {
  assertCan(ctx, "customers:write");
  const whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber, countryCode());

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        restaurantId: ctx.restaurantId,
        whatsappNumber,
        name: input.name ?? null,
        phone: input.phone ?? whatsappNumber,
        email: input.email || null,
        address: input.address ?? null,
        city: input.city ?? null,
        notes: input.notes ?? null,
      },
    });

    await recordAudit(tx, ctx, {
      action: "customer.created",
      entityType: "customer",
      entityId: customer.id,
      newValue: { whatsappNumber, reason: "manual_entry" },
    });
    await emitEvent(tx, ctx, {
      type: "CUSTOMER_CREATED",
      entityType: "customer",
      entityId: customer.id,
      payload: { customerId: customer.id, whatsappNumber, name: customer.name, source: "manual" },
    });

    return customer;
  });
}

export async function updateCustomer(ctx: TenantContext, customerId: string, input: UpdateCustomerInput) {
  assertCan(ctx, "customers:write");
  const existing = await getCustomer(ctx, customerId);

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        phone: input.phone ?? undefined,
        email: input.email === "" ? null : (input.email ?? undefined),
        address: input.address ?? undefined,
        city: input.city ?? undefined,
        notes: input.notes ?? undefined,
      },
    });

    await recordAudit(tx, ctx, {
      action: "customer.updated",
      entityType: "customer",
      entityId: customer.id,
      oldValue: { name: existing.name, email: existing.email, address: existing.address, city: existing.city },
      newValue: { name: customer.name, email: customer.email, address: customer.address, city: customer.city },
    });

    return customer;
  });
}
