import { z } from "zod";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { cancelOrder } from "@/server/modules/orders/order.service";

const bodySchema = z.object({ reason: z.string().trim().max(300).optional() });

export const POST = withApi({ permission: "orders:cancel", bodySchema }, async ({ ctx, body, params }) => {
  const order = await cancelOrder(ctx, params.id, body.reason);
  return ok({ id: order.id, orderNumber: order.orderNumber, status: order.status, event: "ORDER_CANCELLED" });
});
