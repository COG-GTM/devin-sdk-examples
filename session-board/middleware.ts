import { NextResponse, type NextRequest } from "next/server";

import { authorized, boardToken, unconfigured } from "@/lib/auth";

/**
 * Everything but Next's hashed static assets: the page, the stream, any
 * future route, and `/_next/image` too — the board has no images, so the
 * optimizer has no business answering strangers.
 */
export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};

/**
 * The one door to the board. A request gets through with the `BOARD_TOKEN`
 * as a bearer header or the cookie `/api/login` sets; a browser without one
 * is sent to `/login`, anything else gets a 401. The stream route checks
 * again on its own, so a matcher mistake here cannot open it.
 */
export async function middleware(request: NextRequest): Promise<NextResponse | Response> {
  const { pathname } = request.nextUrl;
  if (boardToken() === undefined) return unconfigured();
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (await authorized(request)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return new NextResponse(null, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}
