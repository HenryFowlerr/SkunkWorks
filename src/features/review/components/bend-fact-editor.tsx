'use client';

import { useState, type FormEvent } from 'react';

import type { Asset, Bend, EvidenceRef } from '@/contracts';
import { Button, Field, Panel, PanelBody, TextInput } from '@/components/ui';

export type BendFactEditorProps = {
  bend: Bend;
  sourceAssets: Asset[];
  disabled?: boolean;
  onStageCorrection: (next: Bend) => void;
};

type CorrectionForm = {
  finishedAngleDegrees: string;
  finishedAngleConvention: 'internal' | 'external' | 'from_flat';
  foldRotationDeg: string;
  insideRadiusMm: string;
  directionText: string;
  assetId: string;
  page: string;
  excerpt: string;
};

type FormErrors = Partial<Record<keyof CorrectionForm | 'facts', string>>;

const conventions = [
  { value: 'internal', label: 'Internal angle' },
  { value: 'external', label: 'External angle' },
  { value: 'from_flat', label: 'From flat' },
] as const;

function formFromBend(bend: Bend): CorrectionForm {
  return {
    finishedAngleDegrees: bend.finishedAngle.value?.degrees.toString() ?? '',
    finishedAngleConvention: bend.finishedAngle.value?.convention ?? 'internal',
    foldRotationDeg: bend.foldRotationDeg.value?.toString() ?? '',
    insideRadiusMm: bend.insideRadiusMm.value?.toString() ?? '',
    directionText: bend.directionText.value ?? '',
    assetId: '',
    page: '',
    excerpt: '',
  };
}

function finiteNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

type SourcedFact<T> = {
  value: T | null;
  evidence: EvidenceRef[];
  evidenceState: Bend['foldRotationDeg']['evidenceState'];
  originalText: string | null;
};

function withCitation<T>(current: SourcedFact<T>, value: T, citation: Extract<EvidenceRef, { kind: 'document' }>): SourcedFact<T> {
  return {
    ...current,
    value,
    evidence: [citation],
    evidenceState: 'supported' as const,
    originalText: citation.excerpt,
  };
}

function isVerifiedDrawing(asset: Asset): boolean {
  return asset.kind === 'drawing_pdf'
    && asset.status === 'ready'
    && asset.sha256 !== null
    && /^[a-f0-9]{64}$/i.test(asset.sha256);
}

