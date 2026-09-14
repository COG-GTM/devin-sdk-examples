import type { DevinChatMessage, DevinChatState } from "@cognition-ai/cloudflare-agents";
import type { ToolCallDetail } from "@cognition-ai/sdk";
import { isToolUIPart } from "ai";

import type { SessionSnapshot } from "../server";
import { awaitingPermission, toolDetail } from "../lib/tools";
import { cn, humanize } from "../lib/utils";

type Tone = "busy" | "attention" | "idle" | "error";

export interface Status {
  tone: Tone;
  text: string;
}

const TOOL_VERBS: Record<ToolCallDetail["tool"], string> = {
  exec: "Running a command",
  read: "Reading a file",
  write: "Writing a file",
  edit: "Editing a file",
  list_directory: "Listing a directory",
  file_search: "Searching files",
  mcp: "Calling a tool",
  permission_request: "Waiting for your permission",
  ask_user_question: "Waiting for your answer",
  computer_use: "Using the browser",
  report_blocker: "Reporting a blocker",
  other: "Working",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One line that always says what the session is doing: what Devin is on
 * while a turn streams, a nudge when it needs you, and what the cloud says
 * about the session in between turns.
 */
export function deriveStatus({
  busy,
  hasSession,
  state,
  snapshot,
  last,
  error,
}: {
  busy: boolean;
  hasSession: boolean;
  state: DevinChatState | undefined;
  snapshot: SessionSnapshot | null;
  last: DevinChatMessage | undefined;
  error?: Error;
}): Status {
  if (error && !busy) return { tone: "error", text: error.message };
  const parts = last?.role === "assistant" ? last.parts : [];
  const tools = parts.filter(isToolUIPart);
  const lastTool = tools.at(-1);

  if (awaitingPermission(last, busy)) {
    return { tone: "attention", text: "Action required: allow or deny Devin's request" };
  }

  if (busy) {
    if (!hasSession && parts.length === 0)
      return { tone: "busy", text: "Starting a Devin session" };
    if (
      lastTool &&
      (lastTool.state === "input-streaming" || lastTool.state === "input-available")
    ) {
      const tool = toolDetail(lastTool)?.tool;
      return { tone: "busy", text: tool === undefined ? "Working" : TOOL_VERBS[tool] };
    }
    if (parts.at(-1)?.type === "reasoning") return { tone: "busy", text: "Thinking" };
    const activity = humanize(state?.activity);
    if (activity !== undefined && !activity.startsWith("finish ")) {
      return { tone: "busy", text: capitalize(activity) };
    }
    return { tone: "busy", text: parts.length === 0 ? "Sending to Devin" : "Working" };
  }

  if (snapshot?.userActionRequired) {
    return { tone: "attention", text: snapshot.userActionRequired };
  }
  if (lastTool !== undefined && toolDetail(lastTool)?.tool === "ask_user_question") {
    return { tone: "attention", text: "Devin asked you a question" };
  }
  if (snapshot?.status === "working") {
    const activity = humanize(snapshot.activity);
    return {
      tone: "busy",
      text: activity === undefined ? "Devin is still working in the cloud" : capitalize(activity),
    };
  }
  if (snapshot?.runtime === "suspended") {
    return { tone: "idle", text: "Session asleep · your next message wakes it" };
  }
  if (snapshot?.status === "finished" || snapshot?.status === "stopped") {
    return { tone: "idle", text: `Session ${snapshot.status}` };
  }
  return {
    tone: "idle",
    text: hasSession ? "Awaiting your input" : "Your first message starts a session",
  };
}

export function StatusLine({ status }: { status: Status }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-primary/18 font-mono text-[11px] text-muted-foreground">
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          status.tone === "busy" && "bg-amber-500 animate-pulse",
          status.tone === "attention" && "bg-amber-500",
          status.tone === "idle" && "bg-emerald-600",
          status.tone === "error" && "bg-destructive",
        )}
      />
      {/* Keyed on the text so each change re-enters with a small slide. */}
      <span
        key={status.text}
        title={status.text}
        className={cn(
          "truncate animate-in fade-in slide-in-from-bottom-1 duration-300",
          status.tone === "error" && "text-destructive",
        )}
      >
        {status.text}
        {status.tone === "busy" && (
          <span className="inline-flex w-4 justify-start" aria-hidden>
            <span className="animate-pulse">…</span>
          </span>
        )}
      </span>
    </div>
  );
}
