import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { createDeliverySchema, listDeliveriesSchema } from "@/server/modules/deliveries/delivery.schema";
import { createDelivery, listDeliveries } from "@/server/modules/deliveries/delivery.service";

export const GET = withApi({ querySchema: listDeliveriesSchema }, async ({ ctx, query }) =>
  ok(await listDeliveries(ctx, query)),
);

export const POST = withApi({ bodySchema: createDeliverySchema }, async ({ ctx, body }) =>
  created(await createDelivery(ctx, body)),
);
