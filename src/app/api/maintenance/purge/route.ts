import { z } from "zod";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { purgeExpiredSessions, purgeIdempotencyRecords } from "@/server/modules/checkout/checkout.service";

const bodySchema = z.object({
  /** Days an expired/abandoned cart is kept before deletion. */
  cartRetentionDays: z.coerce.number().int().min(1).max(365).default(7),
  /** Days an idempotency record is kept — must exceed the provider's retry window. */
  idempotencyRetentionDays: z.coerce.number().int().min(1).max(365).default(30),
});

/**
 * Housekeeping for the temporary layer.
 *
 * The permanent CRM is never touched: converted carts are skipped because an
 * order references them, and customers/orders/payments are out of scope
 * entirely. Run it daily (Vercel Cron, or any scheduler).
 *
 * Vercel Cron authenticates with `Authorization: Bearer $CRON_SECRET`, so
 * setting CRON_SECRET to a CRM API key makes it work with no special casing.
 */
export const POST = withApi({ permission: "settings:write", bodySchema }, async ({ ctx, body }) => {
  const sessions = await purgeExpiredSessions(ctx, body.cartRetentionDays);
  const idempotencyRecords = await purgeIdempotencyRecords(ctx, body.idempotencyRetentionDays);
  return ok({ ...sessions, idempotencyRecords });
});

// Cron services issue GET; accept both so either style works.
export const GET = POST;
