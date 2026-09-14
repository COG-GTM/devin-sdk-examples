import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { DevinChatMessage, DevinChatState } from "@cognition-ai/cloudflare-agents";
import { useAgent } from "agents/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import {
  CircleCheckIcon,
  LayersIcon,
  MessageCircleIcon,
  RotateCcwIcon,
  ServerIcon,
  SquareKanbanIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { StickToBottom } from "use-stick-to-bottom";

import type { ChatSummary, RecentSession, SessionSnapshot, WorkspaceState } from "./server";
import { Composer } from "./components/composer";
import { Message, type MessageActions } from "./components/message";
import { Columns, Panel, PanelHeader, PanelTitle, Rows } from "./components/panels";
import { SessionDetails, WorkspacePanel } from "./components/session-panel";
import { SessionsRail } from "./components/sessions-rail";
import { deriveStatus, StatusLine } from "./components/status-line";
import { notify } from "./components/toaster";
import { Button, DevinDashed, Skeleton, SkeletonLines } from "./components/ui";
import { awaitingPermission as isAwaitingPermission } from "./lib/tools";
import { cn } from "./lib/utils";

// One shared workspace for the demo. Put your auth in front of the Worker and
// use the user's id here (see "Adding auth" in the README).
const DEMO_USER = "demo";

const TEST_PROMPTS = [
  "Write a Python script that prints the first 20 primes and run it",
  "Summarize the README of cloudflare/agents in five bullets",
  "Scaffold a tiny Node HTTP server with a notes API and a test, then run the tests",
];

/** How often a visible tab re-checks the session between turns while Devin works on its own. */
const SNAPSHOT_INTERVAL_MS = 10_000;
/** How often it re-checks a settled session: finished, asleep or waiting on the user. */
const SETTLED_SNAPSHOT_INTERVAL_MS = 60_000;

type ConnectionStatus = "connecting" | "connected" | "disconnected";

function connectionStatus(readyState: number): ConnectionStatus {
  if (readyState === WebSocket.OPEN) return "connected";
  if (readyState === WebSocket.CONNECTING) return "connecting";
  return "disconnected";
}

