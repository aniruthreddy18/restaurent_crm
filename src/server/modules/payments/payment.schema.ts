import { z } from "zod";
import { orderItemInputSchema } from "@/server/modules/orders/order.schema";

/**
 * The payload n8n posts after the payment provider returns. It carries
 * everything needed to materialise the permanent record in one call, so the
 * CRM never has to reach back out to n8n or Google Sheets.
 */
export const paymentResultSchema = z.object({
  /** Gateway transaction id. Unique per restaurant — the idempotency anchor. */
  transactionId: z.string().trim().min(1).max(200),
  status: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]),
  amount: z.coerce.number().nonnegative(),
  currency: z.string().trim().length(3).default("INR"),
  paymentMethod: z.string().trim().max(60).optional(),
  gateway: z.string().trim().max(60).optional(),
  failureReason: z.string().trim().max(500).optional(),
  paidAt: z.string().datetime().optional(),

  /** Identity of the payer. Required for terminal results. */
  whatsappNumber: z.string().trim().min(6).max(24),
  customer: z
    .object({
      name: z.string().trim().max(120).optional(),
      phone: z.string().trim().max(24).optional(),
      email: z.string().email().optional().or(z.literal("")),
      address: z.string().trim().max(500).optional(),
      city: z.string().trim().max(120).optional(),
    })
    .optional(),

  /** Cart to convert. Omit it and the linked checkout session supplies it. */
  checkoutSessionId: z.string().trim().max(120).optional(),
  /**
   * The caller's own order reference. Unique per restaurant, so a replayed
   * gateway callback resolves to the existing order instead of duplicating it.
   */
  externalOrderId: z.string().trim().max(120).optional(),
  /** When the customer wants the order (scheduled / pre-orders). */
  scheduledFor: z.string().trim().max(40).optional(),
  /**
   * Authoritative order total, when the caller computed it themselves. Left
   * unset, the CRM derives it from items + fee - discount + tax. Distinct from
   * `amount`, which is strictly what the gateway moved.
   */
  totalAmount: z.coerce.number().nonnegative().optional(),
  items: z.array(orderItemInputSchema).optional(),
  deliveryFee: z.coerce.number().nonnegative().optional(),
  discount: z.coerce.number().nonnegative().optional(),
  tax: z.coerce.number().nonnegative().optional(),
  deliveryAddress: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),

  /** Provider's own webhook event id — replays with the same id are no-ops. */
  externalEventId: z.string().trim().max(200).optional(),
  /** Non-sensitive gateway echo. Card data is rejected below. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Defence in depth: if a caller ever tries to hand us cardholder data we drop
 * it rather than persist it. The CRM stores payment *metadata* only.
 */
const FORBIDDEN_METADATA_KEYS = [
  "card",
  "cardnumber",
  "card_number",
  "pan",
  "cvv",
  "cvc",
  "pin",
  "password",
  "expiry",
  "exp_month",
  "exp_year",
  "accountnumber",
  "account_number",
  "iban",
  "routing",
];

export function sanitizePaymentMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (FORBIDDEN_METADATA_KEYS.some((forbidden) => normalized.includes(forbidden.replace(/[^a-z]/g, "")))) {
      clean[key] = "[redacted]";
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

export const listPaymentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]).optional(),
  customerId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
});

export const updatePaymentSchema = z.object({
  status: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]).optional(),
  failureReason: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type PaymentResultInput = z.infer<typeof paymentResultSchema>;
export type ListPaymentsInput = z.infer<typeof listPaymentsSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
