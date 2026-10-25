import { NextResponse, type NextRequest } from "next/server";

/**
 * Access control for the whole app. This is a single-user demo with no user
 * accounts, so one shared secret (`HARNESS_CHAT_PASSWORD`) gates every page
 * and every `/api/*` route: without it anyone who finds the URL could list,
 * read and delete chats, and run Devin turns on the deployer's API key.
 *
 * The browser gets a standard HTTP Basic Auth prompt (any username, the
 * secret as the password) and then sends the credentials with every fetch
 * on its own. Scripts can send `Authorization: Bearer <secret>` instead.
 *
 * Fails closed: with the variable unset nothing is served.
 */
export function middleware(request: NextRequest) {
  const secret = process.env.HARNESS_CHAT_PASSWORD;
  if (!secret) {
    return new NextResponse(
      "HARNESS_CHAT_PASSWORD is not set. Set it in the deployment's environment to enable access.",
      { status: 503 },
    );
  }
  const presented = presentedSecret(request.headers.get("authorization"));
  if (presented !== null && secretsMatch(presented, secret)) {
    return NextResponse.next();
  }
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Devin harness chat", charset="UTF-8"' },
  });
}

/** The secret a request presents, via Basic (the password) or Bearer, or null. */
function presentedSecret(header: string | null): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ", 2);
  if (!value) return null;
  if (scheme.toLowerCase() === "bearer") return value;
  if (scheme.toLowerCase() === "basic") {
    try {
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
      const colon = decoded.indexOf(":");
      return colon === -1 ? null : decoded.slice(colon + 1);
    } catch {
      return null;
    }
  }
  return null;
}

/** Constant-time comparison, so response timing does not leak the secret. */
function secretsMatch(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export const config = {
  // Everything except Next's own static assets, which contain no chat data.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
