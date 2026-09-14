import type { DevinChatMessage } from "@cognition-ai/cloudflare-agents";
import type { CognitionAcp, PlanEntry, ToolCallDetail } from "@cognition-ai/sdk";
import { code } from "@streamdown/code";
import { getToolName, isToolUIPart } from "ai";
import {
  BrainIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  FilePenIcon,
  FileTextIcon,
  FolderSearchIcon,
  FolderTreeIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  MonitorIcon,
  OctagonAlertIcon,
  PlugZapIcon,
  ShieldQuestionIcon,
  SquareChevronRightIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";

import { toolDetail, type ToolPartArg } from "../lib/tools";
import { cn } from "../lib/utils";
import { Button, DevinDashed, Dot, Pulse } from "./ui";

type Part = DevinChatMessage["parts"][number];

/** What the chat can do for the user from inside a message. */
export interface MessageActions {
  /** Answer a live permission prompt (an AI SDK tool approval). */
  onApproval: (response: { id: string; approved: boolean }) => void;
  /** Answer a cloud `permission_request` tool call. */
  onPermission: (response: { requestId: string; approved: boolean }) => void;
  /** Put a suggested reply in the composer (e.g. an `ask_user_question` option). */
  onSuggest: (text: string) => void;
}

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
  icon: LucideIcon;
  title: ReactNode;
  trailing?: ReactNode;
  tone?: "default" | "muted" | "danger" | "attention";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border rounded-sm font-mono text-xs bg-background",
        tone === "danger" && "border-destructive/40",
        tone === "attention" && "border-amber-500/50",
        tone !== "danger" && tone !== "attention" && "border-primary/18",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 border-b uppercase tracking-wide font-semibold",
          tone === "danger"
            ? "border-destructive/30 text-destructive bg-destructive/5"
            : tone === "attention"
              ? "border-amber-500/30 text-amber-700 bg-amber-500/5"
              : "border-primary/18 text-secondary-foreground bg-secondary",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{title}</span>
        {trailing !== undefined && (
          <span className="ml-auto normal-case tracking-normal font-normal opacity-70 shrink-0 flex items-center gap-1.5">
            {trailing}
          </span>
        )}
      </div>
      {children !== undefined && <div className="px-2.5 py-2">{children}</div>}
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

function Prose({
  children,
  animating = false,
  className,
}: {
  children: string;
  animating?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("font-mono", PROSE, className)}>
      <Streamdown controls={false} plugins={{ code }} isAnimating={animating}>
        {citations(children)}
      </Streamdown>
    </div>
  );
}

function AllowDeny({
  prompt,
  onAnswer,
}: {
  prompt: string;
  onAnswer: (approved: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-primary/18">
      <span className="text-muted-foreground mr-auto">{prompt}</span>
      <Button
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={() => {
          onAnswer(false);
        }}
      >
        <XIcon className="w-3 h-3" /> Deny
      </Button>
      <Button
        className="h-6 px-2 text-xs"
        onClick={() => {
          onAnswer(true);
        }}
      >
        <CheckIcon className="w-3 h-3" /> Allow
      </Button>
    </div>
  );
}

/* ── Devin tool calls ──────────────────────────────────────────────────── */

/** `key ctrl+l · type · wait 5s · screenshot` */
function describeActions(actions: CognitionAcp.CognitionComputerUseAction[]): string {
  return actions
    .map((action) => {
      switch (action.action_type) {
        case "key":
          return `key ${action.key ?? ""}`.trim();
        case "wait":
          return action.duration != null ? `wait ${String(action.duration)}s` : "wait";
        default:
          return action.action_type.replaceAll("_", " ");
      }
    })
    .join(" · ");
}

/**
 * The call's output as text: the SDK's `text` (the call's content blocks)
 * when there is one, else the agent's raw output, which for shell commands is
 * the captured stdout/stderr.
 */
function outputText(part: ToolPartArg): string | undefined {
  const output = "output" in part ? part.output : undefined;
  if (typeof output === "string") return output === "" ? undefined : output;
  if (typeof output !== "object" || output === null) return undefined;
  if ("text" in output && typeof output.text === "string" && output.text !== "") {
    return output.text;
  }
  const raw = "rawOutput" in output ? output.rawOutput : undefined;
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && "output" in raw && typeof raw.output === "string") {
    return raw.output === "" ? undefined : raw.output;
  }
  const json = JSON.stringify(raw, null, 2);
  return json === "{}" || json === "[]" ? undefined : json;
}

