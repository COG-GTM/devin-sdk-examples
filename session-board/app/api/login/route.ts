import {
  authorized,
  boardToken,
  cookieValue,
  equal,
  sessionCookie,
  unconfigured,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The login form posts the token here; a match sets the cookie and opens the board. */
export async function POST(request: Request): Promise<Response> {
  const token = boardToken();
  if (token === undefined) return unconfigured();
  const form = await request.formData().catch(() => undefined);
  const sent = form?.get("token");
  if (typeof sent !== "string" || !equal(sent, token)) {
    return new Response(null, { status: 303, headers: { Location: "/login?error=1" } });
  }
  return new Response(null, {
    status: 303,
    headers: { Location: "/", "Set-Cookie": sessionCookie(request, await cookieValue(token)) },
  });
}

/** Sign out: clear the cookie. Only for whoever is signed in. */
export async function DELETE(request: Request): Promise<Response> {
  if (!(await authorized(request))) return new Response(null, { status: 401 });
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": sessionCookie(request, undefined) },
  });
}
