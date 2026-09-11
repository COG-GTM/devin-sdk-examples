import { after } from "next/server";

import { forgetSession, getSession, loadMessages } from "@/lib/session-store";
import { Workspace } from "@/lib/workspace";

/** A chat's record plus the transcript the browser rendered for it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, messages] = await Promise.all([getSession(id), loadMessages(id)]);
  return Response.json({ session, messages });
}

/**
 * Delete a chat. Its records go right away so the list updates immediately;
 * stopping the sandbox (the VM is real, and takes a few seconds) finishes in
 * the background.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await Workspace.open(id);
  await forgetSession(id);
  if (workspace) after(() => workspace.stop());
  return new Response(null, { status: 204 });
}
