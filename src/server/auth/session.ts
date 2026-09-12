import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@prisma/client";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "crm_session";
/** Double-submit token for state-changing form posts. Readable by the client. */
export const CSRF_COOKIE = "crm_csrf";

export type SessionPayload = {
  userId: string;
  restaurantId: string;
  role: UserRole;
  email: string;
  name: string;
};

function secretKey() {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const ttlHours = env().SESSION_TTL_HOURS;
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("restaurant-crm")
    .setAudience("restaurant-crm-dashboard")
    .setExpirationTime(`${ttlHours}h`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "restaurant-crm",
      audience: "restaurant-crm-dashboard",
    });
    const { userId, restaurantId, role, email, name } = payload as Record<string, unknown>;
    if (typeof userId !== "string" || typeof restaurantId !== "string" || typeof role !== "string") return null;
    return {
      userId,
      restaurantId,
      role: role as UserRole,
      email: String(email ?? ""),
      name: String(name ?? ""),
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = await createSessionToken(payload);
  const jar = await cookies();
  const maxAge = env().SESSION_TTL_HOURS * 3600;
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  // Non-httpOnly twin: the browser sends it back in a header, and a
  // cross-site attacker cannot read it to forge that header.
  jar.set(CSRF_COOKIE, crypto.randomUUID(), {
    httpOnly: false,
    secure: env().COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
