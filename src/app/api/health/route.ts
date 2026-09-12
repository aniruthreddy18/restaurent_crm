import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { env } from "@/lib/env";
import { ConfigurationError } from "@/server/core/errors";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness and readiness probe.
 *
 * Reports configuration problems by VARIABLE NAME (never by value), because the
 * alternative — every authenticated route returning an opaque 500 — makes a
 * first deployment impossible to diagnose. The names are already public in
 * .env.example, so this leaks nothing that the repository does not.
 */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let healthy = true;

  // --- configuration ---
  try {
    env();
    checks.config = "ok";
  } catch (error) {
    healthy = false;
    checks.config =
      error instanceof ConfigurationError
        ? { status: "invalid", problems: error.details, fix: "Set these in your host's environment settings, then redeploy." }
        : { status: "invalid", problems: "Environment could not be parsed" };
  }

  // --- database ---
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "up";
  } catch {
    healthy = false;
    checks.database = "down";
  }

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", ...checks, time: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
