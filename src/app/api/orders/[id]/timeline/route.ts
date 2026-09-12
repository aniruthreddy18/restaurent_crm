import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { getOrder, getOrderTimeline } from "@/server/modules/orders/order.service";

export const GET = withApi({ permission: "orders:read" }, async ({ ctx, params }) => {
  const order = await getOrder(ctx, params.id);
  return ok(await getOrderTimeline(ctx, order.id));
});
