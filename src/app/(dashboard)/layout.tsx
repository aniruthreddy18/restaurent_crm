import { requireUser } from "@/server/auth/guard";
import { visibleSections } from "@/server/auth/permissions";
import { Sidebar } from "@/components/shell/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <Sidebar
        visible={visibleSections(user.role)}
        user={{ name: user.name, role: user.role, restaurantName: user.restaurantName }}
      />
      <main className="px-4 pb-12 pt-16 lg:ml-64 lg:px-8 lg:pt-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
