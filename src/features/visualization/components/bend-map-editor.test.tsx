import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Bend, PanelModel } from '@/contracts';
import { BendMapEditor } from './bend-map-editor';

vi.mock('./bend-scene', () => ({ BendScene: () => null }));

const model: PanelModel = {
  schemaVersion: '1.0',
  units: 'mm',
  thicknessMm: 2,
  rootPanelId: 'base',
  panels: [
    { id: 'base', polygonMm: [[0, 0], [100, 0], [100, 50], [0, 50]] },
    { id: 'flange', polygonMm: [[100, 0], [130, 0], [130, 50], [100, 50]] },
  ],
  hinges: [{
    id: 'h1',
    parentPanelId: 'base',
    childPanelId: 'flange',
    axisStartMm: [100, 0],
    axisEndMm: [100, 50],
  }],
  origin: 'reviewer_mapped',
  referenceFaceLabel: 'Outside face',
  reviewed: false,
};

const bend: Bend = {
  bendId: 'B1',
  hingeId: 'h1',
  finishedAngle: {
    value: { degrees: 90, convention: 'internal' },
    evidence: [],
    evidenceState: 'supported',
    originalText: null,
  },
  foldRotationDeg: {
    value: 90,
    evidence: [],
    evidenceState: 'supported',
    originalText: null,
  },
  insideRadiusMm: {
    value: 1.5,
    evidence: [],
    evidenceState: 'supported',
    originalText: null,
  },
  directionText: {
    value: 'Fold around the directed hinge axis',
    evidence: [],
    evidenceState: 'supported',
    originalText: null,
  },
};

describe('BendMapEditor', () => {
  it('loads an existing mapping with labelled reference-face and thickness controls', () => {
    render(<BendMapEditor value={model} bends={[bend]} onChange={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: 'Reference-face label' })).toHaveValue('Outside face');
    expect(screen.getByRole('spinbutton', { name: 'Sheet thickness (mm)' })).toHaveValue(2);
    expect(screen.getByText('Bend B1')).toBeVisible();
  });
});
