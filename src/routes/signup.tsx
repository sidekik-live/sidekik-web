import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AuthLayout } from "@/components/AuthLayout";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create account | sidekik" },
      { name: "description", content: "Create a Sidekik account with your email and password." },
      { property: "og:title", content: "Create account | sidekik" },
      {
        property: "og:description",
        content: "Create a Sidekik account with your email and password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

const MIN_PASSWORD = 8;

// Creates the account only. An admin gives it a role on the People page; until then the app shows
// "You're not in an organisation yet".
function SignupPage() {
  const { ready, session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "confirm-email">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && session) navigate({ to: "/", replace: true });
  }, [ready, session, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The passwords don't match.");
    setState("saving");
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setState("idle");
    } else if (data.session) {
      // Email confirmation is off: signed in already; the effect above redirects.
      setState("idle");
    } else setState("confirm-email");
  };

  const inputClass =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <AuthLayout>
      {state === "confirm-email" ? (
        <>
          <h1 className="text-lg font-semibold">Confirm your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
            Open it, then sign in.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Create account</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              An admin gives you a role once you're in.
            </p>
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`Password (at least ${MIN_PASSWORD} characters)`}
            aria-label="Password"
            className={inputClass}
          />
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            aria-label="Confirm password"
            className={inputClass}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={state === "saving"}
            className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {state === "saving" ? "Creating account…" : "Create account"}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
