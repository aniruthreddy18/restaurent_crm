import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { createProductSchema, listProductsSchema } from "@/server/modules/menu/menu.schema";
import { createProduct, listProducts } from "@/server/modules/menu/menu.service";

export const GET = withApi(
  { permission: "menu:read", querySchema: listProductsSchema },
  async ({ ctx, query }) => ok(await listProducts(ctx, query)),
);

export const POST = withApi(
  { permission: "menu:write", bodySchema: createProductSchema },
  async ({ ctx, body }) => created(await createProduct(ctx, body)),
);
