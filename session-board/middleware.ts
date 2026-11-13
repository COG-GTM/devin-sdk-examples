import { NextResponse, type NextRequest } from "next/server";

import { isAuthenticated, unauthorized } from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/login"]);

/** Everything but the login form and Next's build assets requires `BOARD_TOKEN`. */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || (await isAuthenticated(request))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return unauthorized();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: "/((?!_next/).*)" };
