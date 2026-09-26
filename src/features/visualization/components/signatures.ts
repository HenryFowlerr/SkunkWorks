import type { ReactNode } from 'react';

import type { Bend, Id, PanelModel, Step } from '@/contracts';

export type SceneData = { panelModel: PanelModel; bends: Bend[]; steps: Step[] };
export type BendSceneProps = {
  data: SceneData;
  completedStepCount: number;
  activeStepProgress: number;
  selectedBendId: string | null;
  interactive: boolean;
  reducedMotion?: boolean;
  onBendSelect?: (bendId: string) => void;
};
export type ModelViewerProps = {
  assetId: Id;
  format: 'glb' | 'stl';
  resolveAssetUrl: (assetId: Id) => Promise<string>;
  onError?: (message: string) => void;
};
export type BendMapEditorProps = {
  value: PanelModel | null;
  bends: Bend[];
  onChange: (next: PanelModel, bends: Bend[]) => void;
  readOnly?: boolean;
};

// Kept here as compile-time documentation matching the shared contract.
export type VisualizationNode = ReactNode;
export type { Bend, Id, PanelModel, Step };
