"use client";

import type { ReactNode } from "react";
import {
  BrainIcon,
  CheckIcon,
  ChevronRightIcon,
  FilePenIcon,
  FileTextIcon,
  FolderSearchIcon,
  PlugZapIcon,
  SearchIcon,
  ShieldQuestionIcon,
  SquareChevronRightIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { memo, useState } from "react";
import { Streamdown } from "streamdown";

import type { DevinUIMessage } from "@/lib/agent";
import { DevinDashed } from "@/components/devin-mark";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

type ApprovalResponder = (response: { id: string; approved: boolean }) => void;

/* ── Shared building blocks (same language as the panels) ─────────────── */

/** A bordered block with a mono, uppercase header row — the panel idiom, in miniature. */
function Block({
  icon: Icon,
  title,
  trailing,
  tone = "default",
  children,
  className,
}: {
  icon: typeof WrenchIcon;
  title: ReactNode;
  trailing?: ReactNode;
  tone?: "default" | "muted" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border rounded-sm font-mono text-xs bg-background",
        tone === "danger" ? "border-destructive/40" : "border-primary/18",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 border-b uppercase tracking-wide font-semibold",
          tone === "danger"
            ? "border-destructive/30 text-destructive bg-destructive/5"
            : "border-primary/18 text-secondary-foreground bg-secondary",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{title}</span>
        {trailing !== undefined && (
          <span className="ml-auto normal-case tracking-normal font-normal opacity-70 shrink-0">
            {trailing}
          </span>
        )}
      </div>
      {children !== undefined && <div className="px-2.5 py-2">{children}</div>}
    </div>
  );
}

function Pulse() {
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />;
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full",
        ok ? "bg-emerald-600" : "bg-destructive",
      )}
    />
  );
}

/* ── Parts ─────────────────────────────────────────────────────────────── */

const TOOL_ICONS: Record<string, typeof WrenchIcon> = {
  bash: SquareChevronRightIcon,
  read: FileTextIcon,
  write: FilePenIcon,
  edit: FilePenIcon,
  grep: SearchIcon,
  glob: FolderSearchIcon,
};

const STATUS_LABEL: Record<string, string> = {
  "input-streaming": "preparing",
  "input-available": "running",
  "approval-requested": "waiting for approval",
  "approval-responded": "approval sent",
  "output-available": "done",
  "output-error": "failed",
  "output-denied": "denied",
};

function summarizeInput(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const o = input as Record<string, unknown>;
  const pick = o.file_path ?? o.command ?? o.pattern ?? o.app ?? o.server_name ?? o.plan;
  if (typeof pick === "string") return pick;
  const json = JSON.stringify(o);
  return json === "{}" ? "" : json;
}

function ToolPart({
  name,
  state,
  input,
  output,
  errorText,
  approvalId,
  dynamic,
  onApproval,
}: {
  name: string;
  state: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
  approvalId?: string;
  dynamic?: boolean;
  onApproval?: ApprovalResponder;
}) {
  const Icon = TOOL_ICONS[name] ?? (dynamic ? PlugZapIcon : WrenchIcon);
  const running = state === "input-streaming" || state === "input-available";
  const awaiting = state === "approval-requested";
  const failed = state === "output-error" || state === "output-denied";
  const summary = summarizeInput(input);
  const showOutput =
    (state === "output-available" && name === "bash" && output != null) || state === "output-error";
  return (
    <Block
      icon={awaiting ? ShieldQuestionIcon : Icon}
      title={name}
      tone={failed ? "danger" : "default"}
      trailing={
        <span className="flex items-center gap-1.5">
          {running || awaiting ? <Pulse /> : <Dot ok={!failed} />}
          {STATUS_LABEL[state] ?? state}
        </span>
      }
    >
      {summary !== "" && (
        <pre className="whitespace-pre-wrap break-all text-foreground">{summary}</pre>
      )}
      {awaiting && approvalId !== undefined && onApproval !== undefined && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-primary/18">
          <span className="text-muted-foreground mr-auto">Devin wants to run this command.</span>
          <Button
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => {
              onApproval({ id: approvalId, approved: false });
            }}
          >
            <XIcon className="w-3 h-3" /> Deny
          </Button>
          <Button
            className="h-6 px-2 text-xs"
            onClick={() => {
              onApproval({ id: approvalId, approved: true });
            }}
          >
            <CheckIcon className="w-3 h-3" /> Allow
          </Button>
        </div>
      )}
      {showOutput && (
        <pre className="mt-2 pt-2 border-t border-primary/18 max-h-44 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
          {state === "output-error"
            ? (errorText ?? "tool error")
            : typeof output === "string"
              ? output
              : JSON.stringify(output, null, 2)}
        </pre>
      )}
    </Block>
  );
}