export function Console() {
  const workspace = useAgent<WorkspaceState>({ agent: "Workspace", name: DEMO_USER });
  const chats = useMemo(() => workspace.state?.chats ?? null, [workspace.state]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  const active = chats?.find((chat) => chat.id === activeId) ?? null;

  // First load: open the most recent chat.
  useEffect(() => {
    if (activeId === null && chats !== null && chats.length > 0) setActiveId(chats[0]?.id ?? null);
  }, [activeId, chats]);

  const createChat = useCallback(
    async (sessionId?: string) => {
      const created = await workspace.call<ChatSummary>("createChat", [
        sessionId === undefined ? {} : { sessionId },
      ]);
      setActiveId(created.id);
    },
    [workspace],
  );

  const deleteChat = useCallback(
    (id: string) => {
      if (id === activeId) setActiveId(chats?.find((chat) => chat.id !== id)?.id ?? null);
      setDeleting((d) => new Set(d).add(id));
      workspace
        .call("deleteChat", [id])
        .then(() => {
          toast.success("Chat deleted", {
            description: "Its Devin session keeps running in the cloud.",
          });
        })
        .catch((error: unknown) => {
          toast.error("Could not delete the chat", {
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
    },
    [activeId, chats, workspace],
  );

  const loadRecent = useCallback(
    () => workspace.call<RecentSession[]>("recentSessions"),
    [workspace],
  );

  const connection = connectionStatus(workspace.readyState);
  const configured = workspace.state?.configured ?? true;

  const rail = (
    <Panel className="flex-1 overflow-hidden">
      <PanelHeader>
        <PanelTitle icon={LayersIcon}>Chats</PanelTitle>
        <div className="ml-auto font-mono text-xs opacity-50">{chats?.length ?? ""}</div>
      </PanelHeader>
      <SessionsRail
        chats={chats}
        activeId={active?.id ?? null}
        deleting={deleting}
        busy={connection !== "connected"}
        onSelect={setActiveId}
        onNew={() => {
          createChat().catch((error: unknown) => {
            toast.error("Could not create a chat", {
              description: error instanceof Error ? error.message : String(error),
            });
          });
        }}
        onContinue={(sessionId) => createChat(sessionId)}
        loadRecent={loadRecent}
        onDelete={deleteChat}
      />
    </Panel>
  );

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden p-2">
      <header className="flex items-center justify-between w-full">
        <div className="flex items-center">
          <DevinDashed className="ml-1 md:ml-2.5 mr-1.5" />
          <span className="hidden md:inline text-sm uppercase font-mono font-bold tracking-tight">
            Devin on Cloudflare Agents
          </span>
        </div>
        <span className="hidden md:flex ml-auto items-center gap-3 font-mono text-xs text-muted-foreground">
          {!configured && (
            <span className="flex items-center gap-1.5 text-amber-700">
              <TriangleAlertIcon className="w-3.5 h-3.5" />
              DEVIN_API_KEY is not set
            </span>
          )}
          <span>AIChatAgent · Durable Objects · Devin cloud</span>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                connection === "connected"
                  ? "bg-emerald-600"
                  : connection === "connecting"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-destructive",
              )}
            />
            {connection}
          </span>
        </span>
      </header>
      <div className="flex-1 w-full min-h-0 overflow-hidden pt-2">
        {chats === null ? (
          <Columns left={rail} center={<ChatSkeleton />} right={<SidebarSkeleton />} />
        ) : active === null ? (
          <Columns
            left={rail}
            center={
              <Panel className="flex-1 overflow-hidden">
                <PanelHeader>
                  <PanelTitle icon={MessageCircleIcon}>Chat</PanelTitle>
                </PanelHeader>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 font-mono text-xs text-muted-foreground px-6 text-center">
                  <p className="max-w-md leading-relaxed">
                    Each chat is a Durable Object that owns one Devin cloud session. The transcript
                    and the session survive refreshes, hibernation and deploys.
                  </p>
                  <Button
                    variant="outline"
                    className="h-7 px-3 text-xs"
                    onClick={() => void createChat()}
                  >
                    Start a chat with Devin
                  </Button>
                </div>
              </Panel>
            }
            right={<SidebarSkeleton empty />}
          />
        ) : (
          <Chat key={active.id} chat={active} rail={rail} />
        )}
      </div>
    </div>
  );
}

function Chat({ chat, rail }: { chat: ChatSummary; rail: ReactNode }) {
  // The chat is a facet of the workspace: /agents/workspace/{DEMO_USER}/sub/devin-chat/{id}.
  const agent = useAgent<DevinChatState>({
    agent: "Workspace",
    name: DEMO_USER,
    sub: [{ agent: "DevinChat", name: chat.id }],
  });
  const state = agent.state;
  const { messages, sendMessage, status, stop, clearHistory, error, addToolApprovalResponse } =
    useAgentChat<DevinChatState, DevinChatMessage>({
      agent,
      experimental_throttle: 50,
      // Live permission prompts (when the agent sends them) resume the turn once answered.
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });
  const busy = status === "submitted" || status === "streaming";
  const sessionId = state?.sessionId ?? null;
  const hasSession = sessionId !== null;
  const { snapshot, error: snapshotError, loading, refresh } = useSnapshot(agent, sessionId, busy);

  const [input, setInput] = useState("");
  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    void sendMessage({ text: trimmed });
  };

  const actions = useMemo<MessageActions>(
    () => ({
      onApproval: (response) => void addToolApprovalResponse(response),
      onPermission: ({ requestId, approved }) => {
        agent
          .call("respondToPermission", [requestId, approved])
          .then(() => {
            toast.success(approved ? "Allowed" : "Denied", {
              description: "Devin continues in the cloud.",
            });
            refresh();
          })
          .catch((e: unknown) => {
            toast.error("Could not answer the request", {
              description: e instanceof Error ? e.message : String(e),
            });
          });
      },
      onSuggest: (text) => {
        setInput((current) => (current.trim() === "" ? text : `${current}\n${text}`));
      },
    }),
    [agent, refresh, addToolApprovalResponse],
  );

  const startOver = () => {
    agent
      .call("startOver")
      .then(() => {
        clearHistory();
        toast.success("New session", {
          description:
            "The old session keeps running in the cloud; the next message starts a new one.",
        });
      })
      .catch((e: unknown) => {
        toast.error("Could not start over", {
          description: e instanceof Error ? e.message : String(e),
        });
      });
  };

  useFinishedTurnToast(busy, messages);

  const last = messages.at(-1);
  const statusLine = deriveStatus({ busy, hasSession, state, snapshot, last, error });
  const awaitingPermission = isAwaitingPermission(last, busy);

  const chatPanel = (
    <Panel className="flex-1 overflow-hidden">
      <PanelHeader>
        <PanelTitle icon={MessageCircleIcon}>Chat</PanelTitle>
        <div className="ml-auto flex items-center gap-2 font-mono text-xs opacity-70">
          {hasSession && (
            <button
              type="button"
              className="flex items-center gap-1 hover:text-primary cursor-pointer"
              title="Detach from this Devin session; the next message starts a new one"
              onClick={startOver}
            >
              <RotateCcwIcon className="w-3 h-3" /> new session
            </button>
          )}
          <span className="opacity-70">[{status}]</span>
        </div>
      </PanelHeader>

      {messages.length === 0 ? (
        <div className="flex flex-1 min-h-0 flex-col justify-center items-center font-mono text-sm text-muted-foreground px-6">
          <p className="max-w-md text-center text-xs leading-relaxed mb-4">
            Your first message creates a Devin cloud session for this chat. Devin's replies,
            reasoning, tool calls, plans and pull requests stream in here; the panel on the right
            follows the session.
          </p>
          <p className="font-semibold">Try one of these:</p>
          <ul className="flex flex-col gap-1 p-4 text-center">
            {TEST_PROMPTS.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  className="w-full px-4 py-2 rounded-sm border border-dashed shadow-sm cursor-pointer border-border hover:bg-secondary/50 hover:text-primary text-xs"
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
            {messages.map((message, index) => (
              <Message
                key={message.id}
                message={message}
                streaming={
                  status === "streaming" &&
                  index === messages.length - 1 &&
                  message.role === "assistant"
                }
                actions={actions}
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
        disabled={awaitingPermission}
        placeholder={
          awaitingPermission
            ? "Answer the pending request above to continue"
            : busy
              ? "Devin is working — send when the turn ends, or stop it"
              : "Message Devin…"
        }
      />
    </Panel>
  );

  const sidebar = (
    <Rows
      top={
        <Panel className="flex-1 overflow-hidden">
          <PanelHeader>
            <PanelTitle icon={ServerIcon}>Session</PanelTitle>
          </PanelHeader>
          <SessionDetails
            chatId={chat.id}
            state={state}
            snapshot={snapshot}
            streaming={busy}
            error={snapshotError}
            loading={loading}
            onRefresh={refresh}
          />
        </Panel>
      }
      bottom={
        <Panel className="flex-1 overflow-hidden">
          <PanelHeader>
            <PanelTitle icon={SquareKanbanIcon}>Workspace</PanelTitle>
            <div className="ml-auto font-mono text-xs opacity-50">
              {snapshot !== null && snapshot.pullRequests.length > 0
                ? `${String(snapshot.pullRequests.length)} PR${snapshot.pullRequests.length === 1 ? "" : "s"}`
                : ""}
            </div>
          </PanelHeader>
          <WorkspacePanel
            plan={state?.plan ?? []}
            pullRequests={snapshot?.pullRequests ?? []}
            messages={messages}
          />
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

/**
 * The cloud's view of the session between turns; a turn's own events cover it
 * while streaming. Each fetch opens a Devin connection from the Worker, so
 * only a visible tab fetches: when a turn ends or the tab comes back, then on
 * a timer that slows down once the session settles.
 */
function useSnapshot(
  agent: ReturnType<typeof useAgent<DevinChatState>>,
  sessionId: string | null,
  busy: boolean,
) {
  // Keyed by session: after `startOver`, the earlier session's snapshot and
  // any answer still on its way about it don't describe this one.
  const [result, setResult] = useState<{
    sessionId: string;
    snapshot: SessionSnapshot | null;
    error: Error | null;
  } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const inflight = useRef<string | null>(null);
  const latest = useRef(sessionId);
  useEffect(() => {
    latest.current = sessionId;
  }, [sessionId]);
  const visible = useSyncExternalStore(subscribeToVisibility, isDocumentVisible);

  const refresh = useCallback(() => {
    if (sessionId === null || inflight.current === sessionId) return;
    inflight.current = sessionId;
    setPending(sessionId);
    agent
      .call<SessionSnapshot | null>("sessionSnapshot")
      .then((snapshot) => {
        if (latest.current === sessionId) setResult({ sessionId, snapshot, error: null });
      })
      .catch((e: unknown) => {
        if (latest.current !== sessionId) return;
        const error = e instanceof Error ? e : new Error(String(e));
        setResult((prev) => ({
          sessionId,
          snapshot: prev?.sessionId === sessionId ? prev.snapshot : null,
          error,
        }));
      })
      .finally(() => {
        if (inflight.current === sessionId) inflight.current = null;
        setPending((p) => (p === sessionId ? null : p));
      });
  }, [agent, sessionId]);

  const current = result?.sessionId === sessionId ? result : null;
  const snapshot = current?.snapshot ?? null;
  const settled =
    snapshot !== null && (snapshot.status !== "working" || snapshot.runtime === "suspended");

  const polling = sessionId !== null && !busy && visible;
  useEffect(() => {
    if (polling) refresh();
  }, [polling, refresh]);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(
      refresh,
      settled ? SETTLED_SNAPSHOT_INTERVAL_MS : SNAPSHOT_INTERVAL_MS,
    );
    return () => {
      clearInterval(timer);
    };
  }, [polling, settled, refresh]);

  return {
    snapshot,
    error: current?.error ?? null,
    loading: sessionId !== null && pending === sessionId,
    refresh,
  };
}

function subscribeToVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
  };
}

function isDocumentVisible(): boolean {
  return document.visibilityState === "visible";
}

/** A small toast when a turn finishes while the tab is in the background. */
function useFinishedTurnToast(busy: boolean, messages: readonly DevinChatMessage[]) {
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && document.visibilityState === "hidden") {
      const last = messages.at(-1);
      const text = last?.parts.find((part) => part.type === "text");
      notify({
        icon: <CircleCheckIcon className="size-3.5 text-emerald-600" />,
        title: "Devin finished a turn",
        description: text?.type === "text" ? text.text.slice(0, 80) : undefined,
      });
    }
    wasBusy.current = busy;
  }, [busy, messages]);
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

function SidebarSkeleton({ empty = false }: { empty?: boolean }) {
  return (
    <Rows
      top={
        <PanelSkeleton icon={ServerIcon} title="Session">
          {empty ? (
            <p className="font-mono text-xs text-muted-foreground">No chat selected.</p>
          ) : (
            <SkeletonLines lines={5} />
          )}
        </PanelSkeleton>
      }
      bottom={
        <PanelSkeleton icon={SquareKanbanIcon} title="Workspace">
          {empty ? null : <SkeletonLines lines={4} />}
        </PanelSkeleton>
      }
    />
  );
}
