"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiClientError, api } from "@/lib/api/client";
import type { AuthSessionView, Role, WorkspaceMembership } from "@/contracts";
import { Button, Panel, PanelBody, TextInput } from "@/components/ui";
import styles from "./studio-shell.module.css";

type StudioContextValue = {
  session: AuthSessionView;
  workspaceId: string;
  membership: WorkspaceMembership;
  role: Role;
  refresh: () => Promise<void>;
  setWorkspaceId: (workspaceId: string) => void;
};

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudioSession() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudioSession must be used inside StudioSessionProvider.");
  return value;
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `skunkworks-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function returnPath(pathname: string, search: string) {
  const path = `${pathname}${search ? `?${search}` : ""}`;
  return encodeURIComponent(path.startsWith("/studio") ? path : "/studio");
}

function WorkspaceSetup({ onCreated }: { onCreated: (membership: WorkspaceMembership) => void }) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api.workspaces.create({ name: name.trim(), idempotencyKey: newIdempotencyKey() });
      onCreated(result.membership);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The workspace could not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.setupPage}>
      <Panel>
        <PanelBody>
          <p className="eyebrow">Start a prototype programme</p>
          <h1 className={styles.setupTitle}>Create your workspace</h1>
          <p className={styles.muted}>A workspace keeps designers, workshop profiles, source files and releases within one access boundary.</p>
          <form className={styles.setupForm} onSubmit={submit}>
            <TextInput id="workspace-name" label="Workspace name" value={name} required onChange={(event) => setName(event.currentTarget.value)} />
            {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}
            <Button type="submit" disabled={pending || !name.trim()}>{pending ? "Creating…" : "Create workspace"}</Button>
          </form>
        </PanelBody>
      </Panel>
    </main>
  );
}

function SessionProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className={styles.setupPage}>
      <Panel>
        <PanelBody>
          <p className="eyebrow">Workspace access</p>
          <h1 className={styles.setupTitle}>The designer desk is unavailable</h1>
          <p className={styles.muted}>{message}</p>
          <Button type="button" onClick={onRetry}>Try again</Button>
        </PanelBody>
      </Panel>
    </main>
  );
}

function StudioFrame({ children, context }: { children: ReactNode; context: StudioContextValue }) {
  const router = useRouter();
  const workspaceOptions = context.session.memberships;
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const workspaceLabel = context.role === "fabricator" ? "Workshop workspace" : "Designer workspace";
  const workspaceQuery = `?workspace=${encodeURIComponent(context.workspaceId)}`;

  async function signOut() {
    setSignOutError(null);
    try {
      await api.auth.signOut();
      router.replace("/login");
    } catch (caught) {
      setSignOutError(caught instanceof Error ? caught.message : "Sign out could not be confirmed.");
    }
  }

  return (
    <div className={styles.frame}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href={`/studio${workspaceQuery}`} aria-label={`Chappe ${workspaceLabel.toLowerCase()}`}>
          <span className={styles.brandMark} aria-hidden="true">C</span><span>Chappe</span>
        </Link>
        <p className={styles.navLabel}>{workspaceLabel}</p>
        <nav className={styles.nav} aria-label={workspaceLabel}>
          <Link href={`/studio${workspaceQuery}`}>Jobs <span aria-hidden="true">↗</span></Link>
          <Link href={`/studio/workshops${workspaceQuery}`}>{context.role === "fabricator" ? "Equipment and setup" : "Workshop setup"} <span aria-hidden="true">↗</span></Link>
          {context.role === "admin" ? <Link href={`/studio/invites${workspaceQuery}`}>Invitations <span aria-hidden="true">↗</span></Link> : null}
        </nav>
        <div className={styles.sidebarFooter}>
          <label className={styles.workspaceLabel} htmlFor="workspace-switcher">Workspace</label>
          <select
            id="workspace-switcher"
            className={styles.workspaceSelect}
            value={context.workspaceId}
            onChange={(event) => {
              const next = event.currentTarget.value;
              const url = new URL(window.location.href);
              url.searchParams.set("workspace", next);
              context.setWorkspaceId(next);
              router.push(`${url.pathname}?${url.searchParams.toString()}`);
            }}
            aria-label="Select workspace"
          >
            {workspaceOptions.map((membership) => (
              <option key={membership.id} value={membership.workspaceId}>
                Workspace {membership.workspaceId.slice(0, 8)} · {membership.role}
              </option>
            ))}
          </select>
          <p className={styles.actor}>{context.session.actor.displayName}<span>{context.role}</span></p>
          {signOutError ? <p className={styles.inlineError} role="alert">{signOutError}</p> : null}
          <button type="button" className={styles.signOut} onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

export function StudioSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const requestedWorkspaceId = searchParams.get("workspace");
  const [session, setSession] = useState<AuthSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const applySession = useCallback((nextSession: AuthSessionView) => {
    setSession(nextSession);
    setSelectedWorkspaceId((current) =>
      current && nextSession.memberships.some((membership) => membership.workspaceId === current)
        ? current
        : requestedWorkspaceId && nextSession.memberships.some((membership) => membership.workspaceId === requestedWorkspaceId)
          ? requestedWorkspaceId
          : nextSession.memberships[0]?.workspaceId ?? null,
    );
  }, [requestedWorkspaceId]);

  const handleSessionError = useCallback((caught: unknown) => {
    if (caught instanceof ApiClientError && caught.code === "UNAUTHENTICATED") {
      router.replace(`/login?returnTo=${returnPath(pathname, search)}`);
      return;
    }
    setError(caught instanceof Error ? caught.message : "Your workspace session could not be loaded.");
    setSession(null);
  }, [pathname, router, search]);

  const loadSession = useCallback(async () => {
    try {
      applySession(await api.auth.me());
    } catch (caught) {
      handleSessionError(caught);
    } finally {
      setLoading(false);
    }
  }, [applySession, handleSessionError]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await loadSession();
  }, [loadSession]);

  useEffect(() => {
    let active = true;
    void api.auth.me()
      .then((nextSession) => { if (active) applySession(nextSession); })
      .catch((caught: unknown) => { if (active) handleSessionError(caught); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applySession, handleSessionError]);

  const selectedMembership = useMemo(
    () => session?.memberships.find((membership) => membership.workspaceId === selectedWorkspaceId) ?? null,
    [session, selectedWorkspaceId],
  );

  if (loading) {
    return <main className={styles.setupPage} aria-live="polite"><p className="eyebrow">Workspace access</p><p>Checking your signed-in session…</p></main>;
  }
  if (error) return <SessionProblem message={error} onRetry={() => void refresh()} />;
  if (!session) return <SessionProblem message="Your signed-in session could not be confirmed." onRetry={() => void refresh()} />;
  if (session.memberships.length === 0) {
    return <WorkspaceSetup onCreated={(membership) => {
      setSession((current) => current ? { ...current, memberships: [...current.memberships, membership] } : current);
      setSelectedWorkspaceId(membership.workspaceId);
    }} />;
  }
  if (!selectedMembership) return <SessionProblem message="This account has no accessible workspace membership." onRetry={() => void refresh()} />;

  const context: StudioContextValue = {
    session,
    workspaceId: selectedMembership.workspaceId,
    membership: selectedMembership,
    role: selectedMembership.role,
    refresh,
    setWorkspaceId: setSelectedWorkspaceId,
  };

  return <StudioContext.Provider value={context}><StudioFrame context={context}>{children}</StudioFrame></StudioContext.Provider>;
}
