'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';

import type { Asset, Id, ReleaseView } from '@/contracts';
import { Button } from '@/components/ui';
import { ApiClientError, api } from '@/lib/api/client';
import type { ApiClient } from '@/lib/api/client';
import styles from './print.module.css';

type PrintApi = Pick<ApiClient, 'assets' | 'releases'>;

export type ReleasePrintLabelProps = {
  releaseId: string;
  /** Injectable at the shared API boundary for focused verification. */
  client?: PrintApi;
};

function explainError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ENDPOINT_UNAVAILABLE') {
    return 'This service endpoint is not available in the current build. No print link was issued.';
  }
  return error instanceof Error ? error.message : 'The request could not be completed. No print link was issued.';
}

function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `skunkworks-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ReleasePrintLabel({ releaseId, client = api }: ReleasePrintLabelProps) {
  return <ReleasePrintSession key={releaseId} releaseId={releaseId} client={client} />;
}

function ReleasePrintSession({ releaseId, client }: { releaseId: string; client: PrintApi }) {
  const [view, setView] = useState<ReleaseView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);
  const [drawingError, setDrawingError] = useState<string | null>(null);

  const drawing: Asset | null = view?.sourceAssets.find((asset) => asset.kind === 'drawing_pdf' && asset.status === 'ready' && asset.sha256 !== null) ?? null;

  const issueShareLink = async (forReleaseId: string) => {
    setShareBusy(true);
    setShareError(null);
    setAccessUrl(null);
    setQrDataUrl(null);
    try {
      const issued = await client.releases.createShareLink({ releaseId: forReleaseId as Id, idempotencyKey: idempotencyKey() });
      const qr = await QRCode.toDataURL(issued.accessUrl, { errorCorrectionLevel: 'M', margin: 1, width: 256 });
      setAccessUrl(issued.accessUrl);
      setQrDataUrl(qr);
    } catch (error) {
      setShareError(explainError(error));
    } finally {
      setShareBusy(false);
    }
  };

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
        if (!active) return;
        setView(next);
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
        if (active) void issueShareLink(next.release.id);
      } catch (error) {
        if (active) setLoadError(explainError(error));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
    // issueShareLink intentionally runs once for each verified release load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, releaseId]);

  return (
    <main className={styles.printPage}>
      <header className={styles.printControls}>
        <div><p className={styles.eyebrow}>SkunkWorks · release label</p><h1>Print release QR label</h1></div>
        <div className={styles.controls}>
          {view ? <Button type="button" tone="secondary" small disabled={shareBusy} onClick={() => void issueShareLink(view.release.id)}>{shareBusy ? 'Issuing link…' : 'Issue a new QR link'}</Button> : null}
          <Button type="button" disabled={!view || !qrDataUrl || shareBusy} onClick={() => window.print()}>Print label</Button>
        </div>
      </header>
      {loading ? <p className={styles.status} role="status">Loading published release and authorized source access…</p> : null}
      {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      {shareError ? <p className={styles.error} role="alert">{shareError}</p> : null}
      {drawingError ? <p className={styles.subtle} role="status">Source drawing access: {drawingError}</p> : null}

      {view ? (
        <section className={styles.label} aria-label={`Printable label for ${view.job.partNumber}`}>
          <div className={styles.labelTop}>
            <div className={styles.brand}><span className={styles.brandMark}>S</span><span>SkunkWorks</span></div>
            <span className={styles.releaseNumber}>RELEASE {String(view.release.revisionNumber).padStart(2, '0')}</span>
          </div>
          <div className={styles.labelBody}>
            <div className={styles.partIdentity}>
              <p className={styles.eyebrow}>Part number</p>
              <h2>{view.job.partNumber}</h2>
              <p>{view.job.title}</p>
            </div>
            <div className={styles.qrArea}>
              {qrDataUrl ? <Image className={styles.qrCode} src={qrDataUrl} width={256} height={256} unoptimized alt={`QR code for authorized factory access to release ${view.release.revisionNumber}`} /> : <div className={styles.qrPending}>{shareBusy ? 'Issuing authorized access link…' : 'QR code unavailable'}</div>}
              <span>Scan for the released factory guide</span>
            </div>
          </div>
          <dl className={styles.labelDetails}>
            <div><dt>Drawing revision</dt><dd>{drawing?.drawingRevision ? drawing.drawingRevision : 'Not provided'}</dd></div>
            <div><dt>App release</dt><dd>#{view.release.revisionNumber}</dd></div>
            <div><dt>Published</dt><dd>{new Date(view.release.publishedAt).toLocaleDateString()}</dd></div>
          </dl>
          <div className={styles.sourceAccess}>
            <div>
              <p className={styles.eyebrow}>Source drawing access</p>
              {drawingUrl && drawing ? <a href={drawingUrl} target="_blank" rel="noreferrer">Open {drawing.filename}</a> : <span>{drawing?.filename ?? 'No drawing PDF in the released source pack'}</span>}
              <p>{drawing?.drawingRevision ? `Revision ${drawing.drawingRevision}` : 'Drawing revision not provided'}</p>
            </div>
            <span className={styles.accessStatus}>{accessUrl ? 'Factory access link issued' : shareBusy ? 'Issuing factory link…' : 'Factory link not issued'}</span>
          </div>
          {accessUrl ? <details className={styles.urlDetails}><summary>Show issued access address</summary><code>{accessUrl}</code></details> : null}
          <footer className={styles.labelFooter}><span>Part {view.job.partNumber}</span><span>Release #{view.release.revisionNumber}</span><span>Scan the QR code before setup</span></footer>
        </section>
      ) : null}
    </main>
  );
}
