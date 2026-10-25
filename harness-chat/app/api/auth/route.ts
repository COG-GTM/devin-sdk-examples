import {
  clearedSessionCookie,
  configuredPassword,
  issueSessionToken,
  sessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { allowLoginAttempt, clearLoginAttempts } from "@/lib/session-store";

/**
 * The client address as the platform's proxy reports it. Vercel sets
 * `x-real-ip` itself and ignores a caller's copy; `x-forwarded-for` is the
 * fallback for other hosts. Spoofing only buys an attacker a fresh per-address
 * window; the deployment-wide window in `allowLoginAttempt` still applies.
 */
function clientAddress(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Sign in: trade the shared password for the session cookie. */
export async function POST(request: Request) {
  if (configuredPassword() === null) {
    return Response.json({ error: "HARNESS_CHAT_PASSWORD is not set" }, { status: 503 });
  }
  const client = clientAddress(request);
  if (!(await allowLoginAttempt(client))) {
    return Response.json({ error: "too many attempts, try again later" }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!(await verifyPassword(password))) {
    return Response.json({ error: "wrong password" }, { status: 401 });
  }
  await clearLoginAttempts(client);
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
