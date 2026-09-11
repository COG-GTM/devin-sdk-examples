"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  RotateCwIcon,
} from "lucide-react";
import { useState } from "react";

import { useWorkspaceFile, useWorkspaceFiles } from "@/lib/api";
import type { FileNode } from "@/lib/workspace";
import { LoadError, Loading, Skeleton, SkeletonLines } from "@/components/ui";
import { cn } from "@/lib/utils";

function formatSize(size?: number): string {
  if (size === undefined) return "";
  if (size < 1024) return `${String(size)}B`;
  return `${(size / 1024).toFixed(1)}KB`;
}

function Tree({
  nodes,
  depth,
  selected,
  onSelect,
}: {
  nodes: FileNode[];
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={depth}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function TreeNode({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: `${String(depth * 12 + 8)}px` };
  if (node.type === "dir") {
    return (
      <div>
        <button
          type="button"
          style={pad}
          className="flex items-center gap-1.5 w-full py-0.5 pr-2 text-left hover:bg-secondary/60 cursor-pointer"
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          {open ? (
            <ChevronDownIcon className="w-3 h-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="w-3 h-3 shrink-0 text-muted-foreground" />
          )}
          {open ? (
            <FolderOpenIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FolderIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children && (
          <Tree nodes={node.children} depth={depth + 1} selected={selected} onSelect={onSelect} />
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      style={pad}
      className={cn(
        "flex items-center gap-1.5 w-full py-0.5 pr-2 text-left hover:bg-secondary/60 cursor-pointer",
        selected === node.path && "bg-secondary text-primary",
      )}
      onClick={() => {
        onSelect(node.path);
      }}
    >
      <span className="w-3 shrink-0" />
      <FileIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">{formatSize(node.size)}</span>
    </button>
  );
}

export function FileExplorer({ chatId, busy }: { chatId: string; busy: boolean }) {
  const { data, error, mutate } = useWorkspaceFiles(chatId, busy);
  const [selected, setSelected] = useState<string | null>(null);
  const file = useWorkspaceFile(chatId, selected, busy);

  return (
    <div className="flex flex-col flex-1 min-h-0 font-mono text-xs">
      <div className="flex items-center justify-between px-2 py-1 border-b border-border/60">
        <span className="text-muted-foreground truncate">
          {data === undefined ? (
            <Skeleton className="h-3 w-48" />
          ) : data.exists ? (
            `sandbox:/vercel/sandbox/devin-${chatId}`
          ) : (
            "no workspace yet"
          )}
        </span>
        <button
          type="button"
          className="p-1 rounded-sm hover:bg-secondary cursor-pointer text-muted-foreground"
          onClick={() => void mutate()}
          title="Refresh"
        >
          <RotateCwIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      {error ? (
        <LoadError message="Couldn't read the sandbox" onRetry={() => void mutate()} />
      ) : data === undefined ? (
        <div className="flex flex-1 min-h-0">
          <div className="w-1/2 border-r border-border/60 p-2 space-y-2" aria-busy>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className={cn("h-3", i % 2 ? "w-2/3" : "w-4/5")} />
            ))}
          </div>
          <Loading className="w-1/2" />
        </div>
      ) : !data.exists ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Send a prompt to create the workspace
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          <div className="w-1/2 min-w-0 overflow-y-auto border-r border-border/60 py-1">
            <Tree nodes={data.files} depth={0} selected={selected} onSelect={setSelected} />
          </div>
          <div className="w-1/2 min-w-0 overflow-auto">
            {selected === null ? (
              <div className="flex h-full items-center justify-center text-muted-foreground p-4 text-center">
                Select a file
              </div>
            ) : file.error ? (
              <div className="p-2.5 text-muted-foreground">(unreadable)</div>
            ) : file.data === undefined ? (
              <SkeletonLines lines={8} className="p-2.5" />
            ) : (
              <pre className="p-2.5 whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                {file.data.content}
                {file.data.truncated && "\n… (truncated)"}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
