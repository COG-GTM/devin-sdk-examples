import {
  clearedSessionCookie,
  configuredPassword,
  issueSessionToken,
  sessionCookie,
  verifyPassword,
} from "@/lib/auth";

/** Sign in: trade the shared password for the session cookie. */
export async function POST(request: Request) {
  if (configuredPassword() === null) {
    return Response.json({ error: "HARNESS_CHAT_PASSWORD is not set" }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!(await verifyPassword(password))) {
    return Response.json({ error: "wrong password" }, { status: 401 });
  }
  const { token, maxAge } = await issueSessionToken();
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": sessionCookie(token, maxAge) },
  });
}

/** Sign out: drop the cookie. */
export function DELETE() {
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie() } });
}