function ReasoningPart({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? streaming;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="border border-dashed border-primary/25 rounded-sm font-mono text-xs">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full px-2.5 py-1 text-left uppercase tracking-wide font-semibold text-muted-foreground hover:text-primary cursor-pointer"
        onClick={() => {
          setOpen(!expanded);
        }}
      >
        <ChevronRightIcon
          className={cn("w-3 h-3 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        <BrainIcon className="w-3.5 h-3.5 shrink-0" />
        <span>Reasoning</span>
        <span className="ml-auto normal-case tracking-normal font-normal flex items-center gap-1.5">
          {streaming ? (
            <>
              <Pulse /> thinking
            </>
          ) : (
            `${String(words)} words`
          )}
        </span>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 pt-1 text-muted-foreground border-t border-dashed border-primary/20">
          <Prose>{text}</Prose>
        </div>
      )}
    </div>
  );
}

/**
 * Markdown at the same scale as the tool blocks. Streamdown's defaults are
 * sized for a document; this pulls headings, paragraphs, lists and code
 * blocks down to the console's 12px mono rhythm and drops the code toolbar.
 */
const PROSE =
  "text-xs leading-relaxed [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:my-1.5 [&_h2]:my-1.5 [&_h3]:my-1.5 " +
  "[&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 " +
  "[&_[data-streamdown=code-block]]:my-1.5 [&_[data-streamdown=code-block]]:rounded-sm [&_[data-streamdown=code-block]]:border [&_[data-streamdown=code-block]]:border-primary/18 [&_[data-streamdown=code-block]]:bg-secondary " +
  "[&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block-body]]:p-2 [&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:text-[11px] [&_pre]:leading-relaxed " +
  "[&_code]:text-[11px] [&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px";

function Prose({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("font-mono", PROSE, className)}>
      <Streamdown controls={false}>{children}</Streamdown>
    </div>
  );
}

function TextPart({ text, role }: { text: string; role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="inline-block max-w-full text-left px-2.5 py-1.5 border border-primary/18 bg-secondary rounded-sm">
        <Prose>{text}</Prose>
      </div>
    );
  }
  return (
    <div className="px-2.5 py-2 border border-primary/18 bg-background rounded-sm">
      <Prose>{text}</Prose>
    </div>
  );
}

function MessagePart({
  part,
  role,
  onApproval,
}: {
  part: DevinUIMessage["parts"][number];
  role: "user" | "assistant";
  onApproval?: ApprovalResponder;
}) {
  if (part.type === "text") return <TextPart text={part.text} role={role} />;
  if (part.type === "reasoning") {
    return <ReasoningPart text={part.text} streaming={part.state === "streaming"} />;
  }
  if (part.type === "dynamic-tool") {
    return (
      <ToolPart
        name={part.toolName}
        state={part.state}
        input={part.input}
        output={part.state === "output-available" ? part.output : undefined}
        errorText={part.state === "output-error" ? part.errorText : undefined}
        approvalId={part.state === "approval-requested" ? part.approval.id : undefined}
        onApproval={onApproval}
        dynamic
      />
    );
  }
  if (part.type.startsWith("tool-")) {
    const p = part as {
      state: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      approval?: { id: string };
    };
    return (
      <ToolPart
        name={part.type.slice(5)}
        state={p.state}
        input={p.input}
        output={p.output}
        errorText={p.errorText}
        approvalId={p.state === "approval-requested" ? p.approval?.id : undefined}
        onApproval={onApproval}
      />
    );
  }
  return null;
}

export const Message = memo(function Message({
  message,
  onApproval,
}: {
  message: DevinUIMessage;
  onApproval?: ApprovalResponder;
}) {
  const user = message.role === "user";
  return (
    <div className={cn(user ? "ml-24 flex flex-col items-end" : "mr-16")}>
      <div
        className={cn(
          "flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-mono font-semibold text-muted-foreground mb-1",
          user && "justify-end",
        )}
      >
        {user ? "you" : <DevinDashed className="w-3.5 h-3.5" />}
        {!user && "devin"}
      </div>
      <div className={cn("space-y-1.5", user && "flex flex-col items-end")}>
        {message.parts.map((part, index) => (
          <MessagePart
            key={index}
            part={part}
            role={user ? "user" : "assistant"}
            onApproval={onApproval}
          />
        ))}
      </div>
    </div>
  );
});
