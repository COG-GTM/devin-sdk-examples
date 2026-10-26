import { NextResponse, type NextRequest } from "next/server";

import { authorized, boardToken, unconfigured } from "@/lib/auth";

/** Everything but Next's own assets: the page, the stream, any future route. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
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
