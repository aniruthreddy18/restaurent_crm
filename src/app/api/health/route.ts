import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness probe. Exposes no tenant data. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "up", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", database: "down" }, { status: 503 });
  }
}
