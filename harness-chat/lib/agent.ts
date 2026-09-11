import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import type { InferUITools, UIMessage } from "ai";
import { createDevin } from "@cognition-ai/harness-devin";

import { BRIDGE_PORT, PREVIEW_PORTS } from "./ports";
import { routeDiagnostic, type SetupProgress } from "./setup-progress";

/**
 * One sandbox per chat. `sessionId` (the chat id) names the sandbox, so a
 * later request — from any server instance — finds it again with
 * `resumeSession`. Authentication is Vercel OIDC: automatic on Vercel, and
 * `vercel env pull` for local development. The preview ports are for whatever
 * Devin serves from the workspace; the Preview panel shows them.
 */
export const sandbox = createVercelSandbox({
  runtime: "node24",
  ports: [BRIDGE_PORT, ...PREVIEW_PORTS],
});

/**
 * The Devin harness agent behind /api/chat. Devin (the Devin CLI over ACP)
 * runs inside the sandbox via the harness bridge and streams UI message parts
 * to useChat. Pass AI SDK `tools` here to give Devin tools that run on this
 * server.
 */
export const devinAgent = new HarnessAgent({
  // Pin the bridge to one port; the other stays free for the app preview.
  harness: createDevin({ port: BRIDGE_PORT }),
  sandbox,
  instructions:
    "You are Devin working in an empty workspace inside a sandbox. Keep replies brief. " +
    `When asked to start or serve an app, run it in the background on one of ports ${PREVIEW_PORTS.join(", ")} ` +
    "(e.g. `npm start > server.log 2>&1 &`) and confirm it responds before replying.",
  // Devin edits files freely but asks before running shell commands; the
  // approval surfaces as a card in the chat.
  permissionMode: "allow-edits",
  // Bridge and adapter diagnostics (why an attach failed, what the bridge
  // logged) go to the server console; the interesting failures are in there.
  debug: { enabled: true, level: "info" },
  onLog: (event) => {
    routeDiagnostic(event);
    if (event.level === "error" || event.level === "warn") {
      console[event.level](
        `[harness ${event.subsystem}]`,
        event.message,
        event.error?.message ?? "",
      );
    }
  },
});

/** Transient setup progress for the turn in flight (see lib/setup-progress.ts). */
export type BootData = SetupProgress;

export type DevinUIMessage = UIMessage<
  unknown,
  { boot: BootData },
  InferUITools<typeof devinAgent.tools>
>;
