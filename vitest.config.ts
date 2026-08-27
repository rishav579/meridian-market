import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Fresh throwaway SQLite file per run — never touches db/custom.db.
const testDbPath = path.join(os.tmpdir(), `meridian-market-test-${process.pid}-${Date.now()}.db`);
const databaseUrl = `file:${testDbPath.split(path.sep).join("/")}`;

// Deterministic test environment. Vitest does NOT load .env, so these are the
// only values the application modules will ever see during a test run.
process.env.TEST_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;
process.env.AUTH_SECRET = "test_auth_secret_for_vitest_only";
process.env.REALTIME_SECRET = "test_realtime_secret_for_vitest_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_vitest_only";
// Closed loopback ports: checkout's self-delivered webhook always fails fast
// and takes the documented direct-settlement fallback; realtime emits fail
// fast too. Keeps integration tests deterministic with zero live services.
process.env.INTERNAL_API_BASE = "http://127.0.0.1:9";
process.env.REALTIME_INTERNAL_URL = "http://127.0.0.1:9";
process.env.NEXT_PUBLIC_APP_NAME = "Meridian Market";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // SQLite is single-writer: run test files sequentially against one DB.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
