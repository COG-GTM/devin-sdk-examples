"use client";

import type { DevinUIMessage } from "@/lib/agent";
import type { SetupProgress } from "@/lib/setup-progress";
import { cn } from "@/lib/utils";

type Tone = "busy" | "attention" | "idle" | "error";

interface Status {
  tone: Tone;
  text: string;
}

const TOOL_VERBS: Record<string, string> = {
  bash: "Running a command",
  read: "Reading a file",
  write: "Writing a file",
  edit: "Editing a file",
  grep: "Searching files",
  glob: "Finding files",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One line that always says what the session is doing: the setup phase
 * before Devin's first token, the current activity while it works, a nudge
 * when it needs you, and "awaiting your input" in between turns.
 */
export function deriveStatus({
  busy,
  progress,
  last,
  error,
}: {
  busy: boolean;
  progress: SetupProgress | null;
  last: DevinUIMessage | undefined;
  error?: Error;
}): Status {
  if (error && !busy) return { tone: "error", text: error.message };
  const parts = last?.role === "assistant" ? last.parts : [];
  const lastTool = [...parts]
    .reverse()
    .find((p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"));
  const toolState = lastTool && "state" in lastTool ? lastTool.state : undefined;

  if (toolState === "approval-requested") {
    return { tone: "attention", text: "Action required: approve or deny the command" };
  }

  if (busy) {
    const settingUp = progress !== null && progress.readyMs === undefined;
    if (settingUp) {
      const active = progress.steps.find((s) => s.state === "active");
      return { tone: "busy", text: active?.detail ? capitalize(active.detail) : "Setting up" };
    }
    if (progress === null && parts.length === 0) return { tone: "busy", text: "Starting" };
    if (lastTool && (toolState === "input-streaming" || toolState === "input-available")) {
      const name = lastTool.type === "dynamic-tool" ? lastTool.toolName : lastTool.type.slice(5);
      return { tone: "busy", text: TOOL_VERBS[name] ?? `Running ${name}` };
    }
    const lastPart = parts.at(-1);
    if (lastPart?.type === "reasoning") return { tone: "busy", text: "Thinking" };
    return { tone: "busy", text: "Working" };
  }

  if (progress?.readyMs !== undefined && parts.length > 0) {
    return {
      tone: "idle",
      text: `Awaiting your input · last turn ready in ${(progress.readyMs / 1000).toFixed(1)}s`,
    };
  }
  return { tone: "idle", text: "Awaiting your input" };
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
        {status.tone === "busy" && <Ellipsis />}
      </span>
    </div>
  );
}

function Ellipsis() {
  return (
    <span className="inline-flex w-4 justify-start" aria-hidden>
      <span className="animate-pulse">…</span>
    </span>
  );
}
