import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { updateDeliverySchema } from "@/server/modules/deliveries/delivery.schema";
import { getDelivery, updateDelivery } from "@/server/modules/deliveries/delivery.service";

export const GET = withApi({}, async ({ ctx, params }) => ok(await getDelivery(ctx, params.id)));

export const PATCH = withApi({ bodySchema: updateDeliverySchema }, async ({ ctx, body, params }) =>
  ok(await updateDelivery(ctx, params.id, body)),
);
