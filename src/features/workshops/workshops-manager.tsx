"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import type { EvidenceRef, EvidenceState, Id, Machine, MachineInput, Role, WorkshopSnapshot } from "@/contracts";
import { api } from "@/lib/api/client";
import { Button, Field, Panel, PanelBody, StatusBadge, TextInput } from "@/components/ui";

import styles from "./workshops-manager.module.css";

type MachineEditor = {
  clientKey: string;
  id: Id | "";
  name: string;
  process: string;
  model: string;
  usableBendLengthMm: string;
  initialUsableBendLengthMm: number | null;
  evidence: EvidenceRef[];
  evidenceState: EvidenceState | "";
  originalText: string | null;
  sourceAssetId: string;
  sourcePage: string;
  sourceExcerpt: string;
  sourceEdited: boolean;
  tools: Machine["tools"];
  notes: Machine["notes"];
  approvedOrderConstraints: Machine["approvedOrderConstraints"];
};

type WorkshopsManagerProps = {
  workspaceId: Id;
  role: Role;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createId(): Id {
  return globalThis.crypto.randomUUID();
}

function blankMachine(clientKey: string, id: Id | "" = ""): MachineEditor {
  return {
    clientKey,
    id,
    name: "",
    process: "",
    model: "",
    usableBendLengthMm: "",
    initialUsableBendLengthMm: null,
    evidence: [],
    evidenceState: "not_found",
    originalText: null,
    sourceAssetId: "",
    sourcePage: "",
    sourceExcerpt: "",
    sourceEdited: false,
    tools: [],
    notes: [],
    approvedOrderConstraints: [],
  };
}

function fromMachine(machine: Machine, index: number): MachineEditor {
  const documentEvidence = machine.usableBendLengthMm.evidence.find((item) => item.kind === "document");
  return {
    clientKey: machine.id || `machine-${index}`,
    id: machine.id,
    name: machine.name,
    process: machine.process,
    model: machine.model ?? "",
    usableBendLengthMm: machine.usableBendLengthMm.value === null ? "" : String(machine.usableBendLengthMm.value),
    initialUsableBendLengthMm: machine.usableBendLengthMm.value,
    evidence: machine.usableBendLengthMm.evidence,
    evidenceState: machine.usableBendLengthMm.evidenceState,
    originalText: machine.usableBendLengthMm.originalText,
    sourceAssetId: documentEvidence?.kind === "document" ? documentEvidence.assetId : "",
    sourcePage: documentEvidence?.kind === "document" ? String(documentEvidence.page) : "",
    sourceExcerpt: documentEvidence?.kind === "document" ? documentEvidence.excerpt : "",
    sourceEdited: false,
    tools: machine.tools,
    notes: machine.notes,
    approvedOrderConstraints: machine.approvedOrderConstraints,
  };
}

function ensureEditorIds(editors: MachineEditor[]): MachineEditor[] {
  return editors.map((editor) => ({ ...editor, id: editor.id || createId() }));
}

function firstValidationError(name: string, editors: MachineEditor[]): string | null {
  if (!name.trim()) return "Enter a workshop profile name.";
  if (editors.length === 0) return "Add at least one machine to this workshop profile.";

  for (const [index, machine] of editors.entries()) {
    const label = `Machine ${index + 1}`;
    if (!machine.name.trim()) return `${label}: enter a machine name.`;
    if (!machine.process.trim()) return `${label}: enter a process.`;

    const rawLength = machine.usableBendLengthMm.trim();
    if (rawLength) {
      const length = Number(rawLength);
      if (!Number.isFinite(length) || length < 0) return `${label}: usable bend length must be a non-negative number, or left blank if unknown.`;
      if (length !== machine.initialUsableBendLengthMm || machine.sourceEdited) {
        if (!UUID_PATTERN.test(machine.sourceAssetId.trim())) return `${label}: use a valid source document asset ID for the bend length.`;
        if (!Number.isInteger(Number(machine.sourcePage)) || Number(machine.sourcePage) < 1) return `${label}: enter the source page for the bend length.`;
        if (!machine.sourceExcerpt.trim()) return `${label}: enter the text that supports the bend length.`;
        if (!machine.evidenceState) return `${label}: choose the evidence state for the bend length.`;
      }
    }

    if (machine.tools.some((tool) => !tool.name.trim())) return `${label}: name each tool or remove the empty tool entry.`;
    if (machine.notes.some((note) => !note.text.trim())) return `${label}: complete each process note or remove the empty note.`;
    if (machine.approvedOrderConstraints.some((constraint) =>
      !constraint.beforeBendId.trim() || !constraint.afterBendId.trim() ||
      !constraint.appliesToPartFamily.trim() ||
      !machine.notes.some((note) => note.id === constraint.noteId),
    )) return `${label}: complete each bend-order constraint and link it to a process note.`;
  }

  return null;
}

function toMachinePayload(editors: MachineEditor[]): MachineInput[] {
  return editors.map((editor) => {
    const rawLength = editor.usableBendLengthMm.trim();
    let usableBendLengthMm: Machine["usableBendLengthMm"];

    if (!rawLength) {
      usableBendLengthMm = editor.initialUsableBendLengthMm === null && !editor.sourceEdited
        ? {
            value: null,
            evidence: editor.evidence,
            evidenceState: editor.evidenceState as EvidenceState,
            originalText: editor.originalText,
          }
        : { value: null, evidence: [], evidenceState: "not_found", originalText: null };
    } else {
      const value = Number(rawLength);
      const unchanged = value === editor.initialUsableBendLengthMm && !editor.sourceEdited;
      if (unchanged) {
        usableBendLengthMm = {
          value,
          evidence: editor.evidence,
          evidenceState: editor.evidenceState as EvidenceState,
          originalText: editor.originalText,
        };
      } else {
        const evidence: EvidenceRef = {
          kind: "document",
          assetId: editor.sourceAssetId.trim() as Id,
          page: Number(editor.sourcePage),
          region: null,
          excerpt: editor.sourceExcerpt.trim(),
        };
        usableBendLengthMm = {
          value,
          evidence: [evidence],
          evidenceState: editor.evidenceState as EvidenceState,
          originalText: editor.sourceExcerpt.trim(),
        };
      }
    }

    return {
      id: editor.id as Id,
      name: editor.name.trim(),
      process: editor.process.trim(),
      model: editor.model.trim() || null,
      usableBendLengthMm,
      tools: editor.tools.map((tool) => ({
        ...tool,
        name: tool.name.trim(),
        specification: tool.specification?.trim() || null,
      })),
      notes: editor.notes.map((note) => ({ id: note.id, text: note.text.trim(), source: note.source })),
      approvedOrderConstraints: editor.approvedOrderConstraints.map((constraint) => ({
        ...constraint,
        beforeBendId: constraint.beforeBendId.trim(),
        afterBendId: constraint.afterBendId.trim(),
        appliesToPartFamily: constraint.appliesToPartFamily.trim(),
      })),
    };
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The workshop request failed.";
}

function uniqueLatestSnapshots(snapshots: WorkshopSnapshot[]): WorkshopSnapshot[] {
  const latest = new Map<string, WorkshopSnapshot>();
  for (const snapshot of snapshots) {
    const previous = latest.get(snapshot.workshopId);
    if (!previous || previous.version < snapshot.version) latest.set(snapshot.workshopId, snapshot);
  }
  return [...latest.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function evidenceLabel(state: EvidenceState): string {
  switch (state) {
    case "supported": return "Supported by source";
    case "conflict": return "Source conflict";
    case "unreadable": return "Source unreadable";
    case "not_found": return "Not found in source";
  }
}

function snapshotIsConfirmed(snapshot: WorkshopSnapshot): boolean {
  return snapshot.confirmedBy !== null && snapshot.confirmedAt !== null;
}

function updateMachine(
  editors: MachineEditor[],
  clientKey: string,
  update: (editor: MachineEditor) => MachineEditor,
): MachineEditor[] {
  return editors.map((editor) => editor.clientKey === clientKey ? update(editor) : editor);
}

function MachineEditorForm({
  machine,
  index,
  onChange,
  onRemove,
  canRemove,
  disabled = false,
}: {
  machine: MachineEditor;
  index: number;
  onChange: (next: MachineEditor) => void;
  onRemove: () => void;
  canRemove: boolean;
  disabled?: boolean;
}) {
  const prefix = `machine-${machine.clientKey}`;
  const machineName = `Machine ${index + 1}`;
  const update = (partial: Partial<MachineEditor>) => onChange({ ...machine, ...partial });
  const initialLengthText = machine.initialUsableBendLengthMm === null ? "" : String(machine.initialUsableBendLengthMm);

  const updateLength = (value: string) => {
    const matchesOriginal = value === initialLengthText;
    if (matchesOriginal) {
      const originalDocument = machine.evidence.find((item) => item.kind === "document");
      onChange({
        ...machine,
        usableBendLengthMm: value,
        evidenceState: machine.evidenceState || "not_found",
        sourceAssetId: originalDocument?.kind === "document" ? originalDocument.assetId : "",
        sourcePage: originalDocument?.kind === "document" ? String(originalDocument.page) : "",
        sourceExcerpt: originalDocument?.kind === "document" ? originalDocument.excerpt : "",
        sourceEdited: false,
      });
    } else {
      onChange({
        ...machine,
        usableBendLengthMm: value,
        evidence: [],
        evidenceState: "",
        originalText: null,
        sourceAssetId: "",
        sourcePage: "",
        sourceExcerpt: "",
        sourceEdited: false,
      });
    }
  };

  const sourceChange = (partial: Pick<MachineEditor, "sourceAssetId" | "sourcePage" | "sourceExcerpt">) => {
    onChange({ ...machine, ...partial, sourceEdited: true });
  };

  const handleConstraintNoteChange = (constraintIndex: number, noteId: string) => {
    update({
      approvedOrderConstraints: machine.approvedOrderConstraints.map((constraint, currentIndex) =>
        currentIndex === constraintIndex ? { ...constraint, noteId: noteId as Id } : constraint,
      ),
    });
  };

  return (
    <fieldset className={styles.machine} disabled={disabled}>
      <legend>{machineName}</legend>
      <div className={styles.machineHeader}>
        <p className={styles.machineIntro}>Record only known setup details. Leave bend length blank when it is unknown.</p>
        {canRemove ? <Button tone="quiet" small type="button" onClick={onRemove}>Remove machine</Button> : null}
      </div>

      <div className={styles.fields}>
        <TextInput
          id={`${prefix}-name`}
          label={`${machineName} name`}
          value={machine.name}
          onChange={(event) => update({ name: event.target.value })}
          autoComplete="off"
          required
        />
        <TextInput
          id={`${prefix}-process`}
          label={`${machineName} process`}
          hint="For example, press brake or folding machine."
          value={machine.process}
          onChange={(event) => update({ process: event.target.value })}
          autoComplete="off"
          required
        />
        <TextInput
          id={`${prefix}-model`}
          label={`${machineName} model`}
          value={machine.model}
          onChange={(event) => update({ model: event.target.value })}
          autoComplete="off"
        />
        <div className={styles.sourcedField}>
          <TextInput
            id={`${prefix}-length`}
            label={`${machineName} usable bend length (mm)`}
            type="number"
            min="0"
            step="any"
            value={machine.usableBendLengthMm}
            onChange={(event) => updateLength(event.target.value)}
            hint="Leave blank to store an explicit unknown value."
          />
          {machine.usableBendLengthMm ? (
            <div className={styles.evidenceState}>
              <label htmlFor={`${prefix}-evidence-state`}>Evidence state</label>
              <select
                id={`${prefix}-evidence-state`}
                value={machine.evidenceState}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => update({ evidenceState: event.target.value as EvidenceState | "" })}
                required
              >
                <option value="">Choose source status</option>
                <option value="supported">Supported by source</option>
                <option value="conflict">Source conflict</option>
                <option value="not_found">Not found in source</option>
                <option value="unreadable">Source unreadable</option>
              </select>
              {machine.evidence.length > 0 && !machine.sourceEdited ? (
                <p className={styles.sourceSummary}>
                  Saved source reference{machine.evidence.length === 1 ? "" : "s"}: {machine.evidence.length}.
                </p>
              ) : null}
            </div>
          ) : (
            <p className={styles.unknownValue}>
              <StatusBadge label={`Unknown · ${evidenceLabel(machine.evidenceState as EvidenceState).toLowerCase()}`} tone="review" />
            </p>
          )}
        </div>
      </div>

      {machine.usableBendLengthMm ? (
        <div className={styles.sourceDetails}>
          <p className={styles.sectionHint}>A numeric length needs a real source citation. The server validates the referenced asset when saving.</p>
          <div className={styles.fields}>
            <TextInput
              id={`${prefix}-source-asset`}
              label={`${machineName} source document asset ID`}
              value={machine.sourceAssetId}
              onChange={(event) => sourceChange({ sourceAssetId: event.target.value, sourcePage: machine.sourcePage, sourceExcerpt: machine.sourceExcerpt })}
              autoComplete="off"
              required
            />
            <TextInput
              id={`${prefix}-source-page`}
              label={`${machineName} source page`}
              type="number"
              min="1"
              step="1"
              value={machine.sourcePage}
              onChange={(event) => sourceChange({ sourceAssetId: machine.sourceAssetId, sourcePage: event.target.value, sourceExcerpt: machine.sourceExcerpt })}
              required
            />
          </div>
          <Field id={`${prefix}-source-excerpt`} label={`${machineName} source excerpt`}>
            <textarea
              id={`${prefix}-source-excerpt`}
              className={styles.textarea}
              value={machine.sourceExcerpt}
              onChange={(event) => sourceChange({ sourceAssetId: machine.sourceAssetId, sourcePage: machine.sourcePage, sourceExcerpt: event.target.value })}
              rows={2}
              required
            />
          </Field>
        </div>
      ) : null}

      <section className={styles.subsection} aria-label={`${machineName} tooling`}>
        <div className={styles.subsectionHeader}>
          <div><h3>Tooling</h3><p>Add each tool and its specification for this machine.</p></div>
          <Button tone="secondary" small type="button" onClick={() => update({
            tools: [...machine.tools, { id: createId(), name: "", specification: null, evidence: [] }],
          })}>Add tool</Button>
        </div>
        {machine.tools.length === 0 ? <p className={styles.emptyInline}>No tools recorded.</p> : null}
        <div className={styles.rowList}>
          {machine.tools.map((tool, toolIndex) => (
            <div className={styles.rowCard} key={tool.id}>
              <TextInput
                id={`${prefix}-tool-${tool.id}-name`}
                label={`${machineName} tool ${toolIndex + 1} name`}
                value={tool.name}
                onChange={(event) => update({ tools: machine.tools.map((current) => current.id === tool.id ? { ...current, name: event.target.value, evidence: [] } : current) })}
                autoComplete="off"
              />
              <TextInput
                id={`${prefix}-tool-${tool.id}-spec`}
                label={`${machineName} tool ${toolIndex + 1} specification`}
                value={tool.specification ?? ""}
                onChange={(event) => update({ tools: machine.tools.map((current) => current.id === tool.id ? { ...current, specification: event.target.value || null, evidence: [] } : current) })}
                autoComplete="off"
              />
              <Button tone="quiet" small type="button" onClick={() => update({ tools: machine.tools.filter((current) => current.id !== tool.id) })}>Remove tool</Button>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.subsection} aria-label={`${machineName} process notes`}>
        <div className={styles.subsectionHeader}>
          <div><h3>Process notes</h3><p>New or edited notes remain unconfirmed until the server confirms the profile.</p></div>
          <Button tone="secondary" small type="button" onClick={() => update({
            notes: [...machine.notes, { id: createId(), text: "", authorId: null, createdAt: null, source: null, confirmedBy: null }],
          })}>Add note</Button>
        </div>
        {machine.notes.length === 0 ? <p className={styles.emptyInline}>No process notes recorded.</p> : null}
        <div className={styles.rowList}>
          {machine.notes.map((note, noteIndex) => (
            <div className={styles.noteRow} key={note.id}>
              <Field id={`${prefix}-note-${note.id}`} label={`${machineName} process note ${noteIndex + 1}`} hint={note.confirmedBy ? "Confirmed in the saved profile." : "Not confirmed."}>
                <textarea
                  id={`${prefix}-note-${note.id}`}
                  className={styles.textarea}
                  value={note.text}
                  onChange={(event) => update({ notes: machine.notes.map((current) => current.id === note.id ? { ...current, text: event.target.value, confirmedBy: event.target.value === current.text ? current.confirmedBy : null } : current) })}
                  rows={2}
                />
              </Field>
              <Button tone="quiet" small type="button" onClick={() => update({
                notes: machine.notes.filter((current) => current.id !== note.id),
                approvedOrderConstraints: machine.approvedOrderConstraints.filter((constraint) => constraint.noteId !== note.id),
              })}>Remove note</Button>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.subsection} aria-label={`${machineName} bend order constraints`}>
        <div className={styles.subsectionHeader}>
          <div><h3>Bend-order constraints</h3><p>Each constraint must point to a note above; confirmation stays server-owned.</p></div>
          <Button
            tone="secondary"
            small
            type="button"
            disabled={machine.notes.length === 0}
            onClick={() => update({
              approvedOrderConstraints: [...machine.approvedOrderConstraints, {
                beforeBendId: "",
                afterBendId: "",
                appliesToPartFamily: "",
                noteId: machine.notes[0]?.id ?? "",
              }],
            })}
          >Add constraint</Button>
        </div>
        {machine.approvedOrderConstraints.length === 0 ? <p className={styles.emptyInline}>No bend-order constraints recorded.</p> : null}
        <div className={styles.rowList}>
          {machine.approvedOrderConstraints.map((constraint, constraintIndex) => (
            <div className={styles.constraintCard} key={`${constraint.noteId}-${constraintIndex}`}>
              <TextInput
                id={`${prefix}-constraint-${constraintIndex}-before`}
                label="Bend that comes first"
                value={constraint.beforeBendId}
                onChange={(event) => update({ approvedOrderConstraints: machine.approvedOrderConstraints.map((item, index) => index === constraintIndex ? { ...item, beforeBendId: event.target.value } : item) })}
                autoComplete="off"
              />
              <TextInput
                id={`${prefix}-constraint-${constraintIndex}-after`}
                label="Bend that follows"
                value={constraint.afterBendId}
                onChange={(event) => update({ approvedOrderConstraints: machine.approvedOrderConstraints.map((item, index) => index === constraintIndex ? { ...item, afterBendId: event.target.value } : item) })}
                autoComplete="off"
              />
              <TextInput
                id={`${prefix}-constraint-${constraintIndex}-family`}
                label="Part family this applies to"
                value={constraint.appliesToPartFamily}
                onChange={(event) => update({ approvedOrderConstraints: machine.approvedOrderConstraints.map((item, index) => index === constraintIndex ? { ...item, appliesToPartFamily: event.target.value } : item) })}
                autoComplete="off"
              />
              <div className={styles.evidenceState}>
                <label htmlFor={`${prefix}-constraint-${constraintIndex}-note`}>Supporting note</label>
                <select
                  id={`${prefix}-constraint-${constraintIndex}-note`}
                  value={constraint.noteId}
                  onChange={(event) => handleConstraintNoteChange(constraintIndex, event.target.value)}
                >
                  {machine.notes.map((note, noteIndex) => <option key={note.id} value={note.id}>Note {noteIndex + 1}: {note.text.slice(0, 48) || "Blank note"}</option>)}
                </select>
              </div>
              <Button tone="quiet" small type="button" onClick={() => update({
                approvedOrderConstraints: machine.approvedOrderConstraints.filter((_, index) => index !== constraintIndex),
              })}>Remove constraint</Button>
            </div>
          ))}
        </div>
      </section>
    </fieldset>
  );
}

export function WorkshopsManager({ workspaceId, role }: WorkshopsManagerProps) {
  const [snapshots, setSnapshots] = useState<WorkshopSnapshot[]>([]);
  const [selectedWorkshopId, setSelectedWorkshopId] = useState<Id | null>(null);
  const [editors, setEditors] = useState<MachineEditor[]>([blankMachine("new-machine-1")]);
  const [workshopName, setWorkshopName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creationBase, setCreationBase] = useState<WorkshopSnapshot | null>(null);
  const [creationKey, setCreationKey] = useState<Id | null>(null);
  const [creationVersionKey, setCreationVersionKey] = useState<Id | null>(null);
  const [saveAttempt, setSaveAttempt] = useState<{ fingerprint: string; key: Id } | null>(null);

  const selectedSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.workshopId === selectedWorkshopId) ?? null,
    [selectedWorkshopId, snapshots],
  );

  useEffect(() => {
    let current = true;
    api.workshops.list({ workspaceId }).then((result) => {
        if (!current) return;
        const latest = uniqueLatestSnapshots(result);
        setSnapshots(latest);
        const first = latest[0] ?? null;
        setSelectedWorkshopId(first?.workshopId ?? null);
        if (first) {
          setWorkshopName(first.name);
          setEditors(first.machines.map(fromMachine));
          setEditorDirty(false);
        } else {
          setCreating(true);
        }
      })
      .catch((requestError: unknown) => {
        if (current) setError(errorMessage(requestError));
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId]);

  const openSnapshot = useCallback((snapshot: WorkshopSnapshot) => {
    setSelectedWorkshopId(snapshot.workshopId);
    setWorkshopName(snapshot.name);
    setEditors(snapshot.machines.map(fromMachine));
    setEditorDirty(false);
    setCreating(false);
    setNotice(null);
    setError(null);
    setSaveAttempt(null);
  }, []);

  const replaceWorkshopSnapshot = useCallback((snapshot: WorkshopSnapshot) => {
    setSnapshots((current) => uniqueLatestSnapshots([
      ...current.filter((item) => item.workshopId !== snapshot.workshopId),
      snapshot,
    ]));
    openSnapshot(snapshot);
  }, [openSnapshot]);

  const updateEditor = (clientKey: string, update: (editor: MachineEditor) => MachineEditor) => {
    setEditors((current) => updateMachine(current, clientKey, update));
    setEditorDirty(true);
    setNotice(null);
  };

  const updateCreateEditor = (clientKey: string, update: (editor: MachineEditor) => MachineEditor) => {
    setEditors((current) => updateMachine(current, clientKey, update));
    setNotice(null);
    if (creationBase) setCreationVersionKey(null);
  };

  const addMachine = () => {
    const editor = blankMachine(createId(), createId());
    setEditors((current) => [...current, editor]);
    setEditorDirty(true);
  };

  const saveInitialProfile = async () => {
    const namedEditors = ensureEditorIds(editors);
    setEditors(namedEditors);
    const validationError = firstValidationError(workshopName, namedEditors);
    if (validationError) {
      setError(validationError);
      return;
    }

    const machines = toMachinePayload(namedEditors);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let base = creationBase;
      if (!base) {
        const idempotencyKey = creationKey ?? createId();
        if (!creationKey) setCreationKey(idempotencyKey);
        base = await api.workshops.create({ workspaceId, name: workshopName.trim(), idempotencyKey });
        setCreationBase(base);
        setSnapshots((current) => uniqueLatestSnapshots([...current, base as WorkshopSnapshot]));
      }

      const idempotencyKey = creationVersionKey ?? createId();
      if (!creationVersionKey) setCreationVersionKey(idempotencyKey);
      const snapshot = await api.workshops.saveVersion({
        workshopId: base.workshopId,
        expectedVersion: base.version,
        name: workshopName.trim(),
        machines,
        idempotencyKey,
      });
      replaceWorkshopSnapshot(snapshot);
      setCreationBase(null);
      setCreationKey(null);
      setCreationVersionKey(null);
      setEditors([]);
      setWorkshopName("");
      setNotice(`Version ${snapshot.version} saved with ${snapshot.machines.length} machine${snapshot.machines.length === 1 ? "" : "s"}.`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const saveVersion = async () => {
    if (!selectedSnapshot) return;
    const namedEditors = ensureEditorIds(editors);
    setEditors(namedEditors);
    const validationError = firstValidationError(workshopName, namedEditors);
    if (validationError) {
      setError(validationError);
      return;
    }

    const machines = toMachinePayload(namedEditors);
    const fingerprint = JSON.stringify({ name: workshopName.trim(), machines });
    const idempotencyKey = saveAttempt?.fingerprint === fingerprint ? saveAttempt.key : createId();
    setSaveAttempt({ fingerprint, key: idempotencyKey });
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const snapshot = await api.workshops.saveVersion({
        workshopId: selectedSnapshot.workshopId,
        expectedVersion: selectedSnapshot.version,
        name: workshopName.trim(),
        machines,
        idempotencyKey,
      });
      replaceWorkshopSnapshot(snapshot);
      setNotice(`Version ${snapshot.version} saved.`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const confirmVersion = async () => {
    if (!selectedSnapshot) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const confirmed = await api.workshops.confirm({
        workshopId: selectedSnapshot.workshopId,
        snapshotId: selectedSnapshot.id,
      });
      replaceWorkshopSnapshot(confirmed);
      setNotice(`Version ${confirmed.version} confirmed by the server.`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const addCreateMachine = () => {
    setEditors((current) => [...current, blankMachine(createId())]);
    if (creationBase) setCreationVersionKey(null);
  };
  const canManage = role === "fabricator";
  const showingCreateForm = canManage && (creating || !selectedSnapshot);

  return (
    <div className={styles.manager}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Manufacturer workspace</p>
          <h1>Manufacturers</h1>
          <p className={styles.lede}>Record the equipment and process facts a manufacturer confirms. Each change creates a version that engineering can use as evidence.</p>
          {role === "admin" ? <p className={styles.accessLine}>Need someone at the facility to join? <Link href={`/studio/invites?workspace=${encodeURIComponent(workspaceId)}`}>Create an access link</Link> for their verified email. You send the link yourself.</p> : null}
        </div>
        {canManage && !showingCreateForm ? <Button type="button" tone="secondary" disabled={busy || editorDirty} onClick={() => {
          setCreating(true);
          setError(null);
          setNotice(null);
          setEditorDirty(false);
          setWorkshopName("");
          setEditors([blankMachine("new-machine-1")]);
          setCreationBase(null);
          setCreationKey(null);
          setCreationVersionKey(null);
        }}>New manufacturer</Button> : null}
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      <div className={styles.layout}>
        {snapshots.length > 0 ? (
          <aside className={styles.sidebar} aria-label="Workshop profiles">
            <h2>Facilities</h2>
            <ul className={styles.profileList}>
              {snapshots.map((snapshot) => (
                <li key={snapshot.workshopId}>
                  <button
                    className={`${styles.profileButton} ${!creating && snapshot.workshopId === selectedWorkshopId ? styles.profileButtonActive : ""}`}
                    type="button"
                    aria-current={!creating && snapshot.workshopId === selectedWorkshopId ? "page" : undefined}
                    disabled={busy || Boolean(creationBase) || (editorDirty && snapshot.workshopId !== selectedWorkshopId)}
                    onClick={() => {
                      openSnapshot(snapshot);
                    }}
                  >
                    <span>{snapshot.name}</span>
                    <small>Version {snapshot.version} · {snapshot.machines.length} machine{snapshot.machines.length === 1 ? "" : "s"}</small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        <main className={styles.main}>
          {loading ? <p className={styles.loading} role="status">Loading workshop profiles…</p> : null}
          {!loading && showingCreateForm ? (
            <Panel title={creationBase ? "Finish first profile version" : "Create a workshop profile"} eyebrow="New profile">
              <PanelBody>
                {creationBase ? (
                  <p className={styles.partialCreate} role="status">
                    Profile created. Its first machine version still needs to save. Your entered values are preserved below.
                  </p>
                ) : (
                  <p className={styles.sectionHint}>Start with one machine, then add the rest of the workshop setup before saving its first version.</p>
                )}
                <TextInput
                  id="new-workshop-name"
                  label="Workshop name"
                  value={workshopName}
                  onChange={(event) => {
                    setWorkshopName(event.target.value);
                    setNotice(null);
                    if (creationBase) setCreationVersionKey(null);
                  }}
                  autoComplete="off"
                  disabled={busy}
                  required
                />
                <div className={styles.machineList}>
                  {editors.map((machine, index) => (
                    <MachineEditorForm
                      key={machine.clientKey}
                      machine={machine}
                      index={index}
                      canRemove={editors.length > 1}
                      onChange={(next) => updateCreateEditor(machine.clientKey, () => next)}
                      onRemove={() => {
                        setEditors((current) => current.filter((item) => item.clientKey !== machine.clientKey));
                        if (creationBase) setCreationVersionKey(null);
                      }}
                      disabled={busy}
                    />
                  ))}
                </div>
                <div className={styles.formActions}>
                    <Button tone="secondary" type="button" disabled={busy} onClick={addCreateMachine}>Add another machine</Button>
                  <Button type="button" disabled={busy} onClick={saveInitialProfile}>
                    {busy ? "Saving…" : creationBase ? "Save first version" : "Create profile with first version"}
                  </Button>
                </div>
              </PanelBody>
            </Panel>
          ) : null}

          {!loading && !showingCreateForm && selectedSnapshot ? (
            <>
              <Panel title={selectedSnapshot.name} eyebrow="Current immutable version" action={
                <div className={styles.snapshotStatus}>
                  <StatusBadge label={`Version ${selectedSnapshot.version}`} tone="info" />
                  <StatusBadge
                    label={snapshotIsConfirmed(selectedSnapshot) ? "Confirmed" : "Needs confirmation"}
                    tone={snapshotIsConfirmed(selectedSnapshot) ? "complete" : "review"}
                  />
                </div>
              }>
                <PanelBody>
                  <p className={styles.sectionHint}>{canManage ? "Saving edits creates a new version. The displayed confirmation is taken from the server response for this version." : "This profile is read only for your workspace role. A manufacturer member records and confirms equipment facts."}</p>
                  <TextInput
                    id="workshop-name"
                    label="Workshop name"
                    value={workshopName}
                    onChange={(event) => {
                      setWorkshopName(event.target.value);
                      setEditorDirty(true);
                    }}
                    autoComplete="off"
                    required
                    disabled={busy || !canManage}
                  />
                  {editorDirty ? <p className={styles.sectionHint}>Unsaved edits belong to this draft version. Save them before confirming.</p> : null}
                  <p className={styles.countLine}>{selectedSnapshot.machines.length} machine{selectedSnapshot.machines.length === 1 ? "" : "s"} in saved version {selectedSnapshot.version}</p>
                  <div className={styles.machineList}>
                    {editors.map((machine, index) => (
                      <MachineEditorForm
                        key={machine.clientKey}
                        machine={machine}
                        index={index}
                        canRemove={editors.length > 1}
                        onChange={(next) => updateEditor(machine.clientKey, () => next)}
                        onRemove={() => {
                          setEditors((current) => current.filter((item) => item.clientKey !== machine.clientKey));
                          setEditorDirty(true);
                        }}
                        disabled={busy || !canManage}
                      />
                    ))}
                  </div>
                  {canManage ? <div className={styles.formActions}>
                    <Button tone="secondary" type="button" disabled={busy} onClick={addMachine}>Add another machine</Button>
                    <div className={styles.formActionsEnd}>
                      {!snapshotIsConfirmed(selectedSnapshot) ? (
                      <Button tone="secondary" type="button" disabled={busy || editorDirty} onClick={confirmVersion}>Confirm this version</Button>
                      ) : null}
                      <Button type="button" disabled={busy} onClick={saveVersion}>{busy ? "Saving…" : "Save new version"}</Button>
                    </div>
                  </div> : null}
                </PanelBody>
              </Panel>
            </>
          ) : null}

          {!loading && snapshots.length === 0 && !showingCreateForm ? (
            <p className={styles.emptyState}>No manufacturer profile is available in this workspace. {canManage ? "Create one to record equipment and process facts." : "A manufacturer member needs to create and confirm one before this facility can be selected for a job."}</p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
