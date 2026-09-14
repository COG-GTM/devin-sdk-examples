import { createServer } from "node:net";
import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import agents from "agents/vite";
import { defineConfig } from "vitest/config";

const testsDir = import.meta.dirname;
export const FAKE_API_KEY = "cog_fake_test_key_do_not_leak";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === "string") reject(new Error("no port"));
        else resolve(address.port);
      });
    });
  });
}

export default defineConfig(async () => {
  const port = await freePort();
  process.env.FAKE_DEVIN_PORT = String(port);
  process.env.FAKE_DEVIN_API_KEY = FAKE_API_KEY;
  return {
    plugins: [
      agents(),
      cloudflareTest({
        wrangler: { configPath: path.join(testsDir, "wrangler.jsonc") },
        miniflare: {
          bindings: {
            DEVIN_API_KEY: FAKE_API_KEY,
            DEVIN_BASE_URL: `http://127.0.0.1:${String(port)}`,
          },
        },
      }),
    ],
    test: {
      name: "workers",
      include: [path.join(testsDir, "**/*.test.ts")],
      globalSetup: [path.join(testsDir, "global-setup.ts")],
      setupFiles: [path.join(testsDir, "setup.ts")],
      testTimeout: 15_000,
      teardownTimeout: 60_000,
    },
  };
});
