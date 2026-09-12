import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { dispatchDelivery } from "@/server/modules/deliveries/delivery.service";

/** READY -> OUT_FOR_DELIVERY. Emits ORDER_OUT_FOR_DELIVERY. */
export const POST = withApi({}, async ({ ctx, params }) => {
  const delivery = await dispatchDelivery(ctx, params.id);
  return ok({ id: delivery.id, status: delivery.status, event: "ORDER_OUT_FOR_DELIVERY" });
});
