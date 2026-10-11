// Loads .env.local (then .env) for the command-line scripts, the way `next dev`
// does for the app. Values already present in the environment win. Nothing is
// printed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trim().startsWith("#")) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  }
}

/** Runs a script body with a database connection, and always disconnects. */
export async function withDb(body) {
  loadEnv();
  const { connectDb, disconnectDb } = await import("../../src/lib/db/connection.js");
  try {
    await connectDb();
    await body();
  } catch (error) {
    console.error(`\n${error?.message ?? error}`);
    process.exitCode = 1;
  } finally {
    await disconnectDb().catch(() => {});
  }
}
