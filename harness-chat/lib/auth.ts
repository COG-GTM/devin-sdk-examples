/**
 * Access control for the whole app: one shared password, set as
 * `HARNESS_CHAT_PASSWORD`. Everything under /api and the console itself is
 * refused until the browser signs in (POST /api/auth) and holds the session
 * cookie, or the request carries `Authorization: Bearer <password>`.
 *
 * Fails closed: with no password configured, nothing is served. Web Crypto
 * only, so the same code runs in the edge middleware and in route handlers.
 */
export const AUTH_COOKIE = "harness-chat-auth";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function configuredPassword(): string | null {
  const password = process.env.HARNESS_CHAT_PASSWORD?.trim();
  return password ? password : null;
}

const encoder = new TextEncoder();

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
}

async function hmac(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(input)));
  return Array.from(signature, (b) => b.toString(16).padStart(2, "0")).join("");
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time comparison over digests, so neither length nor content leaks through timing. */
async function secretsMatch(candidate: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
  return equalBytes(a, b);
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const password = configuredPassword();
  return password !== null && (await secretsMatch(candidate, password));
}

/** A signed, expiring session token: `<expiresAt>.<hmac(password, expiresAt)>`. */
export async function issueSessionToken(): Promise<{ token: string; maxAge: number }> {
  const password = configuredPassword();
  if (password === null) throw new Error("HARNESS_CHAT_PASSWORD is not set");
  const expiresAt = String(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
  return { token: `${expiresAt}.${await hmac(password, expiresAt)}`, maxAge: SESSION_TTL_SECONDS };
}

async function verifySessionToken(token: string): Promise<boolean> {
  const password = configuredPassword();
  if (password === null) return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const expiresAt = token.slice(0, dot);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  return secretsMatch(token.slice(dot + 1), await hmac(password, expiresAt));
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** True when the request holds a valid session cookie or the password as a bearer token. */
export async function isAuthenticated(request: Request): Promise<boolean> {
  if (configuredPassword() === null) return false;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer !== undefined) return verifyPassword(bearer);
  const token = cookieValue(request, AUTH_COOKIE);
  return token !== null && (await verifySessionToken(token));
}

export function sessionCookie(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}${secure}`;
}

export function clearedSessionCookie(): string {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
