import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the SDK and its WebSocket client out of the server bundle: the SDK
  // resolves the CLI binary via createRequire and `ws` picks its native
  // helpers at runtime, both of which break when inlined. Next only honours
  // an external it can resolve from this app, which is why `ws` is in
  // package.json even though nothing here imports it.
  serverExternalPackages: ["@cognition-ai/sdk", "ws"],
  // A self-contained server for the Dockerfile: `.next/standalone` holds only
  // the files the app reaches at runtime.
  output: "standalone",
};

export default nextConfig;
