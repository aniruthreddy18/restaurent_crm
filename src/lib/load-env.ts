import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Minimal .env reader for scripts and tests. The Next.js runtime loads .env on
 * its own, so this only exists for tsx/vitest entry points.
 */
export function loadEnvFile(file = ".env") {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Real environment variables always win over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