/**
 * Devin cites files as `<ref_file file="…" />` / `<ref_snippet file="…" lines="a-b" />`,
 * which the Devin app turns into links. Here they become inline code.
 */
function citations(text: string): string {
  return text
    .replace(/<ref_snippet\s+file="([^"]+)"\s+lines="([^"]+)"\s*\/>/g, "`$1:$2`")
    .replace(/<ref_file\s+file="([^"]+)"\s*\/>/g, "`$1`");
}

/**
 * Internal cloud bookkeeping surfaced as tool calls ("ACU usage reset",
 * "context growth updated", rule injections, post-session analysis): no
 * input, no output, nothing to show. The Devin app hides them too. Their
 * completion often never arrives, so the only "error" they carry is the
 * stream's own "did not finish".
 */
function isHousekeeping(part: ToolPartArg, detail: ToolCallDetail | undefined): boolean {
  if (detail !== undefined && detail.tool !== "other") return false;
  const input = "input" in part ? part.input : undefined;
  const hasInput =
    input !== undefined &&
    input !== null &&
    !(typeof input === "object" && Object.keys(input).length === 0);
  if (hasInput || outputText(part) !== undefined) return false;
  return part.state !== "output-error" || part.errorText === "Tool call did not finish.";
}

const STATUS_LABEL: Record<string, string> = {
  "input-streaming": "preparing",
  "input-available": "running",
  "approval-requested": "waiting for approval",
  "approval-responded": "approval sent",
  "output-available": "done",
  "output-error": "failed",
  "output-denied": "denied",
};

function fileSummary(files: { path: string; linesAdded?: number; linesRemoved?: number }[]) {
  return files.map((file) => (
    <div key={file.path} className="flex items-baseline gap-2 min-w-0">
      <span className="truncate text-foreground">{file.path}</span>
      {(file.linesAdded !== undefined || file.linesRemoved !== undefined) && (
        <span className="shrink-0 text-muted-foreground">
          {file.linesAdded !== undefined && (
            <span className="text-emerald-600">+{String(file.linesAdded)}</span>
          )}{" "}
          {file.linesRemoved !== undefined && (
            <span className="text-destructive">−{String(file.linesRemoved)}</span>
          )}
        </span>
      )}
    </div>
  ));
}

