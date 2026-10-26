/**
 * Who may see the board. Whoever reaches it sees every session
 * `DEVIN_API_KEY` can see, so every request has to carry one shared secret,
 * `BOARD_TOKEN`: a browser signs in once with it at `/login` and keeps an
 * `HttpOnly` cookie; a script sends it as `Authorization: Bearer …`. Without
 * a token the server refuses every request rather than serving the board
 * to anyone who finds its hostname.
 *
 * Imported by the middleware (Edge runtime) and route handlers alike, so
 * Web Crypto only — no `node:crypto`.
 */

export const COOKIE = "board_session";
export const MIN_TOKEN_LENGTH = 16;
const COOKIE_MAX_AGE_S = 30 * 24 * 3600;
const encoder = new TextEncoder();

/** The configured token, or `undefined` when there is none worth trusting. */
export function boardToken(): string | undefined {
  const token = process.env.BOARD_TOKEN;
  return token !== undefined && token.length >= MIN_TOKEN_LENGTH ? token : undefined;
}

/** Whether `request` carries the token, as a bearer header or the signed-in cookie. */
export async function authorized(request: Request): Promise<boolean> {
  const token = boardToken();
  if (token === undefined) return false;
  const bearer = request.headers.get("authorization");
  if (bearer !== null && equal(bearer, `Bearer ${token}`)) return true;
  const cookie = readCookie(request.headers.get("cookie"), COOKIE);
  return cookie !== undefined && equal(cookie, await cookieValue(token));
}

/**
 * What the cookie holds: an HMAC under the token of a fixed label, so the
 * token itself never reaches the browser and rotating it signs everyone out.
 */
export async function cookieValue(token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode("session-board"));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether `request` arrived over TLS, directly or at a proxy that says so. */
export function overTls(request: Request): boolean {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
  );
}

/**
 * Whether the token may travel in the clear on this request: only to the
 * machine itself. Anywhere else, a plaintext login hands the token and the
 * cookie to whoever is on the network, so `/api/login` refuses it.
 */
export function plaintextAllowed(request: Request): boolean {
  if (overTls(request)) return true;
  const host = (request.headers.get("host") ?? new URL(request.url).host).replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** A `Set-Cookie` header value: signed in when `value` is given, signed out otherwise. */
export function sessionCookie(request: Request, value: string | undefined): string {
  const parts = [
    `${COOKIE}=${value ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${String(value === undefined ? 0 : COOKIE_MAX_AGE_S)}`,
  ];
  if (overTls(request)) parts.push("Secure");
  return parts.join("; ");
}

/** Constant-time string comparison; the length leaks, the contents do not. */
export function equal(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return undefined;
}

/** The answer when `BOARD_TOKEN` is unset: nothing, and a note saying why. */
export function unconfigured(): Response {
  return new Response(
    `BOARD_TOKEN is not set (${String(MIN_TOKEN_LENGTH)}+ characters). ` +
      "Whoever can reach the board sees every session DEVIN_API_KEY can see, " +
      "so it serves nothing until one is set.\n",
    { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
