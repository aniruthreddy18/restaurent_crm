import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { createStaffSchema } from "@/server/modules/staff/staff.schema";
import { createStaff, listStaff } from "@/server/modules/staff/staff.service";

export const GET = withApi({ permission: "staff:read" }, async ({ ctx }) => ok(await listStaff(ctx)));

export const POST = withApi(
  { permission: "staff:write", bodySchema: createStaffSchema },
  async ({ ctx, body }) => created(await createStaff(ctx, body)),
);
