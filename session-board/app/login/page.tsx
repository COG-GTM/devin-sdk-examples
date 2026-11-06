export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = !process.env.BOARD_TOKEN
    ? "BOARD_TOKEN is not set on the server, so the board is locked."
    : error !== undefined
      ? "That token is not valid."
      : undefined;

  return (
    <main className="flex h-screen items-center justify-center p-2">
      <form action="/api/login" method="post" className="flex w-72 flex-col gap-2">
        <h1 className="font-mono text-sm font-bold uppercase tracking-tight">Session Board</h1>
        <input
          type="password"
          name="token"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="Board token"
          aria-label="Board token"
          className="h-8 rounded-md border border-primary/18 bg-background px-2 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="submit"
          className="h-8 rounded-md bg-primary font-mono text-xs text-primary-foreground"
        >
          Sign in
        </button>
        {message !== undefined && (
          <p role="alert" className="font-mono text-xs text-destructive">
            {message}
          </p>
        )}
      </form>
    </main>
  );
}
