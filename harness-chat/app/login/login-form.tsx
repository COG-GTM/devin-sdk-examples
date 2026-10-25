"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? "Wrong password" : `HTTP ${String(res.status)}`);
        return;
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex w-full max-w-xs flex-col gap-2">
      <label htmlFor="password" className="font-mono text-xs text-muted-foreground">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
        }}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button type="submit" disabled={busy || password === ""}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      {error !== null && (
        <p role="alert" className="font-mono text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
