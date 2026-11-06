import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE, matchesBoardToken } from "@/lib/auth";

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Relative, because `request.url` names the bind address (0.0.0.0) in the container. */
function redirect(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

/** The login form's target: trades a valid `BOARD_TOKEN` for an HttpOnly cookie. */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => undefined);
  const token = form?.get("token");
  if (typeof token !== "string" || !(await matchesBoardToken(token))) {
    return redirect("/login?error=1");
  }
  const response = redirect("/");
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // A proxy may not report the scheme, so only loopback may go without TLS.
    secure: !LOOPBACK_HOST.test(request.headers.get("host") ?? ""),
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
  return response;
}
