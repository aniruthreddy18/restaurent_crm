import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { withIdempotency } from "@/server/idempotency/idempotency";
import { listPaymentsSchema, paymentResultSchema } from "@/server/modules/payments/payment.schema";
import { listPayments, recordPaymentResult } from "@/server/modules/payments/payment.service";

export const GET = withApi(
  { permission: "payments:read", querySchema: listPaymentsSchema },
  async ({ ctx, query }) => ok(await listPayments(ctx, query)),
);

/**
 * ===========================================================================
 * The primary n8n integration point.
 * ===========================================================================
 *
 * Post the payment result here once the provider returns. On SUCCESS or FAILED
 * this creates/reuses the customer, materialises the order and payment, and
 * emits PAYMENT_SUCCESS / PAYMENT_FAILED (+ ORDER_CONFIRMED on success).
 * On PENDING it records the intent only — no customer, no order.
 *
 * Send `Idempotency-Key` (or `externalEventId` in the body) and replays are
 * free: the same call five times yields exactly one of everything.
 */
export const POST = withApi(
  {
    permission: "payments:write",
    bodySchema: paymentResultSchema,
    // Payment webhooks burst; give them more headroom than the default.
    rateLimit: { max: 300, windowSeconds: 60 },
  },
  async ({ ctx, body, req }) => {
    const idempotencyKey =
      req.headers.get("idempotency-key") ?? body.externalEventId ?? `txn:${body.transactionId}:${body.status}`;

    const { result, replayed } = await withIdempotency(ctx, "payment_result", idempotencyKey, body, () =>
      recordPaymentResult(ctx, body),
    );

    const payload = { ...result, replayed: replayed || result.replayed };
    return replayed ? ok(payload) : created(payload);
  },
);
