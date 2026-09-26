'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';

import type { Asset, Id, ReleaseView } from '@/contracts';
import { Button } from '@/components/ui';
import { partPath } from '@/lib/parts/path';
import { ApiClientError, api } from '@/lib/api/client';
import type { ApiClient } from '@/lib/api/client';
import styles from './print.module.css';

type PrintApi = Pick<ApiClient, 'assets' | 'releases'>;

export type ReleasePrintLabelProps = {
  releaseId: string;
  jobId?: string;
  /** Injectable at the shared API boundary for focused verification. */
  client?: PrintApi;
};

function explainError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ENDPOINT_UNAVAILABLE') {
    return 'This service endpoint is not available in the current build. The part label could not be loaded.';
  }
  return error instanceof Error ? error.message : 'The request could not be completed. The part label could not be loaded.';
}

export function ReleasePrintLabel({ releaseId, jobId, client = api }: ReleasePrintLabelProps) {
  return <ReleasePrintSession key={`${jobId ?? ""}:${releaseId}`} releaseId={releaseId} jobId={jobId} client={client} />;
}

function ReleasePrintSession({ releaseId, jobId, client }: { releaseId: string; jobId?: string; client: PrintApi }) {
  const [view, setView] = useState<ReleaseView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);
  const [drawingError, setDrawingError] = useState<string | null>(null);

  const drawing: Asset | null = view?.sourceAssets.find((asset) => asset.kind === 'drawing_pdf' && asset.status === 'ready' && asset.sha256 !== null) ?? null;

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setDrawingUrl(null);
      setDrawingError(null);
      try {
        const next = await client.releases.get({ releaseId: releaseId as Id });
        if (next.release.id !== releaseId) throw new Error('The API returned a different release than the requested label context.');
        if (next.release.jobId !== next.job.id || (jobId && next.job.id !== jobId)) throw new Error('The release does not belong to the requested part.');
        if (!active) return;
        setView(next);
        const stableUrl = new URL(partPath(next.job.id), window.location.origin).toString();
        const qr = await QRCode.toDataURL(stableUrl, { errorCorrectionLevel: 'M', margin: 4, width: 256 });
        if (!active) return;
        setAccessUrl(stableUrl);
        setQrDataUrl(qr);
        const sourceDrawing = next.sourceAssets.find((asset) => asset.kind === 'drawing_pdf' && asset.status === 'ready' && asset.sha256 !== null);
        if (sourceDrawing) {
          try {
            const link = await client.assets.getLink({ assetId: sourceDrawing.id });
            if (active) setDrawingUrl(link.url);
          } catch (error) {
            if (active) setDrawingError(explainError(error));
          }
        } else if (active) {
          setDrawingError('The released source pack does not contain a ready drawing PDF.');
        }
      } catch (error) {
        if (active) setLoadError(explainError(error));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [client, jobId, releaseId]);

  return (
    <main className={styles.printPage}>
      <header className={styles.printControls}>
        <div><p className={styles.eyebrow}>Chappe · part knowledge base</p><h1>Print part QR label</h1></div>
        <div className={styles.controls}>
          <Button type="button" disabled={!view || !qrDataUrl} onClick={() => window.print()}>Print label</Button>
        </div>
      </header>
      <p className={styles.subtle}>One QR for this part. Each scan opens its current engineer-approved knowledge. Workspace sign-in is required.</p>
      {loading ? <p className={styles.status} role="status">Loading published release and authorized source access…</p> : null}
      {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      {drawingError ? <p className={styles.subtle} role="status">Source drawing access: {drawingError}</p> : null}

      {view ? (
        <section className={styles.label} aria-label={`Printable label for ${view.job.partNumber}`}>
          <div className={styles.labelTop}>
            <div className={styles.brand}><span className={styles.brandMark}>C</span><span>Chappe</span></div>
            <span className={styles.releaseNumber}>PART KNOWLEDGE</span>
          </div>
          <div className={styles.labelBody}>
            <div className={styles.partIdentity}>
              <p className={styles.eyebrow}>Part number</p>
              <h2>{view.job.partNumber}</h2>
              <p>{view.job.title}</p>
            </div>
            <div className={styles.qrArea}>
              {qrDataUrl ? <Image className={styles.qrCode} src={qrDataUrl} width={256} height={256} unoptimized alt={`QR code for part ${view.job.partNumber} knowledge base`} /> : <div className={styles.qrPending}>{loading ? 'Preparing part QR…' : 'QR code unavailable'}</div>}
              <span>Scan for current approved knowledge</span>
            </div>
          </div>
          <dl className={styles.labelDetails}>
            <div><dt>Part number</dt><dd>{view.job.partNumber}</dd></div>
            <div><dt>Guide at printing</dt><dd>#{view.release.revisionNumber}</dd></div>
            <div><dt>Published</dt><dd>{new Date(view.release.publishedAt).toLocaleDateString()}</dd></div>
          </dl>
          <div className={styles.sourceAccess}>
            <div>
              <p className={styles.eyebrow}>Source drawing access</p>
              {drawingUrl && drawing ? <a href={drawingUrl} target="_blank" rel="noreferrer">Open {drawing.filename}</a> : <span>{drawing?.filename ?? 'No drawing PDF in the released source pack'}</span>}
              <p>Source attached to guide #{view.release.revisionNumber}; scan for current knowledge.</p>
            </div>
            <span className={styles.accessStatus}>{accessUrl ? 'Workspace sign-in required' : 'Part link unavailable'}</span>
          </div>
          {accessUrl ? <details className={styles.urlDetails}><summary>Show stable part address</summary><code>{accessUrl}</code></details> : null}
          <footer className={styles.labelFooter}><span>Part {view.job.partNumber}</span><span>Stable part QR</span><span>Sign in after scanning</span></footer>
        </section>
      ) : null}
    </main>
  );
}
