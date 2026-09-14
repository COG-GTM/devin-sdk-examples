import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the SDK external so Node loads it from node_modules and `LocalDevin`
  // finds the bundled CLI on disk. Next only honours an external it can
  // resolve from this app, and the SDK is a direct dependency here.
  serverExternalPackages: ["@cognition-ai/sdk"],
  // A self-contained server for the Dockerfile: `.next/standalone` holds only
  // the files the app reaches at runtime.
  output: "standalone",
};

export default nextConfig;
