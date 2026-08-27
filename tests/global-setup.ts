import { execSync } from "node:child_process";
import fs from "node:fs";

/**
 * Runs once before the test workers start.
 * Creates a fresh SQLite database at TEST_DATABASE_URL (set by vitest.config.ts)
 * using the real Prisma schema, so integration tests exercise actual migrations
 * of record — not copies or mocks of the data layer.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set — run tests through `npm test`.");
  }
  const dbFile = url.replace(/^file:/, "");
  fs.rmSync(dbFile, { force: true });

  execSync("npx prisma db push --skip-generate", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: url },
  });
}

export function teardown(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  try {
    fs.rmSync(url.replace(/^file:/, ""), { force: true });
  } catch {
    // best-effort cleanup of the temp file
  }
}
