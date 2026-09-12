import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { markOrderReady } from "@/server/modules/orders/order.service";

/**
 * [ ORDER IS READY ]
 *
 * Validates permission, moves the order to READY, writes the audit row and
 * emits ORDER_READY. n8n picks the event up and sends "Your order is ready."
 * The CRM never talks to WhatsApp itself.
 */
export const POST = withApi({ permission: "orders:status" }, async ({ ctx, params }) => {
  const order = await markOrderReady(ctx, params.id);
  return ok({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    readyAt: order.readyAt,
    event: "ORDER_READY",
  });
});
