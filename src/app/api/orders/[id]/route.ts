import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { updateOrderSchema } from "@/server/modules/orders/order.schema";
import { getOrder, updateOrder } from "@/server/modules/orders/order.service";

export const GET = withApi({ permission: "orders:read" }, async ({ ctx, params }) =>
  ok(await getOrder(ctx, params.id)),
);

/** Status changes, address and notes. Transition rules are enforced in the service. */
export const PATCH = withApi(
  { permission: "orders:read", bodySchema: updateOrderSchema },
  async ({ ctx, body, params }) => ok(await updateOrder(ctx, params.id, body)),
);
