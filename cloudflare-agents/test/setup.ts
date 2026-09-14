import { exports } from "cloudflare:workers";
import { afterAll, beforeAll } from "vitest";

beforeAll(async () => {
  await exports.default.fetch("http://warmup/");
}, 30_000);

// Let Durable Objects finish WebSocket close handlers before the module is invalidated.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));
