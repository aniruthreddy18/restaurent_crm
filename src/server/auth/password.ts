import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) throw new Error("Password must be at least 8 characters");
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  // Always run a comparison so a missing hash costs the same time as a wrong
  // password — otherwise response timing leaks which emails exist.
  const target = hash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const ok = await bcrypt.compare(plain, target);
  return hash ? ok : false;
}
