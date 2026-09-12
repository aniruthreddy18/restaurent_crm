import { z } from "zod";

export const orderItemInputSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(200),
  price: z.coerce.number().nonnegative(),
  quantity: z.coerce.number().int().min(1).max(999),
  /// Toppings, flavours, add-ons — snapshotted with the line.
  modifiers: z.array(z.string().trim().max(120)).max(50).optional(),
  notes: z.string().trim().max(300).optional(),
});

/**
 * Manual order creation (cashier / phone order). It requires an EXISTING
 * customerId on purpose: this endpoint is not a back door around the rule that
 * only a terminal payment creates a customer.
 */
export const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(orderItemInputSchema).min(1, "An order needs at least one item"),
  deliveryFee: z.coerce.number().nonnegative().default(0),
  discount: z.coerce.number().nonnegative().default(0),
  tax: z.coerce.number().nonnegative().default(0),
  deliveryAddress: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  paymentStatus: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]).default("PENDING"),
  /** Caller's own reference — unique per restaurant, for idempotent retries. */
  externalOrderId: z.string().trim().max(120).optional(),
  /** When the customer wants it (scheduled / pre-orders). */
  scheduledFor: z.string().trim().max(40).optional(),
  /** Authoritative total; otherwise derived from items + fee - discount + tax. */
  totalAmount: z.coerce.number().nonnegative().optional(),
});

/**
 * Integration shape — what n8n posts after a payment gateway (PhonePe, etc.)
 * returns. It is flat and single-product on purpose: that is the shape a
 * WhatsApp ordering agent naturally produces.
 *
 * `orderId` is the caller's own reference and the idempotency anchor: posting
 * the same one twice returns the first order rather than creating a second.
 *
 * The core rule still holds. A customer is created from `phone` only when
 * `paymentStatus` is SUCCESS or FAILED; anything else requires a `customerId`
 * that already exists.
 */
export const integrationOrderSchema = z
  .object({
    // --- who ---
    customerId: z.string().uuid().optional(),
    phone: z.string().trim().min(6).max(24).optional(),
    customerName: z.string().trim().max(120).optional(),

    // --- idempotency ---
    orderId: z.string().trim().min(1).max(120).optional(),

    // --- what: either a single product, or a full items array ---
    cookieType: z.string().trim().min(1).max(200).optional(),
    quantity: z.coerce.number().int().min(1).max(999).optional(),
    toppings: z
      .union([z.array(z.string().trim().max(120)).max(50), z.string().trim().max(600)])
      .optional(),
    unitPrice: z.coerce.number().nonnegative().optional(),
    items: z.array(orderItemInputSchema).optional(),

    // --- money ---
    totalPrice: z.coerce.number().nonnegative().optional(),
    deliveryFee: z.coerce.number().nonnegative().default(0),
    discount: z.coerce.number().nonnegative().default(0),
    tax: z.coerce.number().nonnegative().default(0),
    currency: z.string().trim().length(3).default("INR"),

    // --- fulfilment ---
    deliveryDate: z.string().trim().max(40).optional(),
    deliveryAddress: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(1000).optional(),

    // --- payment ---
    paymentStatus: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]).default("PENDING"),
    paymentTransactionId: z.string().trim().max(200).optional(),
    paymentMethod: z.string().trim().max(60).optional(),
    gateway: z.string().trim().max(60).optional(),
    failureReason: z.string().trim().max(500).optional(),
    paidAt: z.string().trim().max(40).optional(),
  })
  .refine((v) => Boolean(v.customerId || v.phone), {
    message: "Either customerId or phone is required",
    path: ["customerId"],
  })
  .refine((v) => Boolean(v.cookieType || v.items?.length), {
    message: "Provide either cookieType (with quantity) or an items array",
    path: ["cookieType"],
  })
  .refine((v) => !(v.paymentStatus === "SUCCESS" || v.paymentStatus === "FAILED") || Boolean(v.paymentTransactionId), {
    message: "paymentTransactionId is required for a SUCCESS or FAILED payment",
    path: ["paymentTransactionId"],
  });

export type IntegrationOrderInput = z.infer<typeof integrationOrderSchema>;

export const updateOrderSchema = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "FAILED"]).optional(),
  deliveryAddress: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(300).optional(),
});

export const listOrdersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "FAILED"]).optional(),
  paymentStatus: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]).optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ListOrdersInput = z.infer<typeof listOrdersSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
