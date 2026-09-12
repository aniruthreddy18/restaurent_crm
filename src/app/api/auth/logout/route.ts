import { clearSessionCookie } from "@/server/auth/session";
import { ok } from "@/server/http/responses";

export async function POST() {
  await clearSessionCookie();
  return ok({ loggedOut: true });
}
