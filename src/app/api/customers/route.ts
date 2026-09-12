import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { createCustomerSchema, listCustomersSchema } from "@/server/modules/customers/customer.schema";
import { createCustomer, listCustomers } from "@/server/modules/customers/customer.service";

export const GET = withApi(
  { permission: "customers:read", querySchema: listCustomersSchema },
  async ({ ctx, query }) => ok(await listCustomers(ctx, query)),
);

/**
 * Manual customer creation (a walk-in, a phone order). n8n should NOT call this
 * during a conversation — permanent customers come from the payment result.
 */
export const POST = withApi(
  { permission: "customers:write", bodySchema: createCustomerSchema },
  async ({ ctx, body }) => created(await createCustomer(ctx, body)),
);
