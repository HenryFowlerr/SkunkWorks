'use client';

import { useEffect, useState } from 'react';
import type { Asset } from '@/contracts';
import type { NativePreview } from '@/contracts/native-preview';
import { Button, StatusBadge } from '@/components/ui';
import { api, type ApiClient } from '@/lib/api/client';
import styles from './native-part-sources.module.css';

function NativeSource({ asset, client }: { asset: Asset; client: Pick<ApiClient, 'assets'> }) {
  const [preview, setPreview] = useState<NativePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    client.assets.getPreview({ assetId: asset.id }).then((value) => {
      if (active) { setPreview(value); setError(null); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'The cached preview could not be loaded.');
    });
    return () => { active = false; };
  }, [asset.id, client, retry]);
  return <article className={styles.source}>
    <h3>{asset.kind === 'native_part' ? 'Part model preview' : 'Drawing preview'}</h3>
    <p className={styles.filename}>{asset.filename}</p>
    <StatusBadge label="Cached source preview" tone="review" />
    {preview ? <figure className={styles.figure}>
      {/* Native PNG bytes are authenticated and bounded by the same-origin API. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:${preview.mimeType};base64,${preview.imageBase64}`} width={preview.width} height={preview.height} alt={`${asset.filename}: ${preview.label}`} />
      <figcaption>{preview.label}. {preview.width} × {preview.height} pixels.</figcaption>
    </figure> : error ? <div role="alert"><p>{error}</p><Button type="button" tone="secondary" small onClick={() => { setError(null); setRetry(value => value + 1); }}>Retry preview</Button></div> : <p role="status">Loading private source preview…</p>}
  </article>;
}

export function NativePartSources({ assets, client = api }: { assets: Asset[]; client?: Pick<ApiClient, 'assets'> }) {
  const native = assets.filter(asset => ['native_part', 'native_drawing'].includes(asset.kind) && asset.status === 'ready' && asset.sha256);
  if (!native.length) return null;
  return <section className={styles.section} aria-label="Native part sources">
    <h2>Supplied part files</h2>
    <p>These images were saved inside the SolidWorks originals. The model image cannot be rotated; small drawing notes may be unreadable. Engineering has not verified manufacturing instructions from these previews.</p>
    <div className={styles.sources}>{native.map(asset => <NativeSource key={`${asset.id}:${asset.sha256}`} asset={asset} client={client} />)}</div>
  </section>;
}
