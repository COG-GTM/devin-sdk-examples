"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import {
  CircleCheckIcon,
  FolderTreeIcon,
  GlobeIcon,
  LayersIcon,
  MessageCircleIcon,
  ServerIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { StickToBottom } from "use-stick-to-bottom";

import type { BootData, DevinUIMessage } from "@/lib/agent";
import { deleteSession, refreshSessions, useSandbox, useSessions, useTranscript } from "@/lib/api";
import type { SessionMeta } from "@/lib/session-store";
import { Composer } from "@/components/composer";
import { DevinDashed } from "@/components/devin-mark";
import { FileExplorer } from "@/components/file-explorer";
import { Message } from "@/components/message";
import { Columns, Panel, PanelHeader, Rows } from "@/components/panels";
import { PreviewPane, SandboxDetails } from "@/components/sandbox-panel";
import { SessionsRail } from "@/components/sessions-rail";
import { deriveStatus, StatusLine } from "@/components/status-line";
import { notify } from "@/components/toaster";
import { LoadError, Skeleton, SkeletonLines } from "@/components/ui";

const TEST_PROMPTS = [
  "Build a React todo list app with Vite and start it on port 5173",
  "Write a Python script that prints the primes under 100 and run it",
  "Scaffold a tiny Node HTTP server with a notes API and a test, then run the tests",
];

