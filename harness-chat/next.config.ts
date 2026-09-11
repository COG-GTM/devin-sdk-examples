import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load these as installed packages rather than bundling them: the SDK
  // resolves the CLI binary via createRequire, and `ws` breaks when inlined
  // (it mistakes webpack's stub for its native helpers). Next only
  // externalizes what it can resolve from this app, which is why `ws` is a
  // direct dependency here.
  serverExternalPackages: [
    "@ai-sdk/harness",
    "@ai-sdk/sandbox-vercel",
    "@cognition-ai/harness-devin",
    "@cognition-ai/sdk",
    "ws",
  ],
};

export default nextConfig;
