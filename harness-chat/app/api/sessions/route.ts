import { listSessions } from "@/lib/session-store";

/** Sessions exist once their first turn runs; there is no explicit create. */
export async function GET() {
  return Response.json({ sessions: await listSessions() });
}
