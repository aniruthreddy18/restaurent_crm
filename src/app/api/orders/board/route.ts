import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { getOrderBoard } from "@/server/modules/orders/order.service";

export const GET = withApi({ permission: "orders:read" }, async ({ ctx }) => ok(await getOrderBoard(ctx)));
