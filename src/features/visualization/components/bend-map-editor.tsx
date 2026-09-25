'use client';

import { useMemo, useState } from 'react';

import { Button, Panel, PanelBody, StatusBadge, TextInput } from '@/components/ui';
import type { Bend, PanelModel } from '@/contracts';
import { validateSceneData } from '../geometry/pose';
import type { BendMapEditorProps } from './signatures';
import { BendScene } from './bend-scene';
import styles from '../visualization.module.css';

type PanelDraft = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type HingeDraft = {
  id: string;
  parentPanelId: string;
  childPanelId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

const makePanelDraft = (): PanelDraft => ({ id: '', x: 0, y: 0, width: 80, height: 50 });
const makeHingeDraft = (model: PanelModel | null): HingeDraft => ({
  id: '',
  parentPanelId: model?.rootPanelId ?? '',
  childPanelId: model?.panels.find((panel) => panel.id !== model.rootPanelId)?.id ?? '',
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 50,
});
const cloneModel = (model: PanelModel): PanelModel => ({
  ...model,
  panels: model.panels.map((panel) => ({ ...panel, polygonMm: panel.polygonMm.map((point) => [...point] as [number, number]) })),
  hinges: model.hinges.map((hinge) => ({
    ...hinge,
    axisStartMm: [...hinge.axisStartMm] as [number, number],
    axisEndMm: [...hinge.axisEndMm] as [number, number],
  })),
});

function previewStepId(index: number): string {
  return '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
}

export function BendMapEditor(props: BendMapEditorProps) {
  const resetKey = JSON.stringify([props.value, props.bends]);
  return <BendMapEditorForm key={resetKey} {...props} />;
}

function BendMapEditorForm({ value, bends, onChange, readOnly = false }: BendMapEditorProps) {
  const [model, setModel] = useState<PanelModel | null>(value ? cloneModel(value) : null);
  const [localBends, setLocalBends] = useState<Bend[]>(structuredClone(bends));
  const [newPanel, setNewPanel] = useState<PanelDraft>(makePanelDraft);
  const [newHinge, setNewHinge] = useState<HingeDraft>(() => makeHingeDraft(value));
  const [previewCount, setPreviewCount] = useState(0);

  const modelProblem = useMemo(() => {
    if (!model) return null;
    try {
      validateSceneData({ panelModel: model, bends: [], steps: [] });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'The panel mapping is incomplete.';
    }
  }, [model]);

  const mappedPanelIssues = useMemo(() => {
    const issues: string[] = [];
    const seen = new Set<string>();
    for (const bend of localBends) {
      if (!bend.hingeId) issues.push('Bend ' + bend.bendId + ' has no hinge mapping.');
      else if (!model?.hinges.some((hinge) => hinge.id === bend.hingeId)) issues.push('Bend ' + bend.bendId + ' points to a missing hinge.');
      else if (seen.has(bend.hingeId)) issues.push('More than one bend is mapped to hinge ' + bend.hingeId + '.');
      else seen.add(bend.hingeId);
      if (bend.foldRotationDeg.value === null || !Number.isFinite(bend.foldRotationDeg.value)) {
        issues.push('Bend ' + bend.bendId + ' has no signed fold rotation.');
      }
    }
    return issues;
  }, [localBends, model]);

  const preview = useMemo(() => {
    if (!model || modelProblem || mappedPanelIssues.length > 0 || localBends.length === 0) return null;
    const previewBends = localBends;
    const steps = previewBends.map((bend, index) => ({
      id: previewStepId(index),
      bendId: bend.bendId,
      instruction: 'Preview bend ' + bend.bendId,
      evidence: [],
      camera: null,
    }));
    try {
      validateSceneData({ panelModel: model, bends: previewBends, steps });
      return { panelModel: model, bends: previewBends, steps };
    } catch {
      return null;
    }
  }, [model, modelProblem, localBends, mappedPanelIssues]);

  const emit = (nextModel: PanelModel, nextBends: Bend[]) => {
    nextModel.origin = 'reviewer_mapped';
    nextModel.reviewed = false;
    setModel(nextModel);
    setLocalBends(nextBends);
    try {
      validateSceneData({ panelModel: nextModel, bends: nextBends, steps: [] });
      onChange(nextModel, nextBends);
    } catch {
      // Keep incomplete topology local until it becomes a valid panel tree.
    }
  };

  const startModel = () => {
    const next: PanelModel = {
      schemaVersion: '1.0',
      units: 'mm',
      thicknessMm: 2,
      rootPanelId: 'base',
      panels: [{ id: 'base', polygonMm: [[0, 0], [120, 0], [120, 80], [0, 80]] }],
      hinges: [],
      origin: 'reviewer_mapped',
      referenceFaceLabel: 'Outside face',
      reviewed: false,
    };
    setNewHinge(makeHingeDraft(next));
    emit(next, localBends);
  };

  const addPanel = () => {
    if (!model || readOnly) return;
    const panelId = newPanel.id.trim();
    if (!panelId || model.panels.some((panel) => panel.id === panelId) || newPanel.width <= 0 || newPanel.height <= 0) return;
    const next = cloneModel(model);
    next.panels.push({
      id: panelId,
      polygonMm: [
        [newPanel.x, newPanel.y],
        [newPanel.x + newPanel.width, newPanel.y],
        [newPanel.x + newPanel.width, newPanel.y + newPanel.height],
        [newPanel.x, newPanel.y + newPanel.height],
      ],
    });
    setNewPanel({ ...newPanel, id: '' });
    setNewHinge({ ...newHinge, childPanelId: panelId });
    emit(next, structuredClone(localBends));
  };

  const addHinge = () => {
    if (!model || readOnly) return;
    if (!newHinge.id.trim() || model.hinges.some((hinge) => hinge.id === newHinge.id.trim())) return;
    const next = cloneModel(model);
    next.hinges.push({
      id: newHinge.id.trim(),
      parentPanelId: newHinge.parentPanelId,
      childPanelId: newHinge.childPanelId,
      axisStartMm: [newHinge.startX, newHinge.startY],
      axisEndMm: [newHinge.endX, newHinge.endY],
    });
    const nextBends = structuredClone(localBends);
    const mappedBend = nextBends.find((bend) => bend.hingeId === null);
    if (mappedBend) mappedBend.hingeId = newHinge.id.trim();
    setNewHinge({ ...newHinge, id: '' });
    emit(next, nextBends);
  };

  const updatePolygonPoint = (panelId: string, pointIndex: number, coordinate: 0 | 1, raw: string) => {
    if (!model || readOnly) return;
    const next = cloneModel(model);
    const panel = next.panels.find((item) => item.id === panelId);
    if (!panel) return;
    panel.polygonMm[pointIndex][coordinate] = raw === '' ? 0 : Number(raw);
    emit(next, structuredClone(localBends));
  };

  const removePanel = (panelId: string) => {
    if (!model || readOnly || panelId === model.rootPanelId) return;
    const next = cloneModel(model);
    const removedHinges = new Set(next.hinges.filter((hinge) => hinge.parentPanelId === panelId || hinge.childPanelId === panelId).map((hinge) => hinge.id));
    next.panels = next.panels.filter((panel) => panel.id !== panelId);
    next.hinges = next.hinges.filter((hinge) => !removedHinges.has(hinge.id));
    const nextBends = structuredClone(localBends);
    for (const bend of nextBends) if (bend.hingeId && removedHinges.has(bend.hingeId)) bend.hingeId = null;
    emit(next, nextBends);
  };

  const removeHinge = (hingeId: string) => {
    if (!model || readOnly) return;
    const next = cloneModel(model);
    next.hinges = next.hinges.filter((hinge) => hinge.id !== hingeId);
    const nextBends = structuredClone(localBends);
    for (const bend of nextBends) if (bend.hingeId === hingeId) bend.hingeId = null;
    emit(next, nextBends);
  };

  const updateBend = (bendId: string, update: (bend: Bend) => void) => {
    if (readOnly) return;
    const nextBends = structuredClone(localBends);
    const bend = nextBends.find((item) => item.bendId === bendId);
    if (!bend) return;
    update(bend);
    if (model) emit(cloneModel(model), nextBends);
  };

  const updateModelLabel = (field: 'thicknessMm' | 'referenceFaceLabel', raw: string) => {
    if (!model || readOnly) return;
    const next = cloneModel(model);
    if (field === 'thicknessMm') next.thicknessMm = raw === '' ? 0 : Number(raw);
    else next.referenceFaceLabel = raw;
    emit(next, structuredClone(localBends));
  };

  const setHingeDraftValue = (key: keyof HingeDraft, raw: string) => {
    if (key === 'id' || key === 'parentPanelId' || key === 'childPanelId') {
      setNewHinge((current) => ({ ...current, [key]: raw }));
    } else {
      setNewHinge((current) => ({ ...current, [key]: raw === '' ? 0 : Number(raw) }));
    }
  };

  return (
    <Panel title="Bend mapping" eyebrow="Reviewer editable geometry">
      <PanelBody>
        <div className={styles.mapEditor}>
          <p className={styles.mapHelp}>
            Map stable drawing IDs to straight panel hinges. Coordinates are millimetres; positive signed rotation follows the directed hinge arrow. This is a rigid-panel diagram, not a press-brake simulation.
          </p>
          {modelProblem ? <p className={styles.mapError} role="alert">{modelProblem}</p> : null}
          {modelProblem && !readOnly ? <p className={styles.mapHelp}>Incomplete geometry stays in this editor until the panel tree is valid; it is not sent for draft saving.</p> : null}
          {mappedPanelIssues.length > 0 ? (
            <div className={styles.mapHint} role="status">
              {mappedPanelIssues.length} bend mapping issue{mappedPanelIssues.length === 1 ? '' : 's'} remain. Publication stays blocked until the source interpretation is complete.
            </div>
          ) : null}
          {!model ? (
            <div>
              <p className={styles.mapHelp}>No panel/hinge mapping is attached to this draft yet.</p>
              <Button type="button" onClick={startModel} disabled={readOnly}>Create a base panel</Button>
            </div>
          ) : (
            <>
              <div className={styles.mapSection}>
                <h3>Panel model</h3>
                <div className={styles.mapGrid}>
                  <TextInput
                    label="Reference-face label"
                    value={model.referenceFaceLabel}
                    onChange={(event) => updateModelLabel('referenceFaceLabel', event.currentTarget.value)}
                    disabled={readOnly}
                  />
                  <TextInput
                    label="Sheet thickness (mm)"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={model.thicknessMm}
                    onChange={(event) => updateModelLabel('thicknessMm', event.currentTarget.value)}
                    disabled={readOnly}
                  />
                </div>
                <div className={styles.mapList}>
                  {model.panels.map((panel) => (
                    <section className={styles.mapListItem} key={panel.id} aria-label={'Panel ' + panel.id}>
                      <div className={styles.mapListHeader}>
                        <strong>{panel.id}{panel.id === model.rootPanelId ? ' · root' : ''}</strong>
                        {panel.id !== model.rootPanelId ? (
                          <Button type="button" tone="danger" small disabled={readOnly} onClick={() => removePanel(panel.id)}>
                            Remove panel and hinges
                          </Button>
                        ) : null}
                      </div>
                      <div className={styles.mapGridThree}>
                        {panel.polygonMm.map((point, index) => (
                          <div className={styles.mapListItem} key={index}>
                            <span className="mono">Vertex {index + 1}</span>
                            <label className={styles.mapInlineLabel}>
                              X mm
                              <input type="number" step="0.1" value={point[0]} disabled={readOnly}
                                onChange={(event) => updatePolygonPoint(panel.id, index, 0, event.currentTarget.value)} />
                            </label>
                            <label className={styles.mapInlineLabel}>
                              Y mm
                              <input type="number" step="0.1" value={point[1]} disabled={readOnly}
                                onChange={(event) => updatePolygonPoint(panel.id, index, 1, event.currentTarget.value)} />
                            </label>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                <form className={styles.mapListItem} onSubmit={(event) => { event.preventDefault(); addPanel(); }}>
                  <strong>Add rectangular panel</strong>
                  <div className={styles.mapGridThree}>
                    <label className={styles.mapInlineLabel}>Panel ID
                      <input value={newPanel.id} onChange={(event) => setNewPanel({ ...newPanel, id: event.currentTarget.value })} disabled={readOnly} />
                    </label>
                    <label className={styles.mapInlineLabel}>X offset (mm)
                      <input type="number" step="0.1" value={newPanel.x} onChange={(event) => setNewPanel({ ...newPanel, x: Number(event.currentTarget.value) })} disabled={readOnly} />
                    </label>
                    <label className={styles.mapInlineLabel}>Y offset (mm)
                      <input type="number" step="0.1" value={newPanel.y} onChange={(event) => setNewPanel({ ...newPanel, y: Number(event.currentTarget.value) })} disabled={readOnly} />
                    </label>
                    <label className={styles.mapInlineLabel}>Width (mm)
                      <input type="number" step="0.1" min="0.1" value={newPanel.width} onChange={(event) => setNewPanel({ ...newPanel, width: Number(event.currentTarget.value) })} disabled={readOnly} />
                    </label>
                    <label className={styles.mapInlineLabel}>Height (mm)
                      <input type="number" step="0.1" min="0.1" value={newPanel.height} onChange={(event) => setNewPanel({ ...newPanel, height: Number(event.currentTarget.value) })} disabled={readOnly} />
                    </label>
                  </div>
                  <Button type="submit" tone="secondary" disabled={readOnly || !newPanel.id.trim()}>Add panel</Button>
                </form>
              </div>

              <div className={styles.mapSection}>
                <h3>Hinges</h3>
                {model.hinges.length === 0 ? <p className={styles.mapHelp}>Add a hinge to connect each child panel to the base or another panel.</p> : null}
                <ul className={styles.mapList}>
                  {model.hinges.map((hinge) => (
                    <li className={styles.mapListItem} key={hinge.id}>
                      <div className={styles.mapListHeader}>
                        <strong>{hinge.id}</strong>
                        <Button type="button" tone="danger" small disabled={readOnly} onClick={() => removeHinge(hinge.id)}>Remove hinge</Button>
                      </div>
                      <span className={styles.mapHelp}>{hinge.parentPanelId} → {hinge.childPanelId}</span>
                      <span className={styles.mapHelp}>
                        Axis: ({hinge.axisStartMm[0]}, {hinge.axisStartMm[1]}) → ({hinge.axisEndMm[0]}, {hinge.axisEndMm[1]}) mm
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={styles.mapListItem}>
                  <strong>Add straight hinge</strong>
                  <div className={styles.mapGridThree}>
                    <label className={styles.mapInlineLabel}>Hinge ID
                      <input value={newHinge.id} onChange={(event) => setHingeDraftValue('id', event.currentTarget.value)} disabled={readOnly} />
                    </label>
                    <label className={styles.mapInlineLabel}>Parent panel
                      <select value={newHinge.parentPanelId} onChange={(event) => setHingeDraftValue('parentPanelId', event.currentTarget.value)} disabled={readOnly}>
                        {model.panels.map((panel) => <option key={panel.id} value={panel.id}>{panel.id}</option>)}
                      </select>
                    </label>
                    <label className={styles.mapInlineLabel}>Child panel
                      <select value={newHinge.childPanelId} onChange={(event) => setHingeDraftValue('childPanelId', event.currentTarget.value)} disabled={readOnly}>
                        {model.panels.filter((panel) => panel.id !== newHinge.parentPanelId).map((panel) => <option key={panel.id} value={panel.id}>{panel.id}</option>)}
                      </select>
                    </label>
                    <label className={styles.mapInlineLabel}>Axis start X (mm)
                      <input type="number" step="0.1" value={newHinge.startX} onChange={(event) => setHingeDraftValue('startX', event.currentTarget.value)} disabled={readOnly} />
                    </label>
                    <label className={styles.mapInlineLabel}>Axis start Y (mm)
                      <input type="number" step="0.1" value={newHinge.startY} onChange={(event) => setHingeDraftValue('startY', event.currentTarget.value)} disabled={readOnly} />
                    </label>
                    <label className={styles.mapInlineLabel}>Axis end X (mm)
                      <input type="number" step="0.1" value={newHinge.endX} onChange={(event) => setHingeDraftValue('endX', event.currentTarget.value)} disabled={readOnly} />
                    </label>
                    <label className={styles.mapInlineLabel}>Axis end Y (mm)
                      <input type="number" step="0.1" value={newHinge.endY} onChange={(event) => setHingeDraftValue('endY', event.currentTarget.value)} disabled={readOnly} />
                    </label>
                  </div>
                  <Button type="button" tone="secondary" disabled={readOnly || model.panels.length < 2 || !newHinge.id.trim()} onClick={addHinge}>Add hinge</Button>
                </div>
              </div>

              <div className={styles.mapSection}>
                <h3>Drawing bend mapping</h3>
                {localBends.length === 0 ? <p className={styles.mapHelp}>No numbered bends are available yet. Add them from the reviewed source interpretation.</p> : null}
                <ul className={styles.mapList}>
                  {localBends.map((bend) => (
                    <li className={styles.mapListItem} key={bend.bendId}>
                      <div className={styles.mapListHeader}>
                        <strong>Bend {bend.bendId}</strong>
                        {bend.hingeId && model.hinges.some((hinge) => hinge.id === bend.hingeId)
                          ? <StatusBadge label="Mapped" tone="complete" />
                          : <StatusBadge label="Needs mapping" tone="review" />}
                      </div>
                      <div className={styles.mapGrid}>
                        <label className={styles.mapInlineLabel}>Panel hinge
                          <select value={bend.hingeId ?? ''} disabled={readOnly}
                            onChange={(event) => updateBend(bend.bendId, (next) => { next.hingeId = event.currentTarget.value || null; })}>
                            <option value="">Choose a hinge</option>
                            {model.hinges.map((hinge) => <option key={hinge.id} value={hinge.id}>{hinge.parentPanelId} → {hinge.childPanelId} · {hinge.id}</option>)}
                          </select>
                        </label>
                        <label className={styles.mapInlineLabel}>Signed fold rotation from flat (degrees)
                          <input type="number" step="1" value={bend.foldRotationDeg.value ?? ''}
                            onChange={(event) => updateBend(bend.bendId, (next) => { next.foldRotationDeg = { ...next.foldRotationDeg, value: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) }; })}
                            disabled={readOnly} />
                        </label>
                      </div>
                      <p className={styles.mapHelp}>
                        Printed target: {bend.finishedAngle.value ? bend.finishedAngle.value.degrees + '° ' + bend.finishedAngle.value.convention.replace('_', ' ') : 'not established'}.
                        {' '}This displayed target is separate from the signed fold rotation.
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.mapSection}>
                <div className={styles.mapListHeader}>
                  <h3>Sequence preview</h3>
                  {model.reviewed ? <StatusBadge label="Reviewed geometry" tone="complete" /> : <StatusBadge label="Changes need review" tone="review" />}
                </div>
                {preview ? (
                  <div className={styles.mapPreview}>
                    <div className={styles.previewNav}>
                      <Button type="button" tone="secondary" small disabled={previewCount <= 0} onClick={() => setPreviewCount((count) => Math.max(0, count - 1))}>Previous pose</Button>
                      <span className="mono">{previewCount === 0 ? 'Flat pattern' : 'After ' + previewCount + ' bends'}</span>
                      <Button type="button" tone="secondary" small disabled={previewCount >= preview.steps.length} onClick={() => setPreviewCount((count) => Math.min(preview.steps.length, count + 1))}>Next pose</Button>
                    </div>
                    <BendScene data={preview} completedStepCount={previewCount} activeStepProgress={0}
                      selectedBendId={previewCount > 0 ? preview.steps[previewCount - 1]?.bendId ?? null : null}
                      interactive={false} reducedMotion />
                  </div>
                ) : (
                  <div className={styles.mapHint}>
                    Complete the panel tree and assign each bend a unique hinge plus a signed fold rotation to preview these intermediate poses.
                  </div>
                )}
              </div>
              <p className={styles.mapHelp}>Any mapping edit marks the geometry as needing review. The server records review state; it cannot be set from this editor.</p>
            </>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
