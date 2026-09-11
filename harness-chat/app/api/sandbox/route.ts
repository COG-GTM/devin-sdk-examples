import { Workspace, type SandboxInfo } from "@/lib/workspace";

/** The Sandbox and Preview panels: the chat's sandbox as the platform sees it. */
export async function GET(request: Request) {
  const chatId = new URL(request.url).searchParams.get("chatId");
  if (!chatId) return Response.json({ error: "missing chatId" }, { status: 400 });
  const workspace = await Workspace.open(chatId);
  const info: SandboxInfo = workspace === null ? { exists: false } : await workspace.inspect();
  return Response.json(info);
}
