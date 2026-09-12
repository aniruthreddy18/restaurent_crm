import { requirePermission, toContext } from "@/server/auth/guard";
import { can, ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { listStaff } from "@/server/modules/staff/staff.service";
import { Card, CardHeader, EmptyState, PageHeader, Td, Th } from "@/components/ui/primitives";
import { AddStaffButton, ToggleStaffActive } from "@/components/staff/staff-form";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff · Restaurant CRM" };

export default async function StaffPage() {
  const user = await requirePermission("staff:read");
  const staff = await listStaff(toContext(user));
  const canManage = can(user.role, "staff:write");

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can sign in, and what they are allowed to do."
        action={canManage ? <AddStaffButton /> : undefined}
      />

      <Card>
        <CardHeader title={`${staff.length} account${staff.length === 1 ? "" : "s"}`} />
        {staff.length === 0 ? (
          <EmptyState title="No staff accounts" />
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-line bg-surface-muted">
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Last sign-in</Th>
                  <Th>Status</Th>
                  {canManage ? <Th /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {staff.map((member) => (
                  <tr key={member.id} className="hover:bg-surface-muted">
                    <Td>
                      <span className="font-medium">{member.name}</span>
                      {member.driver?.vehicle ? (
                        <p className="text-xs text-ink-subtle">{member.driver.vehicle}</p>
                      ) : null}
                    </Td>
                    <Td className="text-ink-muted">{member.email}</Td>
                    <Td>
                      <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted">
                        {member.role}
                      </span>
                    </Td>
                    <Td className="text-ink-muted">{formatRelative(member.lastLoginAt)}</Td>
                    <Td>
                      <span className={member.isActive ? "text-ok" : "text-ink-subtle"}>
                        {member.isActive ? "Active" : "Inactive"}
                      </span>
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <ToggleStaffActive userId={member.id} name={member.name} isActive={member.isActive} />
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="What each role can do" subtitle="Enforced on the server, not just hidden in the UI" />
        <div className="table-scroll">
          <table className="w-full min-w-[560px]">
            <thead className="border-b border-line bg-surface-muted">
              <tr>
                <Th>Role</Th>
                <Th>Permissions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]).map((role) => (
                <tr key={role}>
                  <Td className="align-top font-medium">{role}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {ROLE_PERMISSIONS[role].map((permission) => (
                        <span
                          key={permission}
                          className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-ink-muted"
                        >
                          {permission}
                        </span>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
