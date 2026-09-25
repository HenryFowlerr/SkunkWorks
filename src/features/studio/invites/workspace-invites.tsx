"use client";

import { useState, type FormEvent } from "react";
import { Button, Panel, PanelBody } from "@/components/ui";
import type { Role, WorkspaceInvite } from "@/contracts";
import { api } from "@/lib/api/client";
import styles from "./workspace-invites.module.css";

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `invite-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function WorkspaceInvites({ workspaceId, role }: { workspaceId: string; role: Role }) {
  const [inviteRole, setInviteRole] = useState<"designer" | "fabricator">("fabricator");
  const [invite, setInvite] = useState<WorkspaceInvite | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canInvite = role === "admin";

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setCopied(false);
    setError(null);
    try {
      const result = await api.workspaces.invite({
        workspaceId,
        role: inviteRole,
        idempotencyKey: newIdempotencyKey(),
      });
      setInvite(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation link could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function copyInvite() {
    if (!invite) return;
    setError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable. Select and copy the link below.");
      await navigator.clipboard.writeText(invite.inviteUrl);
      setCopied(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The link could not be copied.");
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><p className="eyebrow">Workspace access</p><h1>Invite a collaborator</h1></div>
      </header>
      <Panel title="Create an invitation link" eyebrow="Role-bound and expiring">
        <PanelBody>
          <p className={styles.copy}>Create a link for a designer or fabricator. The service sets its expiry and records the selected role. Copy it yourself; SkunkWorks does not send email.</p>
          {!canInvite ? <p className={styles.notice}>Your workspace role cannot issue invitations. Ask a workspace admin to create one.</p> : (
            <form className={styles.form} onSubmit={createInvite}>
              <label className={styles.label} htmlFor="invite-role">Workspace role</label>
              <select id="invite-role" className={styles.select} value={inviteRole} onChange={(event) => setInviteRole(event.currentTarget.value as "designer" | "fabricator")}>
                <option value="fabricator">Fabricator</option>
                <option value="designer">Designer</option>
              </select>
              <Button type="submit" disabled={pending}>{pending ? "Creating link…" : "Create invitation link"}</Button>
            </form>
          )}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {invite ? (
            <section className={styles.result} aria-labelledby="invite-result-title">
              <div className={styles.resultHeader}>
                <div><p className="eyebrow">Issued by the service</p><h2 id="invite-result-title">{invite.role} invitation</h2></div>
                <Button type="button" tone="secondary" onClick={() => void copyInvite()}>{copied ? "Copied" : "Copy link"}</Button>
              </div>
              <a className={styles.url} href={invite.inviteUrl}>{invite.inviteUrl}</a>
              <p className={styles.expiry}>Expires {new Date(invite.expiresAt).toLocaleString()}</p>
            </section>
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  );
}
