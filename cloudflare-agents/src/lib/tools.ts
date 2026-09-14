import type { DevinChatMessage } from "@cognition-ai/cloudflare-agents";
import type { ToolCallDetail } from "@cognition-ai/sdk";
import { isToolUIPart, type getToolName } from "ai";

export type ToolPartArg = Parameters<typeof getToolName>[0];

const TOOL_NAMES = new Set<ToolCallDetail["tool"]>([
  "exec",
  "read",
  "write",
  "edit",
  "list_directory",
  "file_search",
  "mcp",
  "permission_request",
  "ask_user_question",
  "computer_use",
  "report_blocker",
  "other",
]);

/**
 * The SDK's normalized `ToolCallDetail` rides in the part's `input` and, once
 * the call finished, in `output.detail` (which adds fields like `exitCode`).
 */
export function toolDetail(part: ToolPartArg): ToolCallDetail | undefined {
  const output = "output" in part ? part.output : undefined;
  const candidates = [
    typeof output === "object" && output !== null && "detail" in output ? output.detail : undefined,
    "input" in part ? part.input : undefined,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "tool" in candidate &&
      typeof candidate.tool === "string" &&
      (TOOL_NAMES as Set<string>).has(candidate.tool)
    ) {
      return candidate as ToolCallDetail;
    }
  }
  return undefined;
}

/**
 * Whether the last message is waiting on the user to allow or deny something.
 * AI SDK approvals hold the turn until answered, so they count on their own.
 * A cloud `permission_request` call only counts while its turn streams: after
 * a stop or a restart it is interrupted and has nothing left to answer.
 */
export function awaitingPermission(last: DevinChatMessage | undefined, busy: boolean): boolean {
  if (last?.role !== "assistant") return false;
  return last.parts.some(
    (part) =>
      isToolUIPart(part) &&
      (part.state === "approval-requested" ||
        (busy &&
          part.state === "input-available" &&
          toolDetail(part)?.tool === "permission_request")),
  );
}
