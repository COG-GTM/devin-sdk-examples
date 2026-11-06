import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE, matchesBoardToken } from "@/lib/auth";

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

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
    secure: request.headers.get("x-forwarded-proto")?.startsWith("https") ?? false,
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
  return response;
}
