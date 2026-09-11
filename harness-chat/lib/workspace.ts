import { Sandbox } from "@vercel/sandbox";

import { sandbox } from "./agent";
import { PREVIEW_PORTS } from "./ports";

/**
 * Read-only view of a chat's sandbox from outside a turn.
 *
 * The lifecycle itself belongs to `HarnessAgent`: it creates the sandbox on
 * the first turn (named after the chat id, which is the harness `sessionId`),
 * parks it between turns and resumes it on the next one. This class is what
 * the rest of the app uses to look *into* that sandbox — status, files,
 * whether something is serving on the preview port — and to stop it when
 * the chat is deleted. It never starts turns or touches the bridge.
 */
export interface SandboxInfo {
  exists: boolean;
  name?: string;
  status?: string;
  region?: string;
  createdAt?: number;
  /** Ports something is serving on right now, with their public URLs. */
  previews?: { port: number; url: string }[];
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileNode[];
}

const SKIP_DIRS = [
  "node_modules",
  ".git",
  ".venv",
  "__pycache__",
  ".pnpm-store",
  ".agents",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
];
const MAX_ENTRIES = 500;
const MAX_DEPTH = 6;
const MAX_CONTENT_BYTES = 128 * 1024;

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

type SandboxSession = Awaited<ReturnType<NonNullable<(typeof sandbox)["resumeSession"]>>>;

export class Workspace {
  private constructor(
    readonly chatId: string,
    private readonly session: SandboxSession,
  ) {}

  /** The chat's sandbox, or `null` if no turn has created one yet (or it expired). */
  static async open(chatId: string): Promise<Workspace | null> {
    if (sandbox.resumeSession === undefined) return null;
    try {
      return new Workspace(chatId, await sandbox.resumeSession({ sessionId: chatId }));
    } catch {
      return null;
    }
  }

  /** Where the harness puts this session's files: `<defaultWorkingDirectory>/devin-<sessionId>`. */
  get workDir(): string {
    return `${this.session.defaultWorkingDirectory}/devin-${this.chatId}`;
  }

  /** Platform view (status, region, age) plus which preview ports are serving. */
  async inspect(): Promise<SandboxInfo> {
    const [vm, listening] = await Promise.all([
      Sandbox.get({ name: this.session.id, resume: false }).catch(() => null),
      this.listeningPorts(),
    ]);
    const previews = await Promise.all(
      listening.map(async (port) => ({ port, url: await this.session.getPortUrl({ port }) })),
    );
    return {
      exists: true,
      name: this.session.id,
      status: vm?.status,
      region: vm?.region,
      createdAt: vm?.createdAt.getTime(),
      previews,
    };
  }

  /**
   * Preview ports with an HTTP server behind them (any response counts, even
   * an error page). Only ports this sandbox exposes are probed — the set is
   * fixed when the VM is created, so older sandboxes may have fewer.
   */
  private async listeningPorts(): Promise<number[]> {
    const exposed = PREVIEW_PORTS.filter((port) => this.session.ports.includes(port));
    if (exposed.length === 0) return [];
    // curl exits 0 on success and 22 on an HTTP error status; 7 is "connection refused".
    const probes = exposed
      .map(
        (port) =>
          `curl -s -o /dev/null --max-time 2 http://localhost:${String(port)}/; ` +
          `case $? in 0|22) echo ${String(port)};; esac`,
      )
      .join("; ");
    const { stdout } = await this.run(probes).catch(() => ({ stdout: "" }));
    return stdout
      .split("\n")
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  /** The work dir as a tree, or `null` if the first turn has not created it yet. */
  async listFiles(): Promise<FileNode[] | null> {
    const prune = SKIP_DIRS.map((d) => `-name ${shellQuote(d)}`).join(" -o ");
    const { exitCode, stdout } = await this.run(
      `cd ${shellQuote(this.workDir)} 2>/dev/null || exit 3; ` +
        `find . -mindepth 1 -maxdepth ${String(MAX_DEPTH)} \\( ${prune} \\) -prune -o ` +
        `\\( -type d -printf 'd\\t0\\t%p\\n' , -type f -printf 'f\\t%s\\t%p\\n' \\) 2>/dev/null | head -n ${String(MAX_ENTRIES + 1)}`,
    );
    return exitCode === 3 ? null : buildTree(stdout);
  }

  /** A file under the work dir; `null` if unreadable. Paths may not escape it. */
  async readFile(
    relativePath: string,
  ): Promise<{ content: string; truncated: boolean; size: number } | null> {
    if (relativePath.startsWith("/") || relativePath.split("/").includes("..")) return null;
    const content = await this.session.readTextFile({
      path: `${this.workDir}/${relativePath}`,
    });
    if (content === null) return null;
    return {
      content: content.slice(0, MAX_CONTENT_BYTES),
      truncated: content.length > MAX_CONTENT_BYTES,
      size: content.length,
    };
  }

  /** Stop the VM. Persistent sandboxes keep their disk; the harness resumes it on the next turn. */
  async stop(): Promise<void> {
    await this.session.stop();
  }

  private run(command: string) {
    return Promise.resolve(this.session.run({ command }));
  }
}

/** `find` output — one `<type>\t<size>\t<relative path>` line per entry — into a tree. */
function buildTree(listing: string): FileNode[] {
  const root: FileNode[] = [];
  const dirs = new Map<string, FileNode[]>([["", root]]);
  const lines = listing
    .split("\n")
    .filter((l) => l !== "")
    .sort((a, b) => (a.split("\t")[2] ?? "").localeCompare(b.split("\t")[2] ?? ""))
    .slice(0, MAX_ENTRIES);
  for (const line of lines) {
    const [type, size, rel] = line.split("\t") as [string, string, string];
    const path = rel.replace(/^\.\//, "");
    if (path === "." || path === "") continue;
    const slash = path.lastIndexOf("/");
    const parent = dirs.get(slash === -1 ? "" : path.slice(0, slash));
    if (parent === undefined) continue;
    const node: FileNode = {
      name: path.slice(slash + 1),
      path,
      type: type === "d" ? "dir" : "file",
    };
    if (node.type === "dir") {
      node.children = [];
      dirs.set(path, node.children);
    } else {
      node.size = Number(size);
    }
    parent.push(node);
  }
  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
    );
    for (const n of nodes) if (n.children) sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}