function ToolPart({
  part,
  streaming,
  actions,
}: {
  part: ToolPartArg;
  /** The turn is still streaming; otherwise an unfinished call was interrupted. */
  streaming: boolean;
  actions: MessageActions;
}) {
  const detail = toolDetail(part);
  if (isHousekeeping(part, detail)) return null;

  const unfinished = part.state === "input-streaming" || part.state === "input-available";
  const running = unfinished && streaming;
  const interrupted = unfinished && !streaming;
  const failed = part.state === "output-error" || part.state === "output-denied";
  const title = "title" in part && typeof part.title === "string" ? part.title : undefined;
  const text = outputText(part);
  const errorText = part.state === "output-error" ? part.errorText : undefined;
  const statusLabel = interrupted ? "interrupted" : (STATUS_LABEL[part.state] ?? part.state);
  const trailing = (
    <>
      {running ? (
        <Pulse />
      ) : interrupted ? (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground" />
      ) : (
        <Dot ok={!failed} />
      )}
      {statusLabel}
    </>
  );
  const approval =
    part.state === "approval-requested" ? (
      <AllowDeny
        prompt="Devin wants to run this."
        onAnswer={(approved) => {
          actions.onApproval({ id: part.approval.id, approved });
        }}
      />
    ) : null;
  const outputBlock = (
    <>
      {(text !== undefined || errorText !== undefined) && (
        <pre className="mt-2 pt-2 border-t border-primary/18 max-h-44 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
          {errorText ?? text}
        </pre>
      )}
      {approval}
    </>
  );

  switch (detail?.tool) {
    case "exec": {
      const exit = detail.exitCode;
      return (
        <Block
          icon={SquareChevronRightIcon}
          title="bash"
          tone={failed ? "danger" : "default"}
          trailing={
            <>
              {detail.background && <span>background</span>}
              {exit !== undefined ? (
                <>
                  <Dot ok={exit === 0} /> exit {String(exit)}
                </>
              ) : (
                trailing
              )}
            </>
          }
        >
          <pre className="whitespace-pre-wrap break-all text-foreground">
            <span className="text-muted-foreground select-none">$ </span>
            {detail.command ?? ""}
          </pre>
          {detail.cwd !== undefined && detail.cwd !== "" && (
            <div className="mt-1 text-muted-foreground truncate">in {detail.cwd}</div>
          )}
          {outputBlock}
        </Block>
      );
    }
    case "read":
    case "write":
    case "edit": {
      const Icon = detail.tool === "read" ? FileTextIcon : FilePenIcon;
      const files =
        detail.files.length > 0 ? detail.files : detail.path ? [{ path: detail.path }] : [];
      return (
        <Block
          icon={Icon}
          title={detail.tool}
          tone={failed ? "danger" : "default"}
          trailing={trailing}
        >
          {files.length > 0 ? fileSummary(files) : title}
          {detail.tool !== "read" && outputBlock}
          {detail.tool === "read" && errorText !== undefined && outputBlock}
        </Block>
      );
    }
    case "list_directory":
      return (
        <Block icon={FolderTreeIcon} title="list" trailing={trailing}>
          <span className="text-foreground">{detail.path ?? title}</span>
        </Block>
      );
    case "file_search":
      return (
        <Block icon={FolderSearchIcon} title="search" trailing={trailing}>
          <span className="text-foreground">{detail.query ?? title}</span>
          {detail.path !== undefined && (
            <span className="text-muted-foreground"> in {detail.path}</span>
          )}
          {outputBlock}
        </Block>
      );
    case "mcp":
      return (
        <Block
          icon={PlugZapIcon}
          title={detail.server !== undefined ? `${detail.server} · ${detail.name}` : detail.name}
          tone={failed ? "danger" : "default"}
          trailing={trailing}
        >
          {detail.args !== undefined && detail.args !== null && (
            <pre className="whitespace-pre-wrap break-all text-foreground max-h-32 overflow-auto">
              {typeof detail.args === "string" ? detail.args : JSON.stringify(detail.args, null, 2)}
            </pre>
          )}
          {outputBlock}
        </Block>
      );
    case "permission_request": {
      const pending = !failed && part.state !== "output-available" && !interrupted;
      return (
        <Block
          icon={ShieldQuestionIcon}
          title={`permission · ${detail.permissionType.replaceAll("_", " ")}`}
          tone={pending ? "attention" : failed ? "danger" : "default"}
          trailing={pending ? <Pulse /> : trailing}
        >
          {detail.command !== undefined && (
            <pre className="whitespace-pre-wrap break-all text-foreground">{detail.command}</pre>
          )}
          {title !== undefined && title !== detail.command && (
            <div className="text-muted-foreground mt-1">{title}</div>
          )}
          {pending && detail.requestId !== undefined && (
            <AllowDeny
              prompt="Devin is waiting for your answer."
              onAnswer={(approved) => {
                actions.onPermission({ requestId: detail.requestId ?? "", approved });
              }}
            />
          )}
          {outputBlock}
        </Block>
      );
    }
    case "ask_user_question":
      return (
        <Block icon={MessageCircleQuestionIcon} title="question" tone="attention">
          <div className="space-y-2">
            {detail.questions.map((question, index) => (
              <div key={index} className="space-y-1">
                {question.header != null && question.header !== "" && (
                  <span className="inline-block px-1.5 py-px rounded-sm bg-secondary border border-primary/18 uppercase tracking-wide text-[10px] text-muted-foreground">
                    {question.header}
                  </span>
                )}
                <div className="text-foreground">{question.question}</div>
                {question.options !== undefined && question.options.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {question.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="px-2 py-0.5 rounded-sm border border-dashed border-border hover:bg-secondary hover:text-primary cursor-pointer"
                        onClick={() => {
                          actions.onSuggest(
                            question.header != null && question.header !== ""
                              ? `${question.header}: ${option}`
                              : option,
                          );
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Block>
      );
    case "computer_use":
      return (
        <Block
          icon={MonitorIcon}
          title="browser"
          tone={failed ? "danger" : "default"}
          trailing={trailing}
        >
          <div className="text-foreground">{describeActions(detail.actions) || title}</div>
          {errorText !== undefined && outputBlock}
        </Block>
      );
    case "report_blocker":
      return (
        <Block
          icon={OctagonAlertIcon}
          title={`blocker${detail.severity !== undefined ? ` · ${detail.severity}` : ""}`}
          tone="danger"
        >
          {detail.headline !== undefined && (
            <div className="font-semibold text-foreground">{detail.headline}</div>
          )}
          <div className="text-muted-foreground mt-0.5">{detail.impact}</div>
        </Block>
      );
    default: {
      const input = "input" in part ? part.input : undefined;
      const summary =
        typeof input === "string" ? input : input === undefined ? "" : JSON.stringify(input);
      return (
        <Block
          icon={WrenchIcon}
          title={title ?? getToolName(part)}
          tone={failed ? "danger" : "default"}
          trailing={trailing}
        >
          {summary !== "" && summary !== "{}" && (
            <pre className="whitespace-pre-wrap break-all text-foreground max-h-32 overflow-auto">
              {summary}
            </pre>
          )}
          {outputBlock}
        </Block>
      );
    }
  }
}

/* ── Other parts ───────────────────────────────────────────────────────── */

/**
 * Devin's thoughts. Most are a few words of narration ("Writing primes
 * script") that the Devin app folds into its "Worked for …" summary; those
 * render as a quiet line. Longer thinking gets the collapsible block.
 */
function ReasoningPart({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? streaming;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!streaming && words <= 12 && !text.trim().includes("\n")) {
    return (
      <div className="flex items-center gap-1.5 px-1 font-mono text-[11px] text-muted-foreground">
        <BrainIcon className="w-3 h-3 shrink-0" />
        <span className="truncate">{text.trim()}</span>
      </div>
    );
  }
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
          <Prose animating={streaming}>{text}</Prose>
        </div>
      )}
    </div>
  );
}

function PlanPart({ entries }: { entries: PlanEntry[] }) {
  const done = entries.filter((entry) => entry.status === "completed").length;
  return (
    <Block
      icon={ListChecksIcon}
      title="plan"
      trailing={`${String(done)}/${String(entries.length)}`}
    >
      <ol className="space-y-1">
        {entries.map((entry, index) => (
          <li key={index} className="flex items-start gap-2">
            {entry.status === "completed" ? (
              <CircleCheckIcon className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-600" />
            ) : entry.status === "in_progress" ? (
              <LoaderCircleIcon className="w-3.5 h-3.5 mt-px shrink-0 animate-spin text-amber-600" />
            ) : (
              <CircleIcon className="w-3.5 h-3.5 mt-px shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                entry.status === "completed"
                  ? "text-muted-foreground line-through"
                  : "text-foreground",
              )}
            >
              {entry.content}
            </span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

function PullRequestPart({ url }: { url: string }) {
  const label = url.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 border border-primary/18 rounded-sm px-2.5 py-1.5 font-mono text-xs bg-background hover:bg-secondary hover:text-primary"
    >
      <GitPullRequestIcon className="w-3.5 h-3.5 shrink-0 text-accent-foreground" />
      <span className="truncate">{label}</span>
      <span className="ml-auto text-muted-foreground shrink-0">pull request</span>
    </a>
  );
}

function TextPart({
  text,
  role,
  animating,
}: {
  text: string;
  role: "user" | "assistant";
  animating: boolean;
}) {
  if (role === "user") {
    return (
      <div className="inline-block max-w-full text-left px-2.5 py-1.5 border border-primary/18 bg-secondary rounded-sm">
        <Prose>{text}</Prose>
      </div>
    );
  }
  return (
    <div className="px-2.5 py-2 border border-primary/18 bg-background rounded-sm">
      <Prose animating={animating}>{text}</Prose>
    </div>
  );
}

function MessagePart({
  part,
  role,
  streaming,
  actions,
}: {
  part: Part;
  role: "user" | "assistant";
  streaming: boolean;
  actions: MessageActions;
}) {
  if (part.type === "text") {
    if (part.text.length === 0 && part.state !== "streaming") return null;
    return (
      <TextPart text={part.text} role={role} animating={streaming && part.state === "streaming"} />
    );
  }
  if (part.type === "reasoning") {
    if (part.text.length === 0 && part.state !== "streaming") return null;
    return <ReasoningPart text={part.text} streaming={streaming && part.state === "streaming"} />;
  }
  if (isToolUIPart(part)) return <ToolPart part={part} streaming={streaming} actions={actions} />;
  if (part.type === "data-devin-plan") return <PlanPart entries={part.data.entries} />;
  if (part.type === "data-devin-pull-request") return <PullRequestPart url={part.data.url} />;
  return null;
}

export const Message = memo(function Message({
  message,
  streaming,
  actions,
}: {
  message: DevinChatMessage;
  /** This message is the one still being streamed. */
  streaming: boolean;
  actions: MessageActions;
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
        {!user && streaming && <CircleDashedIcon className="w-3 h-3 animate-spin opacity-60" />}
      </div>
      <div className={cn("space-y-1.5", user && "flex flex-col items-end")}>
        {message.parts.map((part, index) => (
          <MessagePart
            key={index}
            part={part}
            role={user ? "user" : "assistant"}
            streaming={streaming}
            actions={actions}
          />
        ))}
      </div>
    </div>
  );
});
