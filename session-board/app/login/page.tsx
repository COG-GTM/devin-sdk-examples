import { DevinDashed } from "@/components/devin-mark";

export const dynamic = "force-dynamic";

/** Where the middleware sends a browser without the cookie: one field, the token. */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex h-screen items-center justify-center p-4">
      <form
        method="post"
        action="/api/login"
        className="flex w-full max-w-xs flex-col gap-3 rounded-md border border-border bg-background p-4 shadow-sm"
      >
        <div className="flex items-center gap-1.5">
          <DevinDashed />
          <span className="font-mono text-sm font-bold uppercase tracking-tight">
            Session Board
          </span>
        </div>
        <label className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">
          Board token
          <input
            type="password"
            name="token"
            required
            autoFocus
            autoComplete="current-password"
            className="rounded-md border border-border px-2 py-1 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
        {error !== undefined && (
          <p role="alert" className="font-mono text-xs text-destructive">
            That is not the board token.
          </p>
        )}
        <button
          type="submit"
          className="cursor-pointer rounded-md bg-primary px-3 py-1.5 font-mono text-xs text-primary-foreground hover:bg-primary/90"
        >
          Open the board
        </button>
      </form>
    </main>
  );
}