/** A chat id for a session that does not exist yet; the first turn creates it. */
const draftId = () => `chat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function PanelTitle({ icon: Icon, children }: { icon: typeof ServerIcon; children: ReactNode }) {
  return (
    <div className="flex items-center font-mono font-semibold uppercase">
      <Icon className="mr-2 w-4" />
      {children}
    </div>
  );
}

export function Console() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  const { data: sessions, mutate } = useSessions();

  // First load: open the most recent session, or a draft.
  useEffect(() => {
    if (activeId === null && sessions !== undefined) setActiveId(sessions[0]?.id ?? draftId());
  }, [activeId, sessions]);

  useFinishedTurnToasts(sessions, activeId, setActiveId);

  const onDelete = (id: string) => {
    if (id === activeId) setActiveId(sessions?.find((s) => s.id !== id)?.id ?? draftId());
    setDeleting((d) => new Set(d).add(id));
    void deleteSession(id)
      .then(() => {
        void mutate((list) => list?.filter((s) => s.id !== id), { revalidate: false });
        toast.success("Session deleted", { description: "Its sandbox was stopped." });
      })
      .catch((error: unknown) => {
        toast.error("Could not delete the session", {
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        setDeleting((d) => {
          const next = new Set(d);
          next.delete(id);
          return next;
        });
      });
  };

  const rail = (
    <Panel className="flex-1 overflow-hidden">
      <PanelHeader>
        <PanelTitle icon={LayersIcon}>Sessions</PanelTitle>
        <div className="ml-auto font-mono text-xs opacity-50">{sessions?.length ?? ""}</div>
      </PanelHeader>
      <SessionsRail
        sessions={sessions ?? null}
        deleting={deleting}
        activeId={activeId}
        busy={activeId === null}
        onSelect={setActiveId}
        onNew={() => {
          setActiveId(draftId());
        }}
        onDelete={onDelete}
      />
    </Panel>
  );

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden p-2">
      <header className="flex items-center justify-between w-full">
        <div className="flex items-center">
          <DevinDashed className="ml-1 md:ml-2.5 mr-1.5" />
          <span className="hidden md:inline text-sm uppercase font-mono font-bold tracking-tight">
            Devin Harness Console
          </span>
        </div>
        <span className="hidden md:inline ml-auto font-mono text-xs text-muted-foreground">
          AI SDK HarnessAgent · Vercel Sandbox
        </span>
      </header>
      <div className="flex-1 w-full min-h-0 overflow-hidden pt-2">
        {activeId === null ? (
          <Columns left={rail} center={<ChatSkeleton />} right={<SidebarSkeleton />} />
        ) : (
          <Session key={activeId} chatId={activeId} rail={rail} />
        )}
      </div>
    </div>
  );
}

/**
 * Toast when a session other than the one on screen goes from streaming to
 * idle. Turns keep running server-side while their chat is off screen, so
 * this is how the user learns one finished.
 */
function useFinishedTurnToasts(
  sessions: SessionMeta[] | undefined,
  activeId: string | null,
  onOpen: (id: string) => void,
) {
  const previous = useRef<SessionMeta[]>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = sessions;
    if (before === undefined || sessions === undefined) return;
    const wasActive = new Set(before.filter((s) => s.active).map((s) => s.id));
    for (const s of sessions) {
      if (wasActive.has(s.id) && !s.active && s.id !== activeId) {
        notify({
          icon: <CircleCheckIcon className="size-3.5 text-emerald-600" />,
          title: "Devin finished a turn",
          description: s.title ?? s.id,
          onClick: () => {
            onOpen(s.id);
          },
        });
      }
    }
  }, [sessions, activeId, onOpen]);
}

/** Loads the transcript for a chat, then mounts the chat itself. */
function Session({ chatId, rail }: { chatId: string; rail: ReactNode }) {
  const { data: transcript, error, isValidating, mutate } = useTranscript(chatId);
  if (error) {
    return (
      <Columns
        left={rail}
        center={
          <Panel className="flex-1 overflow-hidden">
            <PanelHeader>
              <PanelTitle icon={MessageCircleIcon}>Chat</PanelTitle>
            </PanelHeader>
            <LoadError message="Couldn't load this session" onRetry={() => void mutate()} />
          </Panel>
        }
        right={<SidebarSkeleton />}
      />
    );
  }
  if (transcript === undefined || isValidating) {
    return <Columns left={rail} center={<ChatSkeleton />} right={<SidebarSkeleton />} />;
  }
  return <Chat chatId={chatId} initialMessages={transcript} rail={rail} />;
}

function Chat({
  chatId,
  initialMessages,
  rail,
}: {
  chatId: string;
  initialMessages: DevinUIMessage[];
  rail: ReactNode;
}) {
  const [input, setInput] = useState("");
  const [boot, setBoot] = useState<BootData | null>(null);
  const { messages, sendMessage, status, error, stop, addToolApprovalResponse } =
    useChat<DevinUIMessage>({
      id: chatId,
      messages: initialMessages,
      // Reconnect to a turn still streaming for this chat.
      resume: true,
      transport: new DefaultChatTransport({ api: "/api/chat" }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onData: (part) => {
        if (part.type === "data-boot") setBoot(part.data as BootData);
      },
      onFinish: () => void refreshSessions(),
    });
  const busy = status === "submitted" || status === "streaming";
  const { data: sandbox, error: sandboxError, mutate: refreshSandbox } = useSandbox(chatId, busy);
  const last = messages.at(-1);
  const statusLine = deriveStatus({ busy, progress: boot, last, error });
  const awaitingApproval =
    !busy &&
    last?.role === "assistant" &&
    last.parts.some((p) => "state" in p && p.state === "approval-requested");

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBoot(null);
    setInput("");
    void sendMessage({ text: trimmed });
  };

  const chatPanel = (
    <Panel className="flex-1 overflow-hidden">
      <PanelHeader>
        <PanelTitle icon={MessageCircleIcon}>Chat</PanelTitle>
        <div className="ml-auto font-mono text-xs opacity-50">[{status}]</div>
      </PanelHeader>

      {messages.length === 0 ? (
        <div className="flex flex-1 min-h-0 flex-col justify-center items-center font-mono text-sm text-muted-foreground px-6">
          <p className="max-w-md text-center text-xs leading-relaxed mb-4">
            Your first message creates this session: an empty workspace in its own sandbox, with
            Devin running inside it. The Files and Preview panels look into that sandbox.
          </p>
          <p className="font-semibold">Try one of these:</p>
          <ul className="flex flex-col gap-1 p-4 text-center">
            {TEST_PROMPTS.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  className="w-full px-4 py-2 rounded-sm border border-dashed shadow-sm cursor-pointer border-border hover:bg-secondary/50 hover:text-primary"
                  onClick={() => {
                    submit(prompt);
                  }}
                >
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <StickToBottom
          className="relative flex-1 min-h-0 overflow-y-auto"
          resize="smooth"
          initial="instant"
        >
          <StickToBottom.Content className="flex flex-col gap-4 p-4">
            {messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                onApproval={(response) => void addToolApprovalResponse(response)}
              />
            ))}
          </StickToBottom.Content>
        </StickToBottom>
      )}

      <StatusLine status={statusLine} />
      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => {
          submit(input);
        }}
        onStop={() => void stop()}
        busy={busy}
        disabled={awaitingApproval}
        placeholder={
          awaitingApproval ? "Answer the pending approval above to continue" : "Message Devin…"
        }
      />
    </Panel>
  );

  const sidebar = (
    <Rows
      top={
        <Panel className="flex-1 overflow-hidden">
          <PanelHeader>
            <PanelTitle icon={ServerIcon}>Sandbox</PanelTitle>
          </PanelHeader>
          <SandboxDetails
            chatId={chatId}
            info={sandbox ?? null}
            error={sandboxError}
            onRefresh={() => void refreshSandbox()}
          />
        </Panel>
      }
      middle={
        <Panel className="flex-1 overflow-hidden">
          <PanelHeader>
            <PanelTitle icon={GlobeIcon}>Preview</PanelTitle>
            <div className="ml-auto font-mono text-xs opacity-50">
              {sandbox?.previews?.map((p) => `:${String(p.port)}`).join(" ")}
            </div>
          </PanelHeader>
          <PreviewPane info={sandbox ?? null} error={sandboxError} />
        </Panel>
      }
      bottom={
        <Panel className="flex-1 overflow-hidden">
          <PanelHeader>
            <PanelTitle icon={FolderTreeIcon}>Files</PanelTitle>
          </PanelHeader>
          <FileExplorer chatId={chatId} busy={busy} />
        </Panel>
      }
    />
  );

  return (
    <>
      <div className="flex h-full w-full md:hidden">{chatPanel}</div>
      <div className="hidden h-full w-full md:block">
        <Columns left={rail} center={chatPanel} right={sidebar} />
      </div>
    </>
  );
}

function PanelSkeleton({
  icon,
  title,
  children,
}: {
  icon: typeof ServerIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Panel className="flex-1 overflow-hidden">
      <PanelHeader>
        <PanelTitle icon={icon}>{title}</PanelTitle>
      </PanelHeader>
      <div className="flex-1 min-h-0 p-2.5" aria-busy>
        {children}
      </div>
    </Panel>
  );
}

function ChatSkeleton() {
  return (
    <PanelSkeleton icon={MessageCircleIcon} title="Chat">
      <div className="flex flex-col gap-4 p-1.5">
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-2.5 w-8" />
          <Skeleton className="h-7 w-2/3" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-2.5 w-10" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <div className="rounded-sm border border-primary/18 p-2.5">
            <SkeletonLines lines={3} />
          </div>
        </div>
      </div>
    </PanelSkeleton>
  );
}

function SidebarSkeleton() {
  return (
    <Rows
      top={
        <PanelSkeleton icon={ServerIcon} title="Sandbox">
          <SkeletonLines lines={5} />
        </PanelSkeleton>
      }
      middle={
        <PanelSkeleton icon={GlobeIcon} title="Preview">
          <Skeleton className="h-full w-full" />
        </PanelSkeleton>
      }
      bottom={
        <PanelSkeleton icon={FolderTreeIcon} title="Files">
          <SkeletonLines lines={5} />
        </PanelSkeleton>
      }
    />
  );
}
