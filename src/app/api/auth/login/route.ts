import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { verifyPassword } from "@/server/auth/password";
import { setSessionCookie } from "@/server/auth/session";
import { consumeRateLimit } from "@/server/http/rate-limit";
import { fail, ok, toAppError } from "@/server/http/responses";
import { UnauthorizedError } from "@/server/core/errors";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    // Tight limit: this endpoint is the front door for credential stuffing.
    consumeRateLimit(`login:${ip}`, 10, 300);

    const { email, password } = loginSchema.parse(await req.json());

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      include: { restaurant: { select: { name: true, isActive: true } } },
    });

    const valid = await verifyPassword(password, user?.passwordHash ?? null);
    // One generic message for every failure — never reveal which half was wrong.
    if (!user || !valid || !user.restaurant.isActive) {
      throw new UnauthorizedError("Invalid email or password");
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await setSessionCookie({
      userId: user.id,
      restaurantId: user.restaurantId,
      role: user.role,
      email: user.email,
      name: user.name,
    });

    return ok({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      restaurant: { id: user.restaurantId, name: user.restaurant.name },
    });
  } catch (error) {
    return fail(toAppError(error));
  }
}
