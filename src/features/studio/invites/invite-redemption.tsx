"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Panel, PanelBody } from "@/components/ui";
import { ApiClientError, api } from "@/lib/api/client";
import styles from "./workspace-invites.module.css";

export function InviteRedemption({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnQuery = `?returnTo=${encodeURIComponent(`/invite/${token}`)}`;

  async function redeem() {
    setPending(true);
    setError(null);
    try {
      const membership = await api.workspaces.redeemInvite({
        token,
        idempotencyKey: crypto.randomUUID(),
      });
      router.replace(`/studio?workspace=${encodeURIComponent(membership.workspaceId)}`);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "UNAUTHENTICATED") {
        router.push(`/login${returnQuery}`);
        return;
      }
      setError(caught instanceof Error ? caught.message : "This invitation could not be accepted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.redeemPage}>
      <Panel title="Join a Chappe workspace" eyebrow="Workspace invitation">
        <PanelBody>
          <p className={styles.copy}>Sign in with the verified email address this link was made for, then accept the invitation. This link is valid for one account and expires after seven days.</p>
          <div className={styles.redeemActions}>
            <Button type="button" disabled={pending || !/^[A-Za-z0-9_-]{43}$/.test(token)} onClick={() => void redeem()}>{pending ? "Checking invitation…" : "Accept invitation"}</Button>
            <Link href={`/login${returnQuery}`}>Sign in</Link>
            <Link href={`/signup${returnQuery}`}>Create account</Link>
          </div>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {!/^[A-Za-z0-9_-]{43}$/.test(token) ? <p className={styles.error} role="alert">This invitation link is invalid.</p> : null}
        </PanelBody>
      </Panel>
    </main>
  );
}
