'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';
import { partPath } from '@/lib/parts/path';
import styles from './native-part-sources.module.css';

/** Identity link only. A QR never grants access or implies guidance approval. */
export function PartQr({ jobId }: { jobId: string }) {
  const path = partPath(jobId);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(new URL(path, window.location.origin).toString(), { errorCorrectionLevel: 'M', margin: 4, width: 256 })
      .then(value => { if (active) setQr(value); })
      .catch(() => { if (active) setError('The QR image could not be generated. Use the part link.'); });
    return () => { active = false; };
  }, [path]);
  return <details className={styles.qr}>
    <summary>Open this part on a phone</summary>
    <p>Scan with the phone camera and sign in with workspace access. This QR stays the same as approved knowledge grows.</p>
    {qr ? <Image unoptimized src={qr} alt="Stable part QR code" width={256} height={256} /> : <p role="status">{error ?? 'Preparing part QR…'}</p>}
    <p><a href={path} target="_blank" rel="noreferrer">Open part knowledge base</a></p>
  </details>;
}
