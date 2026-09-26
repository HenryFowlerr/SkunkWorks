"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { SOURCE_UPLOAD_LIMIT_BYTES, type Asset, type Id, type Job, type Role, type WorkshopSnapshot } from "@/contracts";
import { Button, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api/client";
import styles from "./jobs.module.css";

const MIB = 1024 * 1024;
const DRAWING_SET_LIMIT = 50 * MIB;
export const JOB_FILE_LIMITS = SOURCE_UPLOAD_LIMIT_BYTES;

type FileKind = keyof typeof JOB_FILE_LIMITS;
type FileSlot = {
  file: File | null;
  asset: Asset | null;
  idempotencyKey: string | null;
  progress: number | null;
  state: "empty" | "selected" | "uploading" | "ready" | "error";
  error: string | null;
};
type IntakeFiles = Record<FileKind, FileSlot>;

const FILES: Array<{
  kind: FileKind;
  label: string;
  accept: string;
  extension: string;
  mimeTypes: string[];
  required: boolean;
}> = [
  { kind: "drawing_pdf", label: "Drawing PDF", accept: ".pdf,application/pdf", extension: ".pdf", mimeTypes: ["application/pdf"], required: false },
  { kind: "model_glb", label: "3D model (GLB)", accept: ".glb,model/gltf-binary,application/octet-stream", extension: ".glb", mimeTypes: ["model/gltf-binary", "application/octet-stream"], required: false },
  { kind: "model_stl", label: "3D model (STL)", accept: ".stl,model/stl,application/sla,application/octet-stream", extension: ".stl", mimeTypes: ["model/stl", "application/sla", "application/octet-stream"], required: false },
  { kind: "native_part", label: "Native SolidWorks part (SLDPRT)", accept: ".sldprt", extension: ".sldprt", mimeTypes: [], required: false },
  { kind: "native_drawing", label: "Native SolidWorks drawing (SLDDRW)", accept: ".slddrw", extension: ".slddrw", mimeTypes: [], required: false },
  { kind: "bend_manifest", label: "Authored bend manifest (JSON)", accept: ".json,application/json", extension: ".json", mimeTypes: ["application/json", "text/json"], required: false },
];

function emptyFiles(): IntakeFiles {
  return {
    drawing_pdf: { file: null, asset: null, idempotencyKey: null, progress: null, state: "empty", error: null },
    model_glb: { file: null, asset: null, idempotencyKey: null, progress: null, state: "empty", error: null },
    model_stl: { file: null, asset: null, idempotencyKey: null, progress: null, state: "empty", error: null },
    native_part: { file: null, asset: null, idempotencyKey: null, progress: null, state: "empty", error: null },
    native_drawing: { file: null, asset: null, idempotencyKey: null, progress: null, state: "empty", error: null },
    bend_manifest: { file: null, asset: null, idempotencyKey: null, progress: null, state: "empty", error: null },
  };
}

function selectedSlot(file: File, kind: FileKind): FileSlot {
  const error = validateFile(kind, file);
  return {
    file, asset: null, idempotencyKey: error ? null : freshIdempotencyKey(), progress: null,
    state: error ? "error" : "selected", error,
  };
}

function formatMiB(bytes: number) {
  return `${bytes / MIB} MiB`;
}

function formatFileSize(bytes: number) {
  return bytes >= MIB ? formatMiB(bytes) : `${bytes.toLocaleString()} bytes`;
}

function validateFile(kind: FileKind, file: File): string | null {
  const config = FILES.find((item) => item.kind === kind)!;
  if (file.size === 0) return "This file is empty.";
  if (file.size > JOB_FILE_LIMITS[kind]) return `Choose a file no larger than ${formatMiB(JOB_FILE_LIMITS[kind])}.`;
  if (!file.name.toLocaleLowerCase().endsWith(config.extension)) return `Choose a ${config.extension} file.`;
  if (config.mimeTypes.length && file.type && !config.mimeTypes.includes(file.type.toLocaleLowerCase())) {
    return `The selected file reports an unsupported type. Choose ${config.accept.split(",")[0].toUpperCase()}.`;
  }
  return null;
}

function freshIdempotencyKey() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `skw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function isVerifiedReadyAsset(asset: Asset, jobId: Id, kind: FileKind) {
  return asset.jobId === jobId && asset.kind === kind && asset.releaseId === null &&
    asset.status === "ready" && typeof asset.sha256 === "string" && /^[a-f0-9]{64}$/i.test(asset.sha256);
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function hasRequestedInputs(job: Job, expected: {
  title: string;
  partNumber: string;
  partFamily: string;
  workshopSnapshotId: string;
  machineId: string;
  sourceAssetIds: string[];
}) {
  return job.title === expected.title && job.partNumber === expected.partNumber &&
    job.partFamily === expected.partFamily && job.workshopSnapshotId === expected.workshopSnapshotId &&
    job.machineId === expected.machineId && sameStrings(job.sourceAssetIds, expected.sourceAssetIds);
}

export function NewJobIntake({
  workspaceId,
  role = "designer",
  onCreated,
}: {
  workspaceId: string;
  role?: Role;
  onCreated?: (job: Job) => void;
}) {
  const [partNumber, setPartNumber] = useState("");
  const [title, setTitle] = useState("");
  const [partFamily, setPartFamily] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [workshops, setWorkshops] = useState<WorkshopSnapshot[]>([]);
  const [workshopsLoading, setWorkshopsLoading] = useState(true);
  const [workshopsError, setWorkshopsError] = useState<string | null>(null);
  const [workshopReload, setWorkshopReload] = useState(0);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const [files, setFiles] = useState<IntakeFiles>(emptyFiles);
  const [extraDrawings, setExtraDrawings] = useState<FileSlot[]>([]);
  const [draggingKind, setDraggingKind] = useState<FileKind | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [job, setJob] = useState<Job | null>(null);
  const fileInputRefs = useRef<Record<FileKind, HTMLInputElement | null>>({
    drawing_pdf: null,
    model_glb: null,
    model_stl: null,
    bend_manifest: null,
    native_part: null,
    native_drawing: null,
  });
  const additionalDrawingsInputRef = useRef<HTMLInputElement | null>(null);
  const createKey = useRef<string | null>(null);
  const workshopsAreLoading = workshopsLoading || loadedWorkspaceId !== workspaceId;

  useEffect(() => {
    let active = true;
    void api.workshops.list({ workspaceId }).then((result) => {
      if (active) {
        setWorkshops(result);
        setLoadedWorkspaceId(workspaceId);
        setWorkshopsError(null);
      }
    }).catch((error: unknown) => {
      if (active) {
        setLoadedWorkspaceId(workspaceId);
        setWorkshops([]);
        setWorkshopsError(errorMessage(error));
      }
    }).finally(() => {
      if (active) setWorkshopsLoading(false);
    });
    return () => { active = false; };
  }, [workspaceId, workshopReload]);

  const workspaceWorkshops = workshops.filter((snapshot) => snapshot.workspaceId === workspaceId);
  const selectedSnapshot = workspaceWorkshops.find((snapshot) => snapshot.id === snapshotId) ?? null;
  const confirmedSnapshots = workspaceWorkshops.filter((snapshot) => snapshot.confirmedBy !== null && snapshot.confirmedAt !== null);
  const eligibleSnapshots = confirmedSnapshots.filter((snapshot) => snapshot.machines.length > 0);

  function clearError(name: string) {
    setFieldErrors((previous) => {
      if (!(name in previous)) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
    setFormError(null);
    setComplete(false);
  }

  function resetCreateKey() {
    if (!job) createKey.current = null;
  }

  function updateFiles(kind: FileKind, update: (current: FileSlot) => FileSlot) {
    setFiles((previous) => ({ ...previous, [kind]: update(previous[kind]) }));
    setComplete(false);
  }

  function changeFile(kind: FileKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    updateFiles(kind, () => file ? selectedSlot(file, kind) : emptyFiles()[kind]);
    if (kind === "drawing_pdf" && event.currentTarget.files && event.currentTarget.files.length > 1) {
      addDrawings(Array.from(event.currentTarget.files).slice(1));
    }
    clearError(kind);
  }

  function addDrawings(picked: File[]) {
    if (!picked.length) return;
    setExtraDrawings((previous) => [...previous, ...picked.map((file) => selectedSlot(file, "drawing_pdf"))]);
    clearError("drawing_pdf");
  }

  function handleDrop(kind: FileKind, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingKind(null);
    if (submitting) return;
    const picked = Array.from(event.dataTransfer.files);
    if (!picked.length) return;
    if (fileInputRefs.current[kind]) fileInputRefs.current[kind]!.value = "";
    updateFiles(kind, () => selectedSlot(picked[0], kind));
    if (kind === "drawing_pdf") addDrawings(picked.slice(1));
    clearError(kind);
  }

  function updateExtraDrawing(index: number, update: (current: FileSlot) => FileSlot) {
    setExtraDrawings((previous) => previous.map((slot, currentIndex) => currentIndex === index ? update(slot) : slot));
  }

  function removeOptionalFile(kind: FileKind) {
    if (fileInputRefs.current[kind]) fileInputRefs.current[kind]!.value = "";
    updateFiles(kind, () => ({ file: null, asset: null, idempotencyKey: null, progress: null, state: "empty", error: null }));
    clearError(kind);
  }

  async function validateForm(): Promise<Record<string, string>> {
    const next: Record<string, string> = {};
    if (!partNumber.trim()) next.partNumber = "Enter a part number.";
    if (!title.trim()) next.title = "Enter a job title.";
    if (!partFamily.trim()) next.partFamily = "Enter a part family.";
    if (!snapshotId) next.workshopSnapshotId = "Choose a confirmed workshop version.";
    else if (!selectedSnapshot || !selectedSnapshot.confirmedBy || !selectedSnapshot.confirmedAt) {
      next.workshopSnapshotId = "Choose a confirmed workshop version.";
    }
    if (!machineId) next.machineId = "Choose a machine from the selected workshop version.";
    else if (!selectedSnapshot?.machines.some((machine) => machine.id === machineId)) {
      next.machineId = "Choose a machine from the selected workshop version.";
    }
    if (!files.drawing_pdf.file && !files.native_drawing.file) next.drawing_pdf = "This source file is required.";
    if (!files.model_glb.file && !files.model_stl.file && !files.native_part.file) next.model_glb = "Attach a viewable GLB or STL model, or retain a native part source.";
    for (const definition of FILES) {
      const selected = files[definition.kind].file;
      if (definition.required && !selected) next[definition.kind] = "This source file is required.";
      if (selected) {
        const fileError = validateFile(definition.kind, selected);
        if (fileError) next[definition.kind] = fileError;
        if (definition.kind === "bend_manifest" && !fileError) {
          try {
            JSON.parse(await selected.text());
          } catch {
            next[definition.kind] = "The manifest must contain valid JSON.";
          }
        }
      }
    }
    for (const [index, slot] of extraDrawings.entries()) {
      if (!slot.file) continue;
      const fileError = validateFile("drawing_pdf", slot.file);
      if (fileError) next[`extra-${index}`] = fileError;
    }
    const drawingBytes = [files.drawing_pdf, ...extraDrawings].reduce((sum, slot) => sum + (slot.file?.size ?? 0), 0);
    if (drawingBytes > DRAWING_SET_LIMIT) next.drawingSet = "Drawing PDFs together must be no larger than 50 MiB for the current generation workflow.";
    return next;
  }

  function setFileError(kind: FileKind, error: string) {
    updateFiles(kind, (current) => ({ ...current, state: "error", error }));
    setFieldErrors((previous) => ({ ...previous, [kind]: error }));
  }

  async function createOrUpdateJob(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    setComplete(false);
    try {
      const errors = await validateForm();
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;

      let currentJob = job;
      if (!currentJob) {
        createKey.current ??= freshIdempotencyKey();
        currentJob = await api.jobs.create({
          workspaceId,
          partNumber: partNumber.trim(),
          title: title.trim(),
          partFamily: partFamily.trim(),
          workshopSnapshotId: snapshotId,
          machineId,
          idempotencyKey: createKey.current,
        });
        if (currentJob.workspaceId !== workspaceId || currentJob.title !== title.trim() ||
          currentJob.partNumber !== partNumber.trim() || currentJob.partFamily !== partFamily.trim() ||
          currentJob.workshopSnapshotId !== snapshotId || currentJob.machineId !== machineId) {
          throw new Error("The API returned a job that does not match this intake. Inputs were not attached.");
        }
        setJob(currentJob);
      }

      const attemptFiles: IntakeFiles = {
        drawing_pdf: { ...files.drawing_pdf },
        model_glb: { ...files.model_glb },
        model_stl: { ...files.model_stl },
        bend_manifest: { ...files.bend_manifest },
        native_part: { ...files.native_part },
        native_drawing: { ...files.native_drawing },
      };
      const attemptExtraDrawings = extraDrawings.map((slot) => ({ ...slot }));
      for (const definition of FILES) {
        const kind = definition.kind;
        const slot = attemptFiles[kind];
        if (!slot.file) {
          if (definition.required) throw new Error(`${definition.label} is required.`);
          continue;
        }
        if (slot.asset && isVerifiedReadyAsset(slot.asset, currentJob.id, kind)) continue;

        updateFiles(kind, (previous) => ({ ...previous, state: "uploading", progress: null, error: null }));
        try {
          const idempotencyKey = slot.idempotencyKey ?? freshIdempotencyKey();
          attemptFiles[kind] = { ...slot, idempotencyKey };
          updateFiles(kind, (previous) => ({ ...previous, idempotencyKey }));
          const asset = await api.assets.uploadAsset({
            jobId: currentJob.id,
            kind,
            file: slot.file,
            idempotencyKey,
            onProgress: (progress) => {
              if (!Number.isFinite(progress)) return;
              updateFiles(kind, (previous) => ({ ...previous, progress: Math.max(0, Math.min(1, progress)) }));
            },
          });
          if (!isVerifiedReadyAsset(asset, currentJob.id, kind)) {
            throw new Error("The API has not returned a ready file with a server-verified SHA-256 hash. This file is not attached.");
          }
          attemptFiles[kind] = { ...slot, asset, progress: 1, state: "ready", error: null };
          updateFiles(kind, () => attemptFiles[kind]);
        } catch (error) {
          const message = errorMessage(error);
          attemptFiles[kind] = { ...slot, asset: null, state: "error", error: message };
          setFileError(kind, message);
          throw error;
        }
      }

      for (const [index, slot] of attemptExtraDrawings.entries()) {
        if (!slot.file) continue;
        if (slot.asset && isVerifiedReadyAsset(slot.asset, currentJob.id, "drawing_pdf")) continue;
        updateExtraDrawing(index, (previous) => ({ ...previous, state: "uploading", progress: null, error: null }));
        try {
          const idempotencyKey = slot.idempotencyKey ?? freshIdempotencyKey();
          attemptExtraDrawings[index] = { ...slot, idempotencyKey };
          updateExtraDrawing(index, (previous) => ({ ...previous, idempotencyKey }));
          const asset = await api.assets.uploadAsset({
            jobId: currentJob.id, kind: "drawing_pdf", file: slot.file, idempotencyKey,
            onProgress: (progress) => {
              if (Number.isFinite(progress)) updateExtraDrawing(index, (previous) => ({ ...previous, progress: Math.max(0, Math.min(1, progress)) }));
            },
          });
          if (!isVerifiedReadyAsset(asset, currentJob.id, "drawing_pdf")) {
            throw new Error("The API has not returned a ready drawing with a server-verified SHA-256 hash.");
          }
          attemptExtraDrawings[index] = { ...slot, idempotencyKey, asset, progress: 1, state: "ready", error: null };
          updateExtraDrawing(index, () => attemptExtraDrawings[index]);
        } catch (error) {
          const message = errorMessage(error);
          attemptExtraDrawings[index] = { ...slot, state: "error", error: message };
          updateExtraDrawing(index, () => attemptExtraDrawings[index]);
          throw error;
        }
      }

      const sourceAssetIds = FILES.flatMap((definition) => {
        const asset = attemptFiles[definition.kind].asset;
        return asset && isVerifiedReadyAsset(asset, currentJob!.id, definition.kind) ? [asset.id] : [];
      }).concat(attemptExtraDrawings.flatMap((slot) => slot.asset && isVerifiedReadyAsset(slot.asset, currentJob!.id, "drawing_pdf") ? [slot.asset.id] : []));
      if ((!attemptFiles.drawing_pdf.asset && !attemptFiles.native_drawing.asset) || (!attemptFiles.model_glb.asset && !attemptFiles.model_stl.asset && !attemptFiles.native_part.asset)) {
        throw new Error("The drawing and model must both be verified by the server before the job can be saved.");
      }

      const expected = {
        title: currentJob.title,
        partNumber: currentJob.partNumber,
        partFamily: partFamily.trim(),
        workshopSnapshotId: snapshotId,
        machineId,
        sourceAssetIds,
      };
      let savedJob: Job;
      try {
        savedJob = await api.jobs.updateInputs({
          jobId: currentJob.id,
          expectedVersion: currentJob.version,
          workshopSnapshotId: snapshotId,
          machineId,
          partFamily: partFamily.trim(),
          sourceAssetIds,
        });
      } catch (updateError) {
        try {
          const freshJob = (await api.jobs.list({ workspaceId })).find((item) => item.id === currentJob!.id);
          if (freshJob && hasRequestedInputs(freshJob, expected)) {
            savedJob = freshJob;
          } else {
            if (freshJob) setJob(freshJob);
            throw updateError;
          }
        } catch (refreshError) {
          if (refreshError === updateError) throw updateError;
          throw new Error(`${errorMessage(updateError)} The save could not be verified yet: ${errorMessage(refreshError)}`);
        }
      }

      if (!hasRequestedInputs(savedJob, expected)) {
        setJob(savedJob);
        throw new Error("The server did not confirm the selected setup and verified source files. Review the saved job state before continuing.");
      }
      setJob(savedJob);
      setComplete(true);
      setFormError(null);
      onCreated?.(savedJob);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (role !== "designer") {
    return <div className={styles.stack}>
      <div className={styles.heading}><div>
        <p className={styles.eyebrow}>Workspace access</p>
        <h1>Start a job</h1>
        <p className={styles.muted}>A designer membership is needed to create a job and attach technical sources.</p>
      </div></div>
      <p className={styles.inviteLine}>{role === "admin" ? <><Link href={`/studio/invites?workspace=${encodeURIComponent(workspaceId)}`}>Create a designer or fabricator invitation link</Link> for a verified email. Chappe gives you a link to copy; you send it yourself.</> : <><Link href={`/studio/workshops?workspace=${encodeURIComponent(workspaceId)}`}>Open manufacturer setup</Link> to record and confirm a facility profile.</>}</p>
    </div>;
  }

  return (
    <div className={styles.stack}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Designer workspace</p>
          <h1>Start a job</h1>
          <p className={styles.muted}>Bring the drawing and a viewable model together, then choose the manufacturer that will receive the work.</p>
        </div>
        {job ? <StatusBadge label={complete ? "Inputs saved" : "Intake in progress"} tone={complete ? "complete" : "review"} /> : null}
      </div>

      {formError ? <div className={styles.error} role="alert">{formError}</div> : null}
      {complete ? <div className={styles.notice} role="status">The server confirmed the job setup and attached every selected file after checking its size and SHA-256 hash.</div> : null}
      {(!files.drawing_pdf.file || (!files.model_glb.file && !files.model_stl.file)) && (files.native_part.file || files.native_drawing.file) ? <div className={styles.notice} role="status">Exports needed: add a readable PDF for drawing analysis and a GLB or STL model for the phone view. Native sources remain private provenance files and are not AI drawing evidence.</div> : null}
      {job && !complete ? <div className={styles.notice} role="status">Job {job.partNumber} exists. This form has retained its details so you can finish or retry the source uploads.</div> : null}

      <div className={styles.intakeSurface}>
          <form className={styles.form} onSubmit={(event) => void createOrUpdateJob(event)} noValidate>
            <section className={styles.section} aria-labelledby="job-details-heading">
              <h2 className={styles.sectionTitle} id="job-details-heading">Part details</h2>
              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="part-number">Part number</label>
                  <input id="part-number" className={styles.control} value={partNumber} required autoComplete="off" disabled={submitting || Boolean(job)}
                    aria-invalid={Boolean(fieldErrors.partNumber)} aria-describedby={fieldErrors.partNumber ? "part-number-error" : undefined}
                    onChange={(event) => { setPartNumber(event.currentTarget.value); resetCreateKey(); clearError("partNumber"); }} />
                  {fieldErrors.partNumber ? <p className={styles.fieldError} id="part-number-error" role="alert">{fieldErrors.partNumber}</p> : null}
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="job-title">Job title</label>
                  <input id="job-title" className={styles.control} value={title} required autoComplete="off" disabled={submitting || Boolean(job)}
                    aria-invalid={Boolean(fieldErrors.title)} aria-describedby={fieldErrors.title ? "job-title-error" : undefined}
                    onChange={(event) => { setTitle(event.currentTarget.value); resetCreateKey(); clearError("title"); }} />
                  {fieldErrors.title ? <p className={styles.fieldError} id="job-title-error" role="alert">{fieldErrors.title}</p> : null}
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="part-family">Part family</label>
                  <input id="part-family" className={styles.control} value={partFamily} required autoComplete="off" disabled={submitting}
                    aria-invalid={Boolean(fieldErrors.partFamily)} aria-describedby={fieldErrors.partFamily ? "part-family-error" : "part-family-hint"}
                    onChange={(event) => { setPartFamily(event.currentTarget.value); resetCreateKey(); clearError("partFamily"); }} />
                  {fieldErrors.partFamily ? <p className={styles.fieldError} id="part-family-error" role="alert">{fieldErrors.partFamily}</p> : null}
                  <p className={styles.hint} id="part-family-hint">A short label helps match this part to the manufacturer’s documented process notes.</p>
                </div>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="workshop-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 className={styles.sectionTitle} id="workshop-heading">Manufacturer</h2>
                  <p className={styles.hint}>Select a confirmed facility profile. Its documented machine facts will be available for the job check.</p>
                </div>
              </div>
              {workshopsError ? (
                <div className={styles.error} role="alert">
                  <p>{workshopsError}</p>
                  <Button type="button" tone="secondary" small disabled={workshopsAreLoading} onClick={() => { setWorkshopsLoading(true); setWorkshopReload((value) => value + 1); }}>Retry workshop list</Button>
                </div>
              ) : null}
              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="workshop-version">Manufacturer and confirmed profile</label>
                  <select id="workshop-version" className={styles.control} value={snapshotId} required disabled={workshopsAreLoading || submitting || eligibleSnapshots.length === 0}
                    aria-invalid={Boolean(fieldErrors.workshopSnapshotId)} aria-describedby={fieldErrors.workshopSnapshotId ? "workshop-error" : "workshop-hint"}
                    onChange={(event) => { setSnapshotId(event.currentTarget.value); setMachineId(""); resetCreateKey(); clearError("workshopSnapshotId"); clearError("machineId"); }}>
                    <option value="">{workshopsAreLoading ? "Loading confirmed profiles…" : eligibleSnapshots.length ? "Select a manufacturer profile" : "No confirmed profile available"}</option>
                    {workspaceWorkshops.map((snapshot) => {
                      const available = snapshot.confirmedBy !== null && snapshot.confirmedAt !== null && snapshot.machines.length > 0;
                      return <option key={snapshot.id} value={snapshot.id} disabled={!available}>{snapshot.name} · v{snapshot.version}{available ? "" : " · not ready"}</option>;
                    })}
                  </select>
                  {fieldErrors.workshopSnapshotId ? <p className={styles.fieldError} id="workshop-error" role="alert">{fieldErrors.workshopSnapshotId}</p> : null}
                  <p className={styles.hint} id="workshop-hint">A manufacturer can edit its equipment record; a confirmed version is needed before this job is created.</p>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="workshop-machine">Machine</label>
                  <select id="workshop-machine" className={styles.control} value={machineId} required disabled={!selectedSnapshot || submitting}
                    aria-invalid={Boolean(fieldErrors.machineId)} aria-describedby={fieldErrors.machineId ? "machine-error" : undefined}
                    onChange={(event) => { setMachineId(event.currentTarget.value); resetCreateKey(); clearError("machineId"); }}>
                    <option value="">{selectedSnapshot ? "Select a machine" : "Choose a manufacturer first"}</option>
                    {selectedSnapshot?.machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name} · {machine.process}</option>)}
                  </select>
                  {fieldErrors.machineId ? <p className={styles.fieldError} id="machine-error" role="alert">{fieldErrors.machineId}</p> : null}
                </div>
              </div>
              {!workshopsAreLoading && !workshopsError && eligibleSnapshots.length === 0 ? (
                <p className={styles.notice}>No confirmed manufacturer profile is available. Add a profile, record at least one machine, and confirm it before saving this job.</p>
              ) : null}
              <p className={styles.inviteLine}>No manufacturer listed? Ask a workspace admin to invite a fabricator. That person creates and confirms the facility profile before you can select it here.</p>
            </section>

            <section className={styles.section} aria-labelledby="source-files-heading">
              <h2 className={styles.sectionTitle} id="source-files-heading">Source files</h2>
              <p className={styles.hint}>Add a readable drawing PDF and a viewable model (GLB or STL) for one part. You can also retain native SolidWorks sources privately. STL and GLB are visual references only; the AI reads the PDF and confirmed supplier evidence, never mesh geometry. An authored bend manifest is optional for the current sheet-metal generation workflow.</p>
              {fieldErrors.drawingSet ? <p className={styles.fileError} role="alert">{fieldErrors.drawingSet}</p> : null}
              <div className={styles.fileGrid}>
                {FILES.map((definition) => {
                  const slot = files[definition.kind];
                  const labelId = `file-${definition.kind}`;
                  const hintId = `${labelId}-hint`;
                  const errorId = `${labelId}-error`;
                  return (
                    <div className={`${styles.fileCard} ${draggingKind === definition.kind ? styles.fileCardDragging : ""}`} key={definition.kind}
                      onDragOver={(event) => { event.preventDefault(); if (!submitting) setDraggingKind(definition.kind); }}
                      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingKind(null); }}
                      onDrop={(event) => handleDrop(definition.kind, event)}>
                      <div className={styles.fileHead}>
                        <label htmlFor={labelId}>{definition.kind === "model_glb" ? "3D model (GLB CAD export)" : definition.kind === "model_stl" ? "3D model (STL visual reference)" : definition.kind === "drawing_pdf" ? "Technical drawing PDFs" : definition.label} {definition.required ? <span aria-hidden="true">*</span> : <span className={styles.optional}>Optional</span>}</label>
                        <span className={styles.dropHint}>Drop here or choose a file</span>
                      </div>
                      <input id={labelId} className={styles.fileInput} type="file" accept={definition.accept} required={definition.required} multiple={definition.kind === "drawing_pdf"}
                        ref={(element) => { fileInputRefs.current[definition.kind] = element; }}
                        disabled={submitting} aria-describedby={`${hintId}${fieldErrors[definition.kind] || slot.error ? ` ${errorId}` : ""}`}
                        aria-invalid={Boolean(fieldErrors[definition.kind] || slot.error)} onChange={(event) => changeFile(definition.kind, event)} />
                      <p className={styles.hint} id={hintId}>Accepted: {definition.accept.split(",").filter((type) => type.startsWith(".")).join(", ")} · up to {formatMiB(JOB_FILE_LIMITS[definition.kind])} per file</p>
                      {slot.file ? <p className={styles.fileName}>{slot.file.name} · {formatFileSize(slot.file.size)}</p> : null}
                      {slot.state === "uploading" ? (
                        <div className={styles.fileStatus} aria-live="polite">
                          <progress className={styles.progress} max={1} value={slot.progress ?? undefined} aria-label={`Upload progress for ${definition.label}`} />
                          <span>{slot.progress === null ? "Sending file… transfer progress is not available here." : slot.progress >= 1 ? "Bytes sent · verifying file with server…" : `Sending · ${Math.round(slot.progress * 100)}%`}</span>
                        </div>
                      ) : null}
                      {slot.state === "ready" && slot.asset?.sha256 ? (
                        <div className={`${styles.fileStatus} ${styles.fileReady}`} role="status">
                          <StatusBadge label={definition.kind.startsWith("native_") ? "Source retained" : "Server verified"} tone="complete" />
                          <span>Ready · SHA-256 {slot.asset.sha256.slice(0, 12)}…</span>
                        </div>
                      ) : null}
                      {(slot.error || fieldErrors[definition.kind]) ? (
                        <p className={styles.fileError} id={errorId}
                          role={slot.error && slot.error === formError ? undefined : "alert"}>
                          {slot.error || fieldErrors[definition.kind]}
                        </p>
                      ) : null}
                      {!definition.required && slot.file ? (
                        <Button type="button" tone="quiet" small disabled={submitting} onClick={() => removeOptionalFile(definition.kind)}>
                          Remove {definition.label}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {extraDrawings.length ? <ul className={styles.extraDrawings} aria-label="Additional drawings">{extraDrawings.map((slot, index) => (
                <li key={slot.idempotencyKey ?? `${slot.file?.name}-${index}`}>
                  <div><strong>{slot.file?.name}</strong><span>Additional PDF · {slot.file ? formatFileSize(slot.file.size) : ""}</span></div>
                  {slot.state === "ready" ? <StatusBadge label="Server verified" tone="complete" /> : null}
                  {slot.state === "uploading" ? <span role="status">{slot.progress === null ? "Uploading…" : `Uploading ${Math.round(slot.progress * 100)}%`}</span> : null}
                  {slot.error || fieldErrors[`extra-${index}`] ? <span className={styles.fileError} role="alert">{slot.error ?? fieldErrors[`extra-${index}`]}</span> : null}
                  <Button type="button" tone="quiet" small disabled={submitting} onClick={() => setExtraDrawings((previous) => previous.filter((_, currentIndex) => currentIndex !== index))}>Remove</Button>
                </li>
              ))}</ul> : null}
              <Button type="button" tone="quiet" className={styles.addDrawingButton} disabled={submitting} onClick={() => additionalDrawingsInputRef.current?.click()}>+ Add more drawing PDFs</Button>
              <input id="additional-drawings" ref={additionalDrawingsInputRef} className={styles.screenReaderOnly} type="file" accept=".pdf,application/pdf" multiple disabled={submitting}
                onChange={(event) => { addDrawings(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
              <p className={styles.hint}>PDFs may total up to 50 MiB for the current generation workflow. Files remain selected if an upload needs retrying.</p>
            </section>

            <div className={styles.buttonRow}>
              <Button type="submit" disabled={submitting || workshopsAreLoading || Boolean(workshopsError) || eligibleSnapshots.length === 0}>
                {submitting ? "Saving and verifying…" : job ? "Retry uploads and save intake" : "Create job and upload sources"}
              </Button>
              {job ? <p className={styles.muted}>Created job {job.partNumber} · server record v{job.version}</p> : null}
            </div>
          </form>
      </div>
    </div>
  );
}
