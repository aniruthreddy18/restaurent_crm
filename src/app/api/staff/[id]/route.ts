import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { updateStaffSchema } from "@/server/modules/staff/staff.schema";
import { updateStaff } from "@/server/modules/staff/staff.service";

export const PATCH = withApi(
  { permission: "staff:write", bodySchema: updateStaffSchema },
  async ({ ctx, body, params }) => ok(await updateStaff(ctx, params.id, body)),
);
