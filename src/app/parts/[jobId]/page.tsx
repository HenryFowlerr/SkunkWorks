import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OperatorFloor } from '@/features/operator/operator-floor';
import { NativePartSources } from '@/features/parts/native-part-sources';
import { partPath } from '@/lib/parts/path';
import { resolvePartEntry } from '@/server/parts/entry';
import styles from './part-entry.module.css';

export const metadata: Metadata = {
  title: 'Part knowledge base',
  robots: { index: false, follow: false },
};

// A saved QR must re-resolve current approved knowledge, never a cached release pointer.
export const dynamic = 'force-dynamic';

export default async function PartPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const entry = await resolvePartEntry(jobId);
  if (entry.state === 'sign-in') redirect(`/login?returnTo=${encodeURIComponent(partPath(jobId))}`);
  if (entry.state === 'ready') return <OperatorFloor key={entry.releaseId} releaseId={entry.releaseId} presentation="model" />;

  const title = entry.state === 'unpublished'
    ? 'Engineering has not approved a guide yet'
    : entry.state === 'service-unavailable' ? 'Part access is temporarily unavailable' : 'Part unavailable for this account';
  const explanation = entry.state === 'unpublished'
    ? 'Keep this QR code. It will open the approved part knowledge base once engineering publishes the guide.'
    : entry.state === 'service-unavailable'
      ? 'The sign-in or part service could not be reached. Open this QR link again when the service is available.'
      : 'Ask the engineer for access to the part’s workspace, or check that you signed in with the invited account.';

  return (
    <main className={styles.entry}>
      <Link href="/" className={styles.brand}>Chappe</Link>
      <h1>{entry.state === 'unpublished' ? entry.title : title}</h1>
      {entry.state === 'unpublished' ? <h2>{title}</h2> : null}
      <p role="status">{explanation}</p>
      {entry.state === 'unpublished' ? <NativePartSources assets={entry.assets} /> : null}
      <p>This part’s QR stays the same as approved knowledge is updated.</p>
      <Link href="/studio" className={styles.action}>Open your workspace</Link>
    </main>
  );
}
