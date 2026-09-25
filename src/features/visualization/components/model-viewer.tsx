'use client';

import dynamic from 'next/dynamic';

import type { ModelViewerProps } from './signatures';
import styles from '../visualization.module.css';

export const ModelViewer = dynamic<ModelViewerProps>(
  () => import('./model-viewer-canvas').then((module) => module.ModelViewerCanvas),
  {
    ssr: false,
    loading: () => <div className={styles.sceneLoading} role="status">Loading supplied 3D model…</div>,
  },
);
