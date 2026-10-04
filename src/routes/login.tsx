import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Check, Copy } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";

// Demo logins shown on the sign-in page so testers can copy them.
const DEMO_ACCOUNTS = [
  { role: "Expert", email: "mayukh2026+expert@gmail.com", password: "mayukh123" },
  { role: "Learner", email: "mayukh2026+learner@gmail.com", password: "mayukh123" },
];

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in | sidekik" },
      { name: "description", content: "Sign in to Sidekik with your email and password." },
      { property: "og:title", content: "Sign in | sidekik" },
      { property: "og:description", content: "Sign in to Sidekik with your email and password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { ready, session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && session) navigate({ to: "/", replace: true });
  }, [ready, session, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    // On success the auth listener sets the session and the effect above redirects.
    if (error) setError(error.message);
    setSigningIn(false);
  };

  const inputClass =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <AuthLayout>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your email and password.</p>
        </div>
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Email"
          className={inputClass}
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          className={inputClass}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={signingIn}
          className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {signingIn ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-sm text-muted-foreground">
          No account yet?{" "}
          <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      </form>
      <DemoAccounts />
    </AuthLayout>
  );
}

function DemoAccounts() {
  return (
    <section className="mt-6 border-t border-border pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Demo accounts
      </h2>
      <div className="mt-2 space-y-2">
        {DEMO_ACCOUNTS.map((a) => (
          <div key={a.role} className="rounded-md border border-border p-3">
            <p className="text-sm font-medium">{a.role}</p>
            <CopyRow label="Email" value={a.email} />
            <CopyRow label="Password" value={a.password} />
          </div>
        ))}
      </div>
    </section>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context): the value is still visible to select by hand.
    }
  };
  return (
    <div className="mt-1 flex items-center gap-2 text-sm">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label.toLowerCase()}`}
        title={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
