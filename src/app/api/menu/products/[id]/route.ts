import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { updateProductSchema } from "@/server/modules/menu/menu.schema";
import { deleteProduct, getProduct, updateProduct } from "@/server/modules/menu/menu.service";

export const GET = withApi({ permission: "menu:read" }, async ({ ctx, params }) =>
  ok(await getProduct(ctx, params.id)),
);

/** Availability-only patches are allowed for KITCHEN; anything else needs menu:write. */
export const PATCH = withApi(
  { permission: "menu:read", bodySchema: updateProductSchema },
  async ({ ctx, body, params }) => ok(await updateProduct(ctx, params.id, body)),
);

export const DELETE = withApi({ permission: "menu:write" }, async ({ ctx, params }) =>
  ok(await deleteProduct(ctx, params.id)),
);
