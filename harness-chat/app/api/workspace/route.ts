import { Workspace } from "@/lib/workspace";

/** The Files panel: a chat's work dir as a tree, or one file's contents. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const chatId = url.searchParams.get("chatId");
  if (!chatId) return Response.json({ error: "missing chatId" }, { status: 400 });

  const workspace = await Workspace.open(chatId);
  if (workspace === null) return Response.json({ exists: false, files: [] });

  const file = url.searchParams.get("file");
  if (file !== null) {
    const result = await workspace.readFile(file);
    return result === null
      ? Response.json({ error: "unreadable" }, { status: 404 })
      : Response.json(result);
  }

  const files = await workspace.listFiles();
  return Response.json(files === null ? { exists: false, files: [] } : { exists: true, files });
}
