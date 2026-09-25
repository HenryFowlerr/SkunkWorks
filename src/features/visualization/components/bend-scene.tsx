'use client';

import dynamic from 'next/dynamic';

import type { BendSceneProps } from './signatures';
import styles from '../visualization.module.css';

export const BendScene = dynamic<BendSceneProps>(
  () => import('./bend-scene-canvas').then((module) => module.BendSceneCanvas),
  {
    ssr: false,
    loading: () => <div className={styles.sceneLoading} role="status">Loading bend diagram…</div>,
  },
);
