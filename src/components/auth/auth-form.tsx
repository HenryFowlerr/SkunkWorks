"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { Button, TextInput } from "@/components/ui";

type AuthMode = "signIn" | "signUp";

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;

  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin) return null;
    const allowed = ["/studio", "/workshops", "/invites/redeem"];
    const inviteTokenRoute = /^\/invite\/[A-Za-z0-9_-]+$/.test(target.pathname);
    if (!inviteTokenRoute && !allowed.some((prefix) => target.pathname === prefix || target.pathname.startsWith(`${prefix}/`))) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const isSignUp = mode === "signUp";
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      if (isSignUp) {
        const result = await api.auth.signUp({
          email: email.trim(),
          password,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        });
        setPassword("");
        setNotice(
          result.verificationRequired
            ? "Account request received. Check your email for the verification link before signing in."
            : "Account created. You can now sign in.",
        );
        return;
      }

      await api.auth.signIn({ email: email.trim(), password });
      setPassword("");
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      router.replace(safeReturnPath(returnTo) ?? "/studio");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The account request could not be completed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-labelledby="auth-story-title">
        <Link className="brand-lockup" href="/" aria-label="SkunkWorks home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>SkunkWorks</span>
        </Link>
        <div className="auth-story__content">
          <p className="eyebrow">Prototype programmes</p>
          <h1 id="auth-story-title">Every bend keeps its place.</h1>
          <p>
            Keep the drawing, workshop setup, reviewed guide and floor questions connected to the same part revision.
          </p>
          <ol className="auth-flow" aria-label="Handoff stages">
            <li><span className="mono">01</span><span>Source packet</span></li>
            <li><span className="mono">02</span><span>Workshop review</span></li>
            <li><span className="mono">03</span><span>Floor guide</span></li>
          </ol>
        </div>
        <p className="auth-story__footer">A reviewed guide is a reference, not a machine-control instruction.</p>
      </section>

      <section className="auth-main" aria-labelledby="auth-title">
        <Link className="auth-home-link" href="/">← Back to overview</Link>
        <div className="auth-card">
          <p className="eyebrow">{isSignUp ? "Workspace access" : "Welcome back"}</p>
          <h2 id="auth-title">{isSignUp ? "Create your account" : "Sign in to your workspace"}</h2>
          <p className="auth-intro">
            {isSignUp
              ? "Create a verified account before joining or starting a prototype programme."
              : "Use your verified account to open the designer desk or workshop guide."}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {isSignUp ? (
              <TextInput
                id="display-name"
                name="displayName"
                label="Name"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
              />
            ) : null}
            <TextInput
              id="email"
              name="email"
              type="email"
              label="Email address"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <TextInput
              id="password"
              name="password"
              type="password"
              label="Password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={isSignUp ? 8 : 1}
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />

            {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}
            {notice ? <p className="auth-message auth-message--notice" role="status">{notice}</p> : null}

            <Button type="submit" disabled={pending} className="auth-submit">
              {pending ? "Working…" : isSignUp ? "Create account" : "Sign in"}
              <span aria-hidden="true">→</span>
            </Button>
          </form>

          <p className="auth-switch">
            {isSignUp ? "Already have an account?" : "New to this workspace?"}{" "}
            <Link href={isSignUp ? "/login" : "/signup"}>{isSignUp ? "Sign in" : "Create an account"}</Link>
          </p>
          <p className="auth-service-note">Account changes are confirmed only after the service responds.</p>
        </div>
      </section>
    </main>
  );
}
