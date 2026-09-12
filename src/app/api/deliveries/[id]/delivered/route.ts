import { z } from "zod";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { markDelivered } from "@/server/modules/deliveries/delivery.service";

const bodySchema = z.object({ notes: z.string().trim().max(1000).optional() });

/**
 * [ MARK DELIVERED ]
 *
 * Sets delivery + order to DELIVERED, stamps the time, audits the change and
 * emits ORDER_DELIVERED — which n8n turns into the delivery confirmation and
 * the follow-up rating request.
 */
export const POST = withApi({ bodySchema }, async ({ ctx, body, params }) => {
  const delivery = await markDelivered(ctx, params.id, body.notes);
  return ok({
    id: delivery.id,
    status: delivery.status,
    deliveredAt: delivery.deliveredAt,
    orderNumber: delivery.order.orderNumber,
    event: "ORDER_DELIVERED",
  });
});
