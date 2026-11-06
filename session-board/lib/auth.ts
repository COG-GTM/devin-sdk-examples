import type { NextRequest } from "next/server";

export const AUTH_COOKIE = "session_board_auth";

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/**
 * Constant-time check against `BOARD_TOKEN`. Without a token configured nothing
 * matches, so a deployment that forgot to set one stays closed. Web Crypto only:
 * this also runs in middleware, on the Edge runtime.
 */
export async function matchesBoardToken(candidate: string | undefined): Promise<boolean> {
  const token = process.env.BOARD_TOKEN;
  if (!token || !candidate) return false;
  const [actual, expected] = await Promise.all([sha256(candidate), sha256(token)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

/** The browser's login cookie, or `Authorization: Bearer` for scripts. */
export function isAuthenticated(request: NextRequest): Promise<boolean> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  return matchesBoardToken(bearer ?? request.cookies.get(AUTH_COOKIE)?.value);
}

export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}
