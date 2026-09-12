import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { createCategorySchema } from "@/server/modules/menu/menu.schema";
import { createCategory, listCategories } from "@/server/modules/menu/menu.service";

export const GET = withApi({ permission: "menu:read" }, async ({ ctx }) => ok(await listCategories(ctx)));

export const POST = withApi(
  { permission: "menu:write", bodySchema: createCategorySchema },
  async ({ ctx, body }) => created(await createCategory(ctx, body)),
);
