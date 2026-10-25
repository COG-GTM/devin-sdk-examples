import { configuredPassword } from "@/lib/auth";
import { DevinDashed } from "@/components/devin-mark";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  const configured = configuredPassword() !== null;
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center">
        <DevinDashed className="mr-1.5" />
        <span className="text-sm uppercase font-mono font-bold tracking-tight">
          Devin Harness Console
        </span>
      </div>
      {configured ? (
        <LoginForm />
      ) : (
        <p
          role="alert"
          className="max-w-md text-center font-mono text-xs leading-relaxed text-muted-foreground"
        >
          This deployment has no <code>HARNESS_CHAT_PASSWORD</code>. Set one in the environment and
          redeploy; until then nothing is served.
        </p>
      )}
    </main>
  );
}
