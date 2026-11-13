import { NextResponse, type NextRequest } from "next/server";

import { configuredPassword, isAuthenticated } from "@/lib/auth";

/**
 * Every API route and the console require the shared password (see
 * lib/auth.ts). API callers get 401; the browser is sent to /login. With no
 * password configured nothing is served at all: 503 for the API, and the
 * login page explains what to set.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/auth") return NextResponse.next();

  const api = pathname.startsWith("/api/");
  const login = pathname === "/login";

  if (configuredPassword() === null) {
    if (api) {
      return Response.json({ error: "HARNESS_CHAT_PASSWORD is not set" }, { status: 503 });
    }
    return login ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
  }

  if (await isAuthenticated(request)) {
    return login ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (api) return Response.json({ error: "unauthorized" }, { status: 401 });
  return login ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/", "/login", "/api/:path*"],
};
