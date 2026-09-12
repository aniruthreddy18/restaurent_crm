import { redirect } from "next/navigation";
import { readSession } from "@/server/auth/session";

export default async function Home() {
  const session = await readSession();
  if (!session) redirect("/login");
  redirect(session.role === "DELIVERY" ? "/deliveries/mine" : "/dashboard");
}
