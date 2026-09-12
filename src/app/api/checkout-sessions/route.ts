import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { listCheckoutSchema, upsertCheckoutSchema } from "@/server/modules/checkout/checkout.schema";
import { listCheckoutSessions, upsertCheckoutSession } from "@/server/modules/checkout/checkout.service";

export const GET = withApi(
  { permission: "orders:read", querySchema: listCheckoutSchema },
  async ({ ctx, query }) => ok(await listCheckoutSessions(ctx, query)),
);

/**
 * TEMPORARY LAYER — n8n keeps the cart here while the AI agent talks to the
 * customer. Idempotent on sessionId, so it is safe to call on every turn.
 * Creating or updating a session creates NO customer and NO order.
 */
export const POST = withApi(
  { bodySchema: upsertCheckoutSchema, rateLimit: { max: 600, windowSeconds: 60 } },
  async ({ ctx, body }) => created(await upsertCheckoutSession(ctx, body)),
);
