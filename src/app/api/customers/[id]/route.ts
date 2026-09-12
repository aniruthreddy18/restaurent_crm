import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { updateCustomerSchema } from "@/server/modules/customers/customer.schema";
import { getCustomerProfile, updateCustomer } from "@/server/modules/customers/customer.service";

export const GET = withApi({ permission: "customers:read" }, async ({ ctx, params }) =>
  ok(await getCustomerProfile(ctx, params.id)),
);

export const PATCH = withApi(
  { permission: "customers:write", bodySchema: updateCustomerSchema },
  async ({ ctx, body, params }) => ok(await updateCustomer(ctx, params.id, body)),
);
