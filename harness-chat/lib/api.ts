"use client";

import useSWR, { mutate, type SWRConfiguration } from "swr";

import type { DevinUIMessage } from "./agent";
import type { SessionMeta } from "./session-store";
import type { FileNode, SandboxInfo } from "./workspace";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

const sessionsKey = "/api/sessions";
const sessionKey = (chatId: string) => `/api/sessions/${encodeURIComponent(chatId)}`;
const sandboxKey = (chatId: string) => `/api/sandbox?chatId=${encodeURIComponent(chatId)}`;
const workspaceKey = (chatId: string, file?: string) =>
  `/api/workspace?chatId=${encodeURIComponent(chatId)}` +
  (file === undefined ? "" : `&file=${encodeURIComponent(file)}`);

export function useSessions(config?: SWRConfiguration<SessionMeta[]>) {
  return useSWR<SessionMeta[]>(
    sessionsKey,
    (url: string) => getJson<{ sessions: SessionMeta[] }>(url).then((d) => d.sessions),
    { revalidateOnFocus: false, refreshInterval: 5000, ...config },
  );
}

export const refreshSessions = () => mutate(sessionsKey);

export async function deleteSession(chatId: string): Promise<void> {
  const res = await fetch(sessionKey(chatId), { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
}

/**
 * The saved transcript. It seeds `useChat`, which owns the messages from then
 * on, so a cached copy is stale by definition: every mount refetches, and
 * callers should wait for `isValidating` to clear before using `data`.
 */
export function useTranscript(chatId: string) {
  return useSWR<DevinUIMessage[], Error>(
    sessionKey(chatId),
    (url: string) => getJson<{ messages: DevinUIMessage[] }>(url).then((d) => d.messages),
    {
      revalidateOnMount: true,
      dedupingInterval: 0,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}

export function useSandbox(chatId: string, busy: boolean) {
  return useSWR<SandboxInfo, Error>(sandboxKey(chatId), getJson, {
    revalidateOnFocus: false,
    refreshInterval: busy ? 4000 : 20000,
  });
}

export function useWorkspaceFiles(chatId: string, busy: boolean) {
  return useSWR<{ exists: boolean; files: FileNode[] }, Error>(workspaceKey(chatId), getJson, {
    revalidateOnFocus: false,
    refreshInterval: busy ? 4000 : 0,
  });
}

export function useWorkspaceFile(chatId: string, file: string | null, busy: boolean) {
  return useSWR<{ content: string; truncated: boolean }, Error>(
    file === null ? null : workspaceKey(chatId, file),
    getJson,
    { revalidateOnFocus: false, refreshInterval: busy ? 4000 : 0 },
  );
}
