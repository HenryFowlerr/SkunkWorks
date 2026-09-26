'use client';

import { useRef, useState } from 'react';
import type { Flag } from '@/contracts';
import type { FlagReplySuggestion } from '@/contracts/ai';
import { Button, StatusBadge } from '@/components/ui';
import type { ApiClient } from '@/lib/api/client';
import styles from '../review.module.css';

export function FlagReplySuggestionControl({ flag, client, onUse }: {
  flag: Flag;
  client: Pick<ApiClient, 'flags'>;
  onUse: (text: string) => void;
}) {
  const [suggestion, setSuggestion] = useState<FlagReplySuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  async function suggest() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null); setSuggestion(null);
    try {
      setSuggestion(await client.flags.suggestReply({ jobId: flag.context.jobId, flagId: flag.id, expectedVersion: flag.version }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A draft reply could not be prepared.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const current = suggestion?.flagVersion === flag.version ? suggestion : null;
  return <div className={styles.responseBox}>
    <Button type="button" tone="secondary" small disabled={busy || flag.status !== 'open'} onClick={() => void suggest()}>
      {busy ? 'Preparing draft reply…' : 'Suggest a reply with AI'}
    </Button>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {current ? <div aria-live="polite">
      <StatusBadge label="AI draft · engineer review required" tone="review" />
      <p>{current.answer.text}</p>
      <p className={styles.subtle}>Evidence: {current.answer.evidenceState.replaceAll('_', ' ')}. Nothing has been sent or added to the part’s knowledge.</p>
      <ul className={styles.evidenceList}>
        {current.answer.evidence.map((source, index) => <li key={index}>
          {source.kind === 'document' ? <>Drawing page {source.page}: “{source.excerpt}”</>
            : source.kind === 'workshop_note' ? <>Confirmed facility note {source.noteId}</>
            : source.kind === 'human_clarification' ? <>Engineer-approved answer {source.recordId}</>
            : <>Authored mapping {source.bendId}</>}
        </li>)}
      </ul>
      <Button type="button" tone="secondary" small onClick={() => onUse(current.answer.text)}>Use in reply editor</Button>
    </div> : null}
  </div>;
}
