/**
 * Who is calling the Worker.
 *
 * Every request is authenticated before it reaches an Agent, and the caller
 * only ever reaches the `Workspace` named after their own user id (see the
 * `fetch` handler in `server.ts`). Without this, anyone who can reach the
 * Worker could use `DEVIN_API_KEY` through it.
 *
 * - Deployed: a [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)
 *   JWT, verified against the team's signing keys (`TEAM_DOMAIN`, `POLICY_AUD`).
 * - Local development: `DEV_USER`, honored only for requests to a loopback host.
 * - Neither configured: every request is rejected.
 */
import { createRemoteJWKSet, jwksCache, jwtVerify, type JWKSCacheInput } from "jose";

export interface User {
  /** Stable id of the user. Also the name of their `Workspace`. */
  id: string;
  email: string | null;
}

export interface AuthEnv {
  /** `https://<team>.cloudflareaccess.com` */
  TEAM_DOMAIN?: string;
  /** The Access application's audience (AUD) tag. */
  POLICY_AUD?: string;
  /** Local development only: the user every loopback request acts as. */
  DEV_USER?: string;
}

/** A user id becomes a Durable Object name and a URL segment, so keep it to URL-safe characters. */
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Signing keys per team domain. Plain data, so it is safe to reuse across requests. */
const keyCaches = new Map<string, JWKSCacheInput>();

/** The authenticated user, or the response that rejects the request. */
export async function authenticate(request: Request, env: AuthEnv): Promise<User | Response> {
  const url = new URL(request.url);

  // Browsers attach credentials to cross-site requests and WebSocket handshakes,
  // so a page on another origin must not be able to act as the signed-in user.
  const origin = request.headers.get("Origin");
  if (origin !== null && !sameOrigin(origin, url)) return reject(403, "Cross-origin request.");

  const teamDomain = (env.TEAM_DOMAIN ?? "").trim().replace(/\/+$/, "");
  const audience = (env.POLICY_AUD ?? "").trim();
  if (teamDomain !== "" && audience !== "") {
    const token = accessToken(request);
    if (token === null) return reject(401, "Sign in to continue.");
    let keys = keyCaches.get(teamDomain);
    if (keys === undefined) keyCaches.set(teamDomain, (keys = {}));
    try {
      const { payload } = await jwtVerify(
        token,
        createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`), { [jwksCache]: keys }),
        { issuer: teamDomain, audience, algorithms: ["RS256"] },
      );
      // Service tokens have no `sub`; this app is for signed-in users.
      if (typeof payload.sub !== "string" || !USER_ID.test(payload.sub)) {
        return reject(403, "This identity cannot use the app.");
      }
      return { id: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
    } catch {
      return reject(401, "Invalid or expired sign-in.");
    }
  }

  const devUser = (env.DEV_USER ?? "").trim();
  if (USER_ID.test(devUser) && LOOPBACK_HOSTS.has(url.hostname)) {
    return { id: devUser, email: null };
  }

  return reject(
    401,
    "Authentication is not configured. Set TEAM_DOMAIN and POLICY_AUD (Cloudflare Access), or DEV_USER for local development.",
  );
}

/** Cloudflare Access sends the JWT in a header on every proxied request, and to browsers as a cookie. */
function accessToken(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header !== null && header !== "") return header;
  for (const pair of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator !== -1 && pair.slice(0, separator).trim() === "CF_Authorization") {
      return pair.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function sameOrigin(origin: string, url: URL): boolean {
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

function reject(status: 401 | 403, message: string): Response {
  return new Response(message, { status });
}
