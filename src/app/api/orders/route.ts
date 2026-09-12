import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { BusinessRuleError, NotFoundError } from "@/server/core/errors";
import { prisma } from "@/server/db/prisma";
import { withIdempotency } from "@/server/idempotency/idempotency";
import {
  integrationOrderSchema,
  listOrdersSchema,
  type IntegrationOrderInput,
  type OrderItemInput,
} from "@/server/modules/orders/order.schema";
import { createOrder, listOrders } from "@/server/modules/orders/order.service";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";

export const GET = withApi(
  { permission: "orders:read", querySchema: listOrdersSchema },
  async ({ ctx, query }) => ok(await listOrders(ctx, query)),
);

/** Normalises the flat integration payload into CRM order lines. */
function toItems(body: IntegrationOrderInput): OrderItemInput[] {
  if (body.items?.length) return body.items;

  const toppings =
    typeof body.toppings === "string"
      ? body.toppings.split(",").map((t) => t.trim()).filter(Boolean)
      : (body.toppings ?? []);

  const quantity = body.quantity ?? 1;
  // With no unit price given, derive one from the total the gateway charged so
  // the line still carries a meaningful per-unit snapshot.
  const unitPrice =
    body.unitPrice ?? (body.totalPrice !== undefined ? body.totalPrice / quantity : 0);

  return [
    {
      name: body.cookieType!,
      price: unitPrice,
      quantity,
      modifiers: toppings.length ? toppings : undefined,
      notes: toppings.length ? toppings.join(", ") : undefined,
    },
  ];
}

/**
 * POST /api/orders
 *
 * Two ways in, one set of rules:
 *
 *  1. A terminal payment (SUCCESS/FAILED) with a `phone` — the WhatsApp +
 *     gateway path. Delegates to the payment flow, which upserts the customer
 *     by phone number, creates the order and payment, and emits the events.
 *     This is the ONLY path that can bring a customer into existence, and it
 *     is the same code the payments endpoint uses — there is no second, weaker
 *     implementation of the core rule.
 *
 *  2. Anything else — requires an existing `customerId`. A PENDING order can
 *     never conjure a customer.
 *
 * Idempotent on `orderId`: replaying a gateway callback returns the original
 * order rather than creating another.
 */
export const POST = withApi(
  {
    permission: "orders:write",
    bodySchema: integrationOrderSchema,
    rateLimit: { max: 300, windowSeconds: 60 },
  },
  async ({ ctx, body, req }) => {
    const terminalPayment = body.paymentStatus === "SUCCESS" || body.paymentStatus === "FAILED";

    // --- Fast path: this orderId was already processed. ---
    if (body.orderId) {
      const existing = await prisma.order.findUnique({
        where: {
          restaurantId_externalOrderId: { restaurantId: ctx.restaurantId, externalOrderId: body.orderId },
        },
        include: { items: true, customer: { select: { id: true, whatsappNumber: true, name: true } } },
      });
      if (existing) {
        return ok({
          duplicate: true,
          orderId: existing.externalOrderId,
          crmOrderId: existing.id,
          orderNumber: existing.orderNumber,
          customerId: existing.customerId,
          status: existing.status,
          paymentStatus: existing.paymentStatus,
          totalPrice: existing.totalAmount.toString(),
        });
      }
    }

    const items = toItems(body);
    const idempotencyKey =
      req.headers.get("idempotency-key") ?? body.orderId ?? body.paymentTransactionId ?? null;

    // --- Path 1: terminal payment identified by phone. ---
    if (terminalPayment && body.phone) {
      // Bind before the closure: narrowing from the guard above does not
      // survive into the callback.
      const phone = body.phone;
      const transactionId = body.paymentTransactionId!;
      const status = body.paymentStatus as "SUCCESS" | "FAILED";

      const { result, replayed } = await withIdempotency(ctx, "integration_order", idempotencyKey, body, () =>
        recordPaymentResult(ctx, {
          transactionId,
          status,
          amount: body.totalPrice ?? 0,
          currency: body.currency,
          paymentMethod: body.paymentMethod,
          gateway: body.gateway,
          failureReason: body.failureReason,
          paidAt: body.paidAt,
          whatsappNumber: phone,
          customer: body.customerName ? { name: body.customerName } : undefined,
          items,
          deliveryFee: body.deliveryFee,
          discount: body.discount,
          tax: body.tax,
          deliveryAddress: body.deliveryAddress,
          notes: body.notes,
          externalOrderId: body.orderId,
          scheduledFor: body.deliveryDate,
          totalAmount: body.totalPrice,
          externalEventId: body.orderId ? `ORDER:${body.orderId}` : undefined,
        }),
      );

      const payload = {
        duplicate: replayed || result.replayed,
        orderId: body.orderId ?? null,
        crmOrderId: result.orderId,
        orderNumber: result.orderNumber,
        customerId: result.customerId,
        customerCreated: result.customerCreated,
        status: result.orderStatus,
        paymentStatus: result.paymentStatus,
        paymentId: result.paymentId,
      };
      return payload.duplicate ? ok(payload) : created(payload);
    }

    // --- Path 2: an order for a customer who already exists. ---
    if (!body.customerId) {
      throw new BusinessRuleError(
        body.phone
          ? "A customer is only created once a payment reaches SUCCESS or FAILED. " +
            "Send paymentStatus + paymentTransactionId, or pass an existing customerId."
          : "customerId is required when the payment has not reached a terminal result",
        "CUSTOMER_NOT_ESTABLISHED",
      );
    }

    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, restaurantId: ctx.restaurantId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundError("Customer");

    const order = await createOrder(ctx, {
      customerId: customer.id,
      items,
      deliveryFee: body.deliveryFee,
      discount: body.discount,
      tax: body.tax,
      deliveryAddress: body.deliveryAddress,
      notes: body.notes,
      paymentStatus: body.paymentStatus,
      externalOrderId: body.orderId,
      scheduledFor: body.deliveryDate,
      totalAmount: body.totalPrice,
    });

    return created({
      duplicate: false,
      orderId: order.externalOrderId,
      crmOrderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalPrice: order.totalAmount.toString(),
    });
  },
);
