import { z } from "zod";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { abandonCheckoutSession, getCheckoutSession } from "@/server/modules/checkout/checkout.service";

export const GET = withApi({}, async ({ ctx, params }) => ok(await getCheckoutSession(ctx, params.id)));

const patchSchema = z.object({ status: z.literal("ABANDONED") });

/** Abandoning a cart is a temporary-layer operation — no CRM records result. */
export const PATCH = withApi({ bodySchema: patchSchema }, async ({ ctx, params }) =>
  ok(await abandonCheckoutSession(ctx, params.id)),
);
