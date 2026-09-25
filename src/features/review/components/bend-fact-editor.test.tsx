import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Asset, Bend } from '@/contracts';
import { draft, ids, pendingAsset, sourceAsset } from '../../../../tests/contracts/fixtures';
import { BendFactEditor } from './bend-fact-editor';

afterEach(() => cleanup());

const baseBend: Bend = structuredClone(draft.content.bends[0]);
const extraVerifiedDrawing: Asset = { ...sourceAsset, id: ids.review, filename: 'revision-B.pdf', drawingRevision: 'B' };

function chooseCitation() {
  fireEvent.change(screen.getByLabelText('Ready, verified source drawing'), { target: { value: sourceAsset.id } });
  fireEvent.change(screen.getByLabelText('Page number'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Exact source excerpt'), { target: { value: '  Bend B1 — 105° external; R4.  ' } });
}

function openCorrection() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit bend facts' }));
}

describe('bend fact correction editor', () => {
  it('stages all changed sourced values with the exact verified drawing citation', () => {
    const onStageCorrection = vi.fn<(next: Bend) => void>();
    render(<BendFactEditor bend={baseBend} sourceAssets={[pendingAsset, sourceAsset, extraVerifiedDrawing]} onStageCorrection={onStageCorrection} />);

    openCorrection();
    fireEvent.change(screen.getByLabelText('Finished angle (degrees)'), { target: { value: '105' } });
    fireEvent.change(screen.getByLabelText('Finished angle convention'), { target: { value: 'external' } });
    fireEvent.change(screen.getByLabelText('Fold rotation (degrees)'), { target: { value: '-105' } });
    fireEvent.change(screen.getByLabelText('Inside radius (mm)'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Bend direction'), { target: { value: 'Down from flat' } });
    chooseCitation();
    fireEvent.click(screen.getByRole('button', { name: 'Stage correction in draft' }));

    expect(onStageCorrection).toHaveBeenCalledTimes(1);
    const staged = onStageCorrection.mock.calls[0][0];
    const citation = { kind: 'document', assetId: sourceAsset.id, page: 2, region: null, excerpt: '  Bend B1 — 105° external; R4.  ' };
    for (const sourced of [staged.finishedAngle, staged.foldRotationDeg, staged.insideRadiusMm, staged.directionText]) {
      expect(sourced.evidenceState).toBe('supported');
      expect(sourced.evidence).toEqual([citation]);
      expect(sourced.originalText).toBe(citation.excerpt);
    }
    expect(staged.finishedAngle.value).toEqual({ degrees: 105, convention: 'external' });
    expect(staged.foldRotationDeg.value).toBe(-105);
    expect(staged.insideRadiusMm.value).toBe(4);
    expect(staged.directionText.value).toBe('Down from flat');
    expect(screen.getByRole('status')).toHaveTextContent(/staged in the draft/i);

    fireEvent.click(screen.getByRole('button', { name: 'Hide fact correction' }));
    expect(screen.getByRole('button', { name: 'Edit bend facts' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status')).toHaveTextContent(/staged in the draft/i);
    fireEvent.click(screen.getByRole('button', { name: 'Edit bend facts' }));
    expect(screen.getByRole('button', { name: 'Hide fact correction' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/staged in the draft/i);
  });

  it('preserves untouched sourced values and evidence', () => {
    const onStageCorrection = vi.fn<(next: Bend) => void>();
    render(<BendFactEditor bend={baseBend} sourceAssets={[sourceAsset]} onStageCorrection={onStageCorrection} />);
    openCorrection();
    fireEvent.change(screen.getByLabelText('Inside radius (mm)'), { target: { value: '4' } });
    chooseCitation();
    fireEvent.click(screen.getByRole('button', { name: 'Stage correction in draft' }));

    const staged = onStageCorrection.mock.calls[0][0];
    expect(staged.finishedAngle).toEqual(baseBend.finishedAngle);
    expect(staged.foldRotationDeg).toEqual(baseBend.foldRotationDeg);
    expect(staged.directionText).toEqual(baseBend.directionText);
    expect(staged.insideRadiusMm.evidence).toEqual([{
      kind: 'document', assetId: sourceAsset.id, page: 2, region: null, excerpt: '  Bend B1 — 105° external; R4.  ',
    }]);
  });

  it('rejects a changed fact without a verified PDF citation, positive page and excerpt', () => {
    const onStageCorrection = vi.fn<(next: Bend) => void>();
    render(<BendFactEditor bend={baseBend} sourceAssets={[pendingAsset]} onStageCorrection={onStageCorrection} />);
    openCorrection();
    fireEvent.change(screen.getByLabelText('Finished angle (degrees)'), { target: { value: '105' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stage correction in draft' }));

    expect(onStageCorrection).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Ready, verified source drawing')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Exact source excerpt')).toHaveAttribute('aria-describedby', expect.stringContaining('excerpt-error'));
    expect(screen.getByText(/positive whole page number/i)).toBeVisible();
    expect(screen.getByText('Enter the exact source excerpt supporting this correction.')).toBeVisible();
  });
});