export function BendFactEditor({ bend, sourceAssets, disabled = false, onStageCorrection }: BendFactEditorProps) {
  const [form, setForm] = useState(() => formFromBend(bend));
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const eligibleDrawings = sourceAssets.filter(isVerifiedDrawing);

  const update = <K extends keyof CorrectionForm>(key: K, value: CorrectionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, facts: undefined }));
    setStatus(null);
  };

  const stage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    const finishedDegrees = finiteNumber(form.finishedAngleDegrees);
    const foldRotation = finiteNumber(form.foldRotationDeg);
    const insideRadius = finiteNumber(form.insideRadiusMm);
    const originalDegrees = bend.finishedAngle.value?.degrees ?? null;
    const originalConvention = bend.finishedAngle.value?.convention ?? null;
    const finishedAngleChanged = finishedDegrees !== originalDegrees
      || (originalConvention !== null && form.finishedAngleConvention !== originalConvention);
    const foldRotationChanged = foldRotation !== bend.foldRotationDeg.value;
    const insideRadiusChanged = insideRadius !== bend.insideRadiusMm.value;
    const directionChanged = form.directionText !== (bend.directionText.value ?? '');
    const changed = finishedAngleChanged || foldRotationChanged || insideRadiusChanged || directionChanged;

    if (!changed) {
      setErrors({});
      setStatus('No bend facts changed. Nothing was staged.');
      return;
    }

    const nextErrors: FormErrors = {};
    const selectedAsset = eligibleDrawings.find((asset) => asset.id === form.assetId);
    if (!selectedAsset) nextErrors.assetId = 'Select a ready drawing PDF with a verified SHA-256 digest.';
    const page = Number(form.page);
    if (!Number.isInteger(page) || page <= 0 || form.page.trim() === '') nextErrors.page = 'Enter a positive whole page number.';
    if (form.excerpt.trim() === '') nextErrors.excerpt = 'Enter the exact source excerpt supporting this correction.';
    if (finishedAngleChanged && (finishedDegrees === null || form.finishedAngleDegrees.trim() === '')) {
      nextErrors.finishedAngleDegrees = 'Enter a finite finished angle for this correction.';
    }
    if (foldRotationChanged && (foldRotation === null || form.foldRotationDeg.trim() === '')) {
      nextErrors.foldRotationDeg = 'Enter a finite fold rotation for this correction.';
    }
    if (insideRadiusChanged && (insideRadius === null || insideRadius < 0 || form.insideRadiusMm.trim() === '')) {
      nextErrors.insideRadiusMm = 'Enter a finite, non-negative inside radius.';
    }
    if (Object.keys(nextErrors).length > 0 || !selectedAsset) {
      setErrors(nextErrors);
      return;
    }

    const citation: Extract<EvidenceRef, { kind: 'document' }> = {
      kind: 'document',
      assetId: selectedAsset.id,
      page,
      region: null,
      excerpt: form.excerpt,
    };
    const next: Bend = {
      ...bend,
      finishedAngle: finishedAngleChanged
        ? withCitation(bend.finishedAngle, { degrees: finishedDegrees as number, convention: form.finishedAngleConvention }, citation)
        : bend.finishedAngle,
      foldRotationDeg: foldRotationChanged
        ? withCitation(bend.foldRotationDeg, foldRotation as number, citation)
        : bend.foldRotationDeg,
      insideRadiusMm: insideRadiusChanged
        ? withCitation(bend.insideRadiusMm, insideRadius as number, citation)
        : bend.insideRadiusMm,
      directionText: directionChanged
        ? withCitation(bend.directionText, form.directionText, citation)
        : bend.directionText,
    };

    onStageCorrection(next);
    setErrors({});
    setStatus('Correction staged in the draft. Save the draft separately to send it to the service.');
  };

  const prefix = `bend-correction-${bend.bendId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <Panel title={`Correct sourced facts · Bend ${bend.bendId}`} eyebrow="Staged draft changes">
      <PanelBody>
        <p className="field__hint">Corrections are staged in this draft only. A later save sends them to the service.</p>
        <Button type="button" tone="secondary" small aria-expanded={isOpen} aria-controls={`${prefix}-editor`} onClick={() => setIsOpen((open) => !open)}>
          {isOpen ? 'Hide fact correction' : 'Edit bend facts'}
        </Button>
        {status ? <p className="field__hint" role="status">{status}</p> : null}
        <div id={`${prefix}-editor`} hidden={!isOpen}>
          <form className="bend-fact-editor" onSubmit={stage} noValidate>
          <div className="bend-fact-editor__facts">
            <TextInput
              id={`${prefix}-angle`}
              label="Finished angle (degrees)"
              type="number"
              step="any"
              value={form.finishedAngleDegrees}
              onChange={(event) => update('finishedAngleDegrees', event.currentTarget.value)}
              disabled={disabled}
              error={errors.finishedAngleDegrees}
            />
            <Field id={`${prefix}-convention`} label="Finished angle convention">
              <select id={`${prefix}-convention`} className="field__control" value={form.finishedAngleConvention} disabled={disabled} onChange={(event) => update('finishedAngleConvention', event.currentTarget.value as CorrectionForm['finishedAngleConvention'])}>
                {conventions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </Field>
            <TextInput
              id={`${prefix}-rotation`}
              label="Fold rotation (degrees)"
              type="number"
              step="any"
              value={form.foldRotationDeg}
              onChange={(event) => update('foldRotationDeg', event.currentTarget.value)}
              disabled={disabled}
              error={errors.foldRotationDeg}
            />
            <TextInput
              id={`${prefix}-radius`}
              label="Inside radius (mm)"
              type="number"
              min="0"
              step="any"
              value={form.insideRadiusMm}
              onChange={(event) => update('insideRadiusMm', event.currentTarget.value)}
              disabled={disabled}
              error={errors.insideRadiusMm}
            />
            <TextInput
              id={`${prefix}-direction`}
              label="Bend direction"
              value={form.directionText}
              onChange={(event) => update('directionText', event.currentTarget.value)}
              disabled={disabled}
            />
          </div>

          <fieldset className="bend-fact-editor__citation" disabled={disabled}>
            <legend>Correction source</legend>
            <Field id={`${prefix}-asset`} label="Ready, verified source drawing" error={errors.assetId}>
              <select id={`${prefix}-asset`} className="field__control" value={form.assetId} aria-invalid={Boolean(errors.assetId)} aria-describedby={errors.assetId ? `${prefix}-asset-error` : undefined} onChange={(event) => update('assetId', event.currentTarget.value)}>
                <option value="">Choose a source PDF…</option>
                {eligibleDrawings.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}{asset.drawingRevision ? ` · Rev ${asset.drawingRevision}` : ''}</option>)}
              </select>
            </Field>
            {eligibleDrawings.length === 0 ? <p className="field__error" role="status">No ready drawing PDF with a verified SHA-256 digest is available for citation.</p> : null}
            <TextInput
              id={`${prefix}-page`}
              label="Page number"
              type="number"
              min="1"
              step="1"
              value={form.page}
              onChange={(event) => update('page', event.currentTarget.value)}
              error={errors.page}
            />
            <Field id={`${prefix}-excerpt`} label="Exact source excerpt" error={errors.excerpt} hint="Copy the wording exactly as it appears in the drawing.">
              <textarea id={`${prefix}-excerpt`} className="field__control" rows={3} value={form.excerpt} aria-invalid={Boolean(errors.excerpt)} aria-describedby={[`${prefix}-excerpt-hint`, errors.excerpt ? `${prefix}-excerpt-error` : null].filter(Boolean).join(' ')} onChange={(event) => update('excerpt', event.currentTarget.value)} />
            </Field>
          </fieldset>

          {errors.facts ? <p className="field__error" role="alert">{errors.facts}</p> : null}
          <p className="field__hint">Staging replaces evidence only on changed facts. Untouched values and evidence stay as supplied.</p>
          <Button type="submit" tone="secondary" disabled={disabled}>Stage correction in draft</Button>
          </form>
        </div>
      </PanelBody>
    </Panel>
  );
}
