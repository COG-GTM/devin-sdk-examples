/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type * as server from "../src/server";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof server;
    }
  }
}
