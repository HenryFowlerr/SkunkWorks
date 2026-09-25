'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { IdSchema } from '@/contracts';
import type { Asset, Bend, Draft, EvidenceRef, Finding, Flag, Generation, Id, Release, Role, Step } from '@/contracts';
import { Button, Field, Panel, PanelBody, SourceReference, StatusBadge } from '@/components/ui';
import { ApiClientError, api } from '@/lib/api/client';
import type { ApiClient } from '@/lib/api/client';
import { BendMapEditor, BendScene, ModelViewer } from '@/features/visualization';
import type { SceneData } from '@/features/visualization';
import { BendFactEditor } from './components/bend-fact-editor';
import { evidenceAssetId, getPublishBlockers, toDraftContentInput } from './review.logic';
import styles from './review.module.css';

type ReviewApi = Pick<ApiClient, 'assets' | 'drafts' | 'flags' | 'generations' | 'jobs' | 'releases'>;
type JobLoad = Awaited<ReturnType<ApiClient['jobs']['get']>>;
const NO_ASSETS: Asset[] = [];

export type JobReviewDeskProps = {
  jobId: string;
  role: Role;
  /** Injectable at the same contract boundary for focused UI verification. */
  client?: ReviewApi;
};

function explainError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ENDPOINT_UNAVAILABLE') {
    return 'This service endpoint is not available in the current build. Nothing was recorded.';
  }
  return error instanceof Error ? error.message : 'The request could not be completed. Nothing was recorded.';
}

function makeIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `skunkworks-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function generationSessionKey(jobId: string) {
  return `skunkworks:generation:${jobId}`;
}

function getStoredGenerationId(jobId: string): Id | null {
  try {
    if (typeof window === 'undefined') return null;
    const parsed = IdSchema.safeParse(window.sessionStorage.getItem(generationSessionKey(jobId)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function storeGenerationId(jobId: string, generationId: Id | null) {
  try {
    if (typeof window === 'undefined') return;
    if (generationId) window.sessionStorage.setItem(generationSessionKey(jobId), generationId);
    else window.sessionStorage.removeItem(generationSessionKey(jobId));
  } catch {
    // The operation remains server-owned; storage only preserves its lookup ID across a page refresh.
  }
}

function evidenceForDraft(draft: Draft): EvidenceRef[] {
  const evidence: EvidenceRef[] = [];
  for (const bend of draft.content.bends) {
    evidence.push(...bend.finishedAngle.evidence, ...bend.foldRotationDeg.evidence, ...bend.insideRadiusMm.evidence, ...bend.directionText.evidence);
  }
  for (const step of draft.content.steps) evidence.push(...step.evidence);
  for (const finding of draft.content.findings) evidence.push(...finding.evidence);
  for (const proposal of draft.content.machineProposals) evidence.push(...proposal.evidence);
  return evidence;
}

function sourceLabel(evidence: EvidenceRef, assets: Asset[]): { label: string; detail: string } {
  if (evidence.kind === 'document') {
    const asset = assets.find((assetItem) => assetItem.id === evidence.assetId);
    return {
      label: asset?.filename ?? 'Source document',
      detail: `Page ${evidence.page}${evidence.excerpt ? ` · “${evidence.excerpt}”` : ''}`,
    };
  }
  if (evidence.kind === 'workshop_note') return { label: 'Confirmed workshop note', detail: `Machine ${evidence.machineId} · note ${evidence.noteId}` };
  return { label: 'Recorded human clarification', detail: `Record ${evidence.recordId}` };
}

function EvidenceList({ evidence, assets, links }: { evidence: EvidenceRef[]; assets: Asset[]; links: Record<string, string> }) {
  if (evidence.length === 0) return <span className={styles.subtle}>No evidence attached.</span>;
  return (
    <ul className={styles.evidenceList}>
      {evidence.map((item, index) => {
        const source = sourceLabel(item, assets);
        const assetId = evidenceAssetId(item);
        const href = assetId ? links[assetId] : undefined;
        return <li key={`${item.kind}-${index}`}><SourceReference label={source.label} detail={source.detail} href={href} /></li>;
      })}
    </ul>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not provided';
  if (typeof value === 'object' && value !== null && 'degrees' in value) {
    const angle = value as { degrees: number; convention: string };
    return `${angle.degrees}° · ${angle.convention.replaceAll('_', ' ')}`;
  }
  if (typeof value === 'number') return `${value} mm`;
  return String(value);
}

function SourcedValue({ label, value, evidenceState, originalText, evidence, assets, links }: {
  label: string;
  value: unknown;
  evidenceState: string;
  originalText: string | null;
  evidence: EvidenceRef[];
  assets: Asset[];
  links: Record<string, string>;
}) {
  return (
    <div className={styles.sourcedValue}>
      <div className={styles.valueHeader}>
        <strong>{label}</strong>
        <StatusBadge label={evidenceState.replaceAll('_', ' ')} tone={evidenceState === 'supported' ? 'complete' : evidenceState === 'conflict' ? 'blocked' : 'review'} />
      </div>
      <p className={styles.value}>{renderValue(value)}</p>
      {originalText ? <p className={styles.originalText}>Source text: “{originalText}”</p> : null}
      <EvidenceList evidence={evidence} assets={assets} links={links} />
    </div>
  );
}

function FindingCard({
  finding,
  assets,
  links,
  clarification,
  savedRecord,
  busy,
  onTextChange,
  onResolve,
}: {
  finding: Finding;
  assets: Asset[];
  links: Record<string, string>;
  clarification: string;
  savedRecord: boolean;
  busy: boolean;
  onTextChange: (value: string) => void;
  onResolve: () => void;
}) {
  return (
    <article className={styles.findingCard}>
      <header className={styles.findingHeader}>
        <div>
          <p className={styles.eyebrow}>{finding.kind.replaceAll('_', ' ')}{finding.bendId ? ` · Bend ${finding.bendId}` : ''}</p>
          <h3>{finding.message}</h3>
        </div>
        <StatusBadge label={finding.disposition === 'resolved' ? 'Resolved' : finding.severity} tone={finding.disposition === 'resolved' ? 'complete' : finding.severity === 'blocking' ? 'blocked' : 'review'} />
      </header>
      <EvidenceList evidence={finding.evidence} assets={assets} links={links} />
      {finding.disposition === 'open' ? (
        <div className={styles.findingAction}>
          {savedRecord ? <p className={styles.success}>Clarification recorded. Resolve this finding to attach it.</p> : null}
          <Field id={`clarification-${finding.id}`} label="Clarification or disposition note">
            <textarea className="field__control" value={clarification} onChange={(event) => onTextChange(event.target.value)} rows={3} placeholder="Record what was confirmed or changed…" />
          </Field>
          <Button type="button" tone="secondary" small disabled={busy || (!savedRecord && !clarification.trim())} onClick={onResolve}>
            {busy ? 'Recording…' : savedRecord ? 'Resolve with recorded clarification' : 'Record clarification and resolve'}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

type FlagResponseDraft = { text: string; kind: 'explanation' | 'replacement_release'; replacementReleaseId: string };
const emptyFlagResponse: FlagResponseDraft = { text: '', kind: 'explanation', replacementReleaseId: '' };

function FlagResponseCard({ flag, jobId, releases, busy, value, error, onChange, onRespond }: {
  flag: Flag;
  jobId: string;
  releases: Release[];
  busy: boolean;
  value: FlagResponseDraft;
  error: string | null;
  onChange: (next: FlagResponseDraft) => void;
  onRespond: () => void;
}) {
  const release = releases.find((item) => item.id === flag.context.releaseId && item.jobId === jobId);
  const validReplacementReleases = releases.filter((item) => item.jobId === jobId && item.id !== flag.context.releaseId);
  return (
    <article className={styles.flagCard}>
      <header className={styles.findingHeader}>
        <div>
          <p className={styles.eyebrow}>Release {release ? `#${release.revisionNumber}` : 'unavailable'} · Bend {flag.context.bendId ?? 'general'}</p>
          <h3>{flag.question}</h3>
        </div>
        <StatusBadge label={flag.status === 'open' ? 'Needs response' : flag.status === 'responded' ? 'Responded' : 'Resolved'} tone={flag.status === 'open' ? 'review' : 'complete'} />
      </header>
      <dl className={styles.contextGrid}>
        <div><dt>Job</dt><dd>{flag.context.jobId}</dd></div>
        <div><dt>Release</dt><dd>{flag.context.releaseId}</dd></div>
        <div><dt>Step</dt><dd>{flag.context.stepId ?? 'Not specified'}</dd></div>
        <div><dt>Raised</dt><dd>{new Date(flag.createdAt).toLocaleString()}</dd></div>
      </dl>
      {flag.photoAssetIds.length > 0 ? <p className={styles.subtle}>{flag.photoAssetIds.length} release-scoped photo attachment{flag.photoAssetIds.length === 1 ? '' : 's'}.</p> : null}
      {flag.response ? (
        <div className={styles.responseBox}>
          <strong>Designer response · {flag.response.kind === 'replacement_release' ? `Replacement release ${flag.response.replacementReleaseId}` : 'Explanation'}</strong>
          <p>{flag.response.text}</p>
        </div>
      ) : flag.context.jobId !== jobId || !release ? (
        <p className={styles.error}>This issue does not resolve to a release in this job, so a response cannot be safely attached.</p>
      ) : (
        <div className={styles.responseForm}>
          <Field id={`flag-response-${flag.id}`} label="Response to the factory-floor issue">
            <textarea id={`flag-response-${flag.id}`} className="field__control" rows={3} value={value.text} onChange={(event) => onChange({ ...value, text: event.target.value })} placeholder="Answer this exact release and bend context…" />
          </Field>
          <Field id={`flag-kind-${flag.id}`} label="Response type">
            <select id={`flag-kind-${flag.id}`} className="field__control" value={value.kind} onChange={(event) => onChange({ ...value, kind: event.target.value as FlagResponseDraft['kind'], replacementReleaseId: '' })}>
              <option value="explanation">Explanation</option>
              <option value="replacement_release">Replacement release</option>
            </select>
          </Field>
          {value.kind === 'replacement_release' ? (
            <Field id={`flag-replacement-${flag.id}`} label="Same-job replacement release">
              <select id={`flag-replacement-${flag.id}`} className="field__control" value={value.replacementReleaseId} onChange={(event) => onChange({ ...value, replacementReleaseId: event.target.value })}>
                <option value="">Choose a published release…</option>
                {validReplacementReleases.map((item) => <option key={item.id} value={item.id}>Release #{item.revisionNumber}</option>)}
              </select>
            </Field>
          ) : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <Button type="button" small disabled={busy || !value.text.trim() || (value.kind === 'replacement_release' && !validReplacementReleases.some((item) => item.id === value.replacementReleaseId))} onClick={onRespond}>
            {busy ? 'Sending response…' : 'Respond to this issue'}
          </Button>
        </div>
      )}
    </article>
  );
}

export function JobReviewDesk({ jobId, role, client = api }: JobReviewDeskProps) {
  return <JobReviewDeskSession key={jobId} jobId={jobId} role={role} client={client} />;
}

function JobReviewDeskSession({ jobId, role, client }: { jobId: string; role: Role; client: ReviewApi }) {
  const [jobLoad, setJobLoad] = useState<JobLoad | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [generationId, setGenerationId] = useState<Id | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStartBusy, setGenerationStartBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadCount, setReloadCount] = useState(0);
  const [draftDirty, setDraftDirty] = useState(false);
  const [assetLinks, setAssetLinks] = useState<Record<string, string>>({});
  const [assetLinkErrors, setAssetLinkErrors] = useState<Record<string, string>>({});
  const [linkBusy, setLinkBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [findingNotes, setFindingNotes] = useState<Record<string, string>>({});
  const [clarificationRecords, setClarificationRecords] = useState<Record<string, string>>({});
  const [findingBusyId, setFindingBusyId] = useState<string | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [flagBusyId, setFlagBusyId] = useState<string | null>(null);
  const [flagDrafts, setFlagDrafts] = useState<Record<string, FlagResponseDraft>>({});
  const [flagErrors, setFlagErrors] = useState<Record<string, string>>({});
  const [allowPredecessorVisitors, setAllowPredecessorVisitors] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const publishKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const clarificationKeys = useRef<Record<string, { text: string; key: string }>>({});
  const generationKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const generationPollInFlight = useRef(false);
  const generationPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationPollRef = useRef<(id: Id) => Promise<void>>(async () => {});

  const pollGeneration = useCallback(async (id: Id) => {
    if (generationPollInFlight.current) return;
    generationPollInFlight.current = true;
    if (generationPollTimer.current) clearTimeout(generationPollTimer.current);
    try {
      const result = await client.generations.get({ generationId: id });
      if (result.generation.id !== id || result.generation.jobId !== jobId) {
        throw new Error('The generation status does not match this job.');
      }
      setGeneration(result.generation);
      if (result.generation.state === 'succeeded') {
        if (!result.draft || result.draft.jobId !== jobId) {
          setGenerationError('The service marked generation complete without returning this job’s draft. Reload the job before continuing.');
          return;
        }
        setDraft(result.draft);
        storeGenerationId(jobId, null);
        setGenerationId(null);
        setGenerationError(null);
        generationKey.current = null;
        try {
          const latestJob = await client.jobs.get({ jobId: jobId as Id });
          if (latestJob.job.id === jobId) setJobLoad(latestJob);
        } catch (error) {
          setGenerationError(`The draft was returned by the service, but job state could not be refreshed: ${explainError(error)}`);
        }
        return;
      }
      if (result.generation.state === 'failed' || result.generation.state === 'expired') {
        const reason = result.generation.errorCode ? ` (${result.generation.errorCode})` : '';
        setGenerationError(`Generation ${result.generation.state}${reason}. The service did not create a draft; you can start a new attempt.`);
        storeGenerationId(jobId, null);
        setGenerationId(null);
        generationKey.current = null;
        return;
      }
      if (Date.parse(result.generation.expiresAt) <= Date.now()) {
        setGenerationError('The operation is still marked running after its expiry time. Check status again before starting a new attempt.');
        return;
      }
      setGenerationError(null);
      generationPollTimer.current = setTimeout(() => { void generationPollRef.current(id); }, 1500);
    } catch (error) {
      setGenerationError(explainError(error));
    } finally {
      generationPollInFlight.current = false;
    }
  }, [client, jobId]);
  generationPollRef.current = pollGeneration;

  useEffect(() => () => {
    if (generationPollTimer.current) clearTimeout(generationPollTimer.current);
  }, []);

  useEffect(() => {
    if (generationId && generation?.id !== generationId) void pollGeneration(generationId);
  }, [generation?.id, generationId, pollGeneration]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setJobLoad(null);
      setDraft(null);
      setDraftDirty(false);
      setOperationError(null);
      setActionMessage(null);
      try {
        const nextJob = await client.jobs.get({ jobId: jobId as Id });
        if (nextJob.job.id !== jobId) throw new Error('The API returned a different job than the requested review context.');
        if (active) {
          setJobLoad(nextJob);
          const savedGenerationId = nextJob.job.draftId ? null : getStoredGenerationId(jobId);
          if (!savedGenerationId) storeGenerationId(jobId, null);
          setGenerationId(savedGenerationId);
          setGeneration(null);
          setGenerationError(null);
        }
        const nextDraft = nextJob.job.draftId ? await client.drafts.get({ jobId: jobId as Id }) : null;
        if (nextDraft && nextDraft.jobId !== jobId) throw new Error('The API returned a draft belonging to a different job.');
        if (active) setDraft(nextDraft);
      } catch (error) {
        if (active) setLoadError(explainError(error));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [client, jobId, reloadCount]);

  useEffect(() => {
    if (!jobLoad) return undefined;
    let active = true;
    const loadFlags = async () => {
      setFlagsLoading(true);
      setFlagsError(null);
      try {
        const nextFlags = await client.flags.list({ jobId: jobId as Id });
        if (active) setFlags(nextFlags.filter((flag) => flag.context.jobId === jobId));
      } catch (error) {
        if (active) setFlagsError(explainError(error));
      } finally {
        if (active) setFlagsLoading(false);
      }
    };
    void loadFlags();
    return () => { active = false; };
  }, [client, jobId, jobLoad]);

  const sourceAssets = jobLoad?.assets ?? NO_ASSETS;
  const sourceAssetIds = new Set(jobLoad?.job.sourceAssetIds ?? []);
  const drawing = sourceAssets.find((asset) => sourceAssetIds.has(asset.id) && asset.kind === 'drawing_pdf' && asset.status === 'ready' && asset.sha256 !== null) ?? null;
  const glb = sourceAssets.find((asset) => sourceAssetIds.has(asset.id) && asset.kind === 'model_glb' && asset.status === 'ready' && asset.sha256 !== null) ?? null;
  const generationBlockers = [
    ...(jobLoad?.job.workshopSnapshotId ? [] : ['Select a workshop snapshot on the job first.']),
    ...(jobLoad?.job.machineId ? [] : ['Select the machine for this job first.']),
    ...(drawing && sourceAssetIds.has(drawing.id) ? [] : ['Attach a ready, verified drawing PDF.']),
    ...(glb && sourceAssetIds.has(glb.id) ? [] : ['Attach a ready, verified GLB model.']),
  ];

  useEffect(() => {
    if (!jobLoad) return undefined;
    let active = true;
    const ids = new Set<string>();
    if (drawing) ids.add(drawing.id);
    if (glb) ids.add(glb.id);
    if (draft) for (const evidence of evidenceForDraft(draft)) {
      const assetId = evidenceAssetId(evidence);
      if (assetId && sourceAssets.some((asset) => asset.id === assetId)) ids.add(assetId);
    }
    const loadLinks = async () => {
      setLinkBusy(true);
      const results = await Promise.all([...ids].map(async (assetId) => {
        try {
          const result = await client.assets.getLink({ assetId: assetId as Id });
          return [assetId, result.url, null] as const;
        } catch (error) {
          return [assetId, null, explainError(error)] as const;
        }
      }));
      if (active) {
        const links: Record<string, string> = {};
        const errors: Record<string, string> = {};
        for (const [assetId, url, error] of results) {
          if (url) links[assetId] = url;
          if (error) errors[assetId] = error;
        }
        setAssetLinks(links);
        setAssetLinkErrors(errors);
        setLinkBusy(false);
      }
    };
    void loadLinks();
    return () => { active = false; };
  }, [client, draft, drawing, glb, jobLoad, sourceAssets]);

  useEffect(() => {
    if (!draft) { setSelectedStepId(null); return; }
    if (selectedStepId && draft.content.steps.some((step) => step.id === selectedStepId)) return;
    setSelectedStepId(draft.content.steps[0]?.id ?? null);
  }, [draft, selectedStepId]);

  const resolveAssetUrl = useCallback(async (assetId: Id) => (await client.assets.getLink({ assetId })).url, [client]);
  const releases = useMemo(() => (jobLoad?.releases ?? []).filter((release) => release.jobId === jobId), [jobLoad, jobId]);
  const currentStepIndex = draft?.content.steps.findIndex((step) => step.id === selectedStepId) ?? -1;
  const currentStep: Step | null = currentStepIndex >= 0 && draft ? draft.content.steps[currentStepIndex] : null;
  const currentBend: Bend | null = (currentStep && draft?.content.bends.find((bend) => bend.bendId === currentStep.bendId))
    ?? draft?.content.bends[0]
    ?? null;
  const sceneData: SceneData | null = draft?.content.panelModel ? {
    panelModel: draft.content.panelModel,
    bends: draft.content.bends,
    steps: draft.content.steps,
  } : null;
  const publishBlockers = draft ? getPublishBlockers(draft, draftDirty) : ['A draft is required.'];
  const publishBlocked = publishBlockers.length > 0 || busyAction !== null;

  const startGeneration = async () => {
    if (!jobLoad || generationStartBusy || draft || generationId || generationBlockers.length > 0) return;
    const fingerprint = JSON.stringify([jobId, jobLoad.job.version, jobLoad.job.sourceAssetIds, jobLoad.job.workshopSnapshotId, jobLoad.job.machineId]);
    if (!generationKey.current || generationKey.current.fingerprint !== fingerprint) {
      generationKey.current = { fingerprint, key: makeIdempotencyKey() };
    }
    setGenerationStartBusy(true);
    setGenerationError(null);
    try {
      const started = await client.generations.create({
        jobId: jobId as Id,
        expectedJobVersion: jobLoad.job.version,
        idempotencyKey: generationKey.current.key,
      });
      if (started.jobId !== jobId) throw new Error('The generation request returned an operation for another job.');
      storeGenerationId(jobId, started.id);
      setGenerationId(started.id);
      setGeneration(started);
      await pollGeneration(started.id);
    } catch (error) {
      setGenerationError(explainError(error));
    } finally {
      setGenerationStartBusy(false);
    }
  };

  const refreshAssetLink = async (asset: Asset) => {
    try {
      const result = await client.assets.getLink({ assetId: asset.id });
      setAssetLinks((links) => ({ ...links, [asset.id]: result.url }));
      setAssetLinkErrors((errors) => { const next = { ...errors }; delete next[asset.id]; return next; });
    } catch (error) {
      setAssetLinkErrors((errors) => ({ ...errors, [asset.id]: explainError(error) }));
    }
  };

  const saveDraftChanges = async () => {
    if (!draft || !draftDirty || busyAction) return;
    setBusyAction('save'); setOperationError(null); setActionMessage(null);
    try {
      const next = await client.drafts.save({ jobId: jobId as Id, expectedVersion: draft.version, content: toDraftContentInput(draft) });
      setDraft(next); setDraftDirty(false); setActionMessage(`Draft version ${next.version} saved by the service.`);
    } catch (error) { setOperationError(explainError(error)); }
    finally { setBusyAction(null); }
  };

  const decideProposal = async (proposalId: string, decision: 'accept' | 'reject') => {
    if (!draft || draftDirty || busyAction) return;
    setBusyAction(`proposal-${proposalId}`); setOperationError(null); setActionMessage(null);
    try {
      const next = await client.drafts.decideProposal({ jobId: jobId as Id, proposalId: proposalId as Id, expectedVersion: draft.version, decision });
      setDraft(next); setActionMessage(`Machine proposal ${decision === 'accept' ? 'accepted' : 'rejected'} by the service.`);
    } catch (error) { setOperationError(explainError(error)); }
    finally { setBusyAction(null); }
  };

  const reviewDraft = async (kind: 'design' | 'process') => {
    if (!draft || draftDirty || busyAction) return;
    setBusyAction(`review-${kind}`); setOperationError(null); setActionMessage(null);
    try {
      const next = await client.drafts.review({ jobId: jobId as Id, expectedVersion: draft.version, kind });
      setDraft(next); setActionMessage(`${kind === 'design' ? 'Design' : 'Process'} review recorded for version ${next.version}.`);
    } catch (error) { setOperationError(explainError(error)); }
    finally { setBusyAction(null); }
  };

  const publishDraft = async () => {
    if (!draft || !jobLoad || getPublishBlockers(draft, draftDirty).length > 0 || busyAction) return;
    const publishFingerprint = JSON.stringify([draft.version, jobLoad.job.latestReleaseId, allowPredecessorVisitors]);
    if (!publishKey.current || publishKey.current.fingerprint !== publishFingerprint) publishKey.current = { fingerprint: publishFingerprint, key: makeIdempotencyKey() };
    setBusyAction('publish'); setOperationError(null); setActionMessage(null);
    try {
      const release = await client.releases.publish({
        jobId: jobId as Id,
        expectedDraftVersion: draft.version,
        supersedesReleaseId: jobLoad.job.latestReleaseId,
        allowPredecessorVisitors,
        idempotencyKey: publishKey.current.key,
      });
      setActionMessage(`The service published release #${release.revisionNumber}. Reload to read the updated job state.`);
    } catch (error) { setOperationError(explainError(error)); }
    finally { setBusyAction(null); }
  };

  const moveStep = (index: number, offset: -1 | 1) => {
    if (!draft || busyAction) return;
    const target = index + offset;
    if (target < 0 || target >= draft.content.steps.length) return;
    const steps = [...draft.content.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setDraft({ ...draft, content: { ...draft.content, steps } });
    setDraftDirty(true);
    setOperationError(null);
    setActionMessage('Step order change staged. Save draft changes before review or publication.');
  };

  const resolveFinding = async (finding: Finding) => {
    if (!draft || findingBusyId) return;
    const note = findingNotes[finding.id]?.trim() ?? '';
    let recordId = clarificationRecords[finding.id];
    if (!recordId && !note) return;
    setFindingBusyId(finding.id); setOperationError(null); setActionMessage(null);
    try {
      if (!recordId) {
        if (!clarificationKeys.current[finding.id] || clarificationKeys.current[finding.id].text !== note) {
          clarificationKeys.current[finding.id] = { text: note, key: makeIdempotencyKey() };
        }
        const evidence = await client.drafts.recordClarification({ jobId: jobId as Id, text: note, idempotencyKey: clarificationKeys.current[finding.id].key });
        if (evidence.kind !== 'human_clarification') throw new Error('The clarification endpoint did not return a human clarification record. The finding remains open.');
        recordId = evidence.recordId;
        setClarificationRecords((records) => ({ ...records, [finding.id]: evidence.recordId }));
      }
      const next = await client.drafts.resolveFinding({ jobId: jobId as Id, findingId: finding.id, expectedVersion: draft.version, recordId: recordId as Id });
      setDraft(next); setDraftDirty(false);
      setFindingNotes((notes) => { const nextNotes = { ...notes }; delete nextNotes[finding.id]; return nextNotes; });
      setClarificationRecords((records) => { const nextRecords = { ...records }; delete nextRecords[finding.id]; return nextRecords; });
      delete clarificationKeys.current[finding.id];
      setActionMessage('The clarification and finding resolution were recorded by the service.');
    } catch (error) { setOperationError(explainError(error)); }
    finally { setFindingBusyId(null); }
  };

  const respondToFlag = async (flag: Flag) => {
    if (flagBusyId) return;
    const response = flagDrafts[flag.id] ?? emptyFlagResponse;
    if (!response.text.trim() || flag.context.jobId !== jobId) return;
    const actualRelease = releases.find((release) => release.id === flag.context.releaseId && release.jobId === jobId);
    if (!actualRelease) {
      setFlagErrors((errors) => ({ ...errors, [flag.id]: 'This flag does not identify an actual release in the current job.' }));
      return;
    }
    if (response.kind === 'replacement_release' && !releases.some((release) => release.id === response.replacementReleaseId && release.jobId === jobId && release.id !== flag.context.releaseId)) {
      setFlagErrors((errors) => ({ ...errors, [flag.id]: 'Choose an actual published release from this job.' }));
      return;
    }
    setFlagBusyId(flag.id); setFlagErrors((errors) => { const next = { ...errors }; delete next[flag.id]; return next; });
    try {
      const updated = await client.flags.respond({
        flagId: flag.id,
        expectedVersion: flag.version,
        text: response.text.trim(),
        kind: response.kind,
        replacementReleaseId: response.kind === 'replacement_release' ? response.replacementReleaseId as Id : null,
      });
      setFlags((items) => items.map((item) => item.id === updated.id ? updated : item));
      setFlagDrafts((drafts) => { const next = { ...drafts }; delete next[flag.id]; return next; });
    } catch (error) {
      setFlagErrors((errors) => ({ ...errors, [flag.id]: explainError(error) }));
    } finally { setFlagBusyId(null); }
  };

  return (
    <main className={styles.reviewShell}>
      <header className={styles.reviewHeader}>
        <div>
          <p className={styles.eyebrow}>Designer review desk · {role}</p>
          <h1>{jobLoad?.job.title ?? 'Job review'}</h1>
          {jobLoad ? <p className={styles.subtitle}>{jobLoad.job.partNumber} · {jobLoad.job.partFamily} · version {jobLoad.job.version}</p> : <p className={styles.subtitle}>Job {jobId}</p>}
        </div>
        <Button type="button" tone="secondary" small onClick={() => setReloadCount((count) => count + 1)} disabled={loading}>Reload server state</Button>
      </header>

      {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      {operationError ? <p className={styles.error} role="alert">{operationError}</p> : null}
      {actionMessage ? <p className={styles.success} role="status">{actionMessage}</p> : null}
      {loading ? <p className={styles.loading} role="status">Loading the current job, draft and source files…</p> : null}

      {jobLoad ? (
        <>
          <section className={styles.reviewGrid}>
            <div className={styles.reviewColumn}>
              <Panel title="Source drawing" eyebrow="Authorized source" className={styles.sourcePanel}>
                <PanelBody>
                  {drawing ? (
                    <>
                      <div className={styles.assetHeading}><strong>{drawing.filename}</strong><span>{drawing.drawingRevision ? `Revision ${drawing.drawingRevision}` : 'Drawing revision not provided'}</span></div>
                      {assetLinks[drawing.id] ? <iframe className={styles.pdfFrame} title={`Source drawing ${drawing.filename}`} src={assetLinks[drawing.id]} /> : <p className={styles.subtle}>{linkBusy ? 'Requesting authorized PDF access…' : assetLinkErrors[drawing.id] ?? 'Authorized PDF preview unavailable.'}</p>}
                      <div className={styles.linkActions}>
                        {assetLinks[drawing.id] ? <a className={styles.textLink} href={assetLinks[drawing.id]} target="_blank" rel="noreferrer">Open source PDF</a> : null}
                        <Button type="button" tone="quiet" small onClick={() => void refreshAssetLink(drawing)}>Refresh secure link</Button>
                      </div>
                    </>
                  ) : <p className={styles.subtle}>No ready, verified drawing PDF is attached to this job.</p>}
                </PanelBody>
              </Panel>

              {draft ? (
                <Panel title="Current bend and step" eyebrow="Instruction identity">
                  <PanelBody>
                    {currentStep ? <div className={styles.currentStep}><p className={styles.eyebrow}>Step {currentStepIndex + 1} of {draft.content.steps.length} · {currentStep.id}</p><h3>{currentStep.instruction}</h3><p>Bend {currentStep.bendId}</p><EvidenceList evidence={currentStep.evidence} assets={sourceAssets} links={assetLinks} /></div> : <p className={styles.subtle}>This draft has no instruction steps yet.</p>}
                    <div className={styles.stepList} role="list" aria-label="Draft step order">
                      {draft.content.steps.map((step, index) => (
                        <div key={step.id} className={styles.stepRow} role="listitem">
                          <button type="button" className={step.id === selectedStepId ? styles.stepActive : styles.stepButton} onClick={() => setSelectedStepId(step.id)}>
                            <span>{String(index + 1).padStart(2, '0')}</span><span>{step.bendId}</span><span>{step.instruction}</span>
                          </button>
                          <div className={styles.stepMoveControls} role="group" aria-label={`Change order of step ${index + 1}, Bend ${step.bendId}`}>
                            <button type="button" aria-label={`Move step ${index + 1}, Bend ${step.bendId}, earlier`} disabled={index === 0 || busyAction !== null} onClick={() => moveStep(index, -1)}>↑</button>
                            <button type="button" aria-label={`Move step ${index + 1}, Bend ${step.bendId}, later`} disabled={index === draft.content.steps.length - 1 || busyAction !== null} onClick={() => moveStep(index, 1)}>↓</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {sceneData && draft.content.steps.length > 0 ? <div className={styles.sceneBox}><BendScene data={sceneData} completedStepCount={Math.max(0, currentStepIndex)} activeStepProgress={0} selectedBendId={currentBend?.bendId ?? null} interactive onBendSelect={(bendId) => { const step = draft.content.steps.find((item) => item.bendId === bendId); if (step) setSelectedStepId(step.id); }} /></div> : <p className={styles.subtle}>A reviewed panel mapping and step sequence are needed for a fold preview.</p>}
                  </PanelBody>
                </Panel>
              ) : null}
            </div>

            <div className={styles.reviewColumn}>
              {draft ? (
                <>
                  <Panel title="Sourced bend values" eyebrow={`Draft version ${draft.version}`}>
                    <PanelBody>
                      <div className={styles.metaLine}><span>Workshop snapshot</span><code>{draft.content.workshopSnapshotId}</code></div>
                      <div className={styles.metaLine}><span>Machine</span><code>{draft.content.machineId}</code></div>
                      {draft.content.bends.length === 0 ? <p className={styles.subtle}>No bend values have been returned in this draft.</p> : draft.content.bends.map((bend) => (
                        <section className={styles.bendSection} key={bend.bendId}>
                          <h3>Bend {bend.bendId}{bend.hingeId ? <span> · Hinge {bend.hingeId}</span> : null}</h3>
                          <div className={styles.valueGrid}>
                            <SourcedValue label="Finished angle" {...bend.finishedAngle} assets={sourceAssets} links={assetLinks} />
                            <SourcedValue label="Fold rotation" {...bend.foldRotationDeg} assets={sourceAssets} links={assetLinks} />
                            <SourcedValue label="Inside radius" {...bend.insideRadiusMm} assets={sourceAssets} links={assetLinks} />
                            <SourcedValue label="Direction" {...bend.directionText} assets={sourceAssets} links={assetLinks} />
                          </div>
                          <BendFactEditor
                            key={`${bend.bendId}-${draft.version}`}
                            bend={bend}
                            sourceAssets={sourceAssets}
                            disabled={busyAction !== null || (role !== 'admin' && role !== 'designer')}
                            onStageCorrection={(nextBend) => {
                              setDraft((current) => current ? {
                                ...current,
                                content: {
                                  ...current.content,
                                  bends: current.content.bends.map((item) => item.bendId === nextBend.bendId ? nextBend : item),
                                },
                              } : current);
                              setDraftDirty(true);
                              setOperationError(null);
                              setActionMessage(`Bend ${nextBend.bendId} corrections are staged. Save draft changes before review or publication.`);
                            }}
                          />
                        </section>
                      ))}
                    </PanelBody>
                  </Panel>

                  <Panel title="Authored panel mapping" eyebrow={draft.content.panelModel?.origin.replaceAll('_', ' ') ?? 'Mapping required'}>
                    <PanelBody>
                      <BendMapEditor value={draft.content.panelModel} bends={draft.content.bends} readOnly={busyAction !== null} onChange={(panelModel, bends) => {
                        setDraft((current) => current ? { ...current, content: { ...current.content, panelModel, bends } } : current);
                        setDraftDirty(true); setOperationError(null); setActionMessage(null);
                      }} />
                      <div className={styles.saveRow}>
                        <p className={styles.subtle}>{draftDirty ? 'Unsaved draft changes. Reviews will apply only after saving.' : draft.content.panelModel?.reviewed ? 'Mapping review status is confirmed by the service.' : 'Mapping review has not been confirmed by the service.'}</p>
                        <Button type="button" disabled={!draftDirty || busyAction !== null} onClick={() => void saveDraftChanges()}>{busyAction === 'save' ? 'Saving…' : 'Save draft changes'}</Button>
                      </div>
                    </PanelBody>
                  </Panel>
                </>
              ) : !loading && !loadError ? (
                <Panel title="Generate the first draft" eyebrow="Uses this job’s real source packet">
                  <PanelBody>
                    <p className={styles.subtle}>Ask the service to read the uploaded drawing, model and selected workshop setup. The review desk opens only after the API returns a saved draft.</p>
                    {generationError ? <p className={styles.error} role="alert">{generationError}</p> : null}
                    {generationId && generation?.state === 'running' ? <p className={styles.loading} role="status">Generation is processing. Its server operation expires {new Date(generation.expiresAt).toLocaleString()}.</p> : null}
                    {generationId && !generation ? <p className={styles.loading} role="status">Checking the saved generation operation…</p> : null}
                    {generationBlockers.length > 0 ? <ul className={styles.blockerList}>{generationBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
                    {generationId && generation?.state === 'running' ? (
                      <Button type="button" tone="secondary" onClick={() => void pollGeneration(generationId)}>Check generation status</Button>
                    ) : (
                      <Button type="button" disabled={generationStartBusy || Boolean(generationId) || generationBlockers.length > 0} onClick={() => void startGeneration()}>
                        {generationStartBusy ? 'Starting generation…' : generation?.state === 'failed' || generation?.state === 'expired' ? 'Try generation again' : 'Generate AI draft'}
                      </Button>
                    )}
                  </PanelBody>
                </Panel>
              ) : null}

              {glb ? (
                <Panel title="Supplied 3D model" eyebrow="Source asset"><PanelBody><p className={styles.assetHeading}><strong>{glb.filename}</strong><span>{glb.byteSize.toLocaleString()} bytes</span></p><ModelViewer assetId={glb.id} resolveAssetUrl={resolveAssetUrl} onError={setModelError} />{modelError ? <p className={styles.error}>{modelError}</p> : null}<p className={styles.subtle}>{assetLinkErrors[glb.id] ?? (assetLinks[glb.id] ? 'Loaded through an authorized, short-lived asset URL.' : '')}</p></PanelBody></Panel>
              ) : null}
            </div>
          </section>

          {draft ? (
            <section className={styles.reviewGrid}>
              <Panel title="Open findings" eyebrow={`${draft.content.findings.filter((item) => item.disposition === 'open').length} open`}>
                <PanelBody className={styles.findingsList}>
                  {draft.content.findings.length === 0 ? <p className={styles.subtle}>No findings were returned for this draft.</p> : draft.content.findings.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} assets={sourceAssets} links={assetLinks} clarification={findingNotes[finding.id] ?? ''} savedRecord={Boolean(clarificationRecords[finding.id])} busy={findingBusyId === finding.id} onTextChange={(value) => setFindingNotes((notes) => ({ ...notes, [finding.id]: value }))} onResolve={() => void resolveFinding(finding)} />
                  ))}
                </PanelBody>
              </Panel>

              <Panel title="Machine order proposals" eyebrow="Before and after">
                <PanelBody className={styles.proposalList}>
                  {draft.content.machineProposals.length === 0 ? <p className={styles.subtle}>No machine order proposals were returned.</p> : draft.content.machineProposals.map((proposal) => {
                    const currentOrder = draft.content.steps.map((step) => step.bendId);
                    return <article className={styles.proposalCard} key={proposal.id}>
                      <header className={styles.findingHeader}><div><p className={styles.eyebrow}>Machine {proposal.machineId} · workshop snapshot {proposal.snapshotId}</p><h3>Proposed bend order</h3></div><StatusBadge label={proposal.status} tone={proposal.status === 'proposed' ? 'review' : proposal.status === 'accepted' ? 'complete' : 'neutral'} /></header>
                      <div className={styles.orderCompare}><div><strong>Before · current draft</strong><ol>{currentOrder.map((bendId, index) => <li key={`${bendId}-${index}`}>{bendId}</li>)}</ol></div><div><strong>After · proposal</strong><ol>{proposal.proposedBendOrder.map((bendId, index) => <li key={`${bendId}-${index}`}>{bendId}</li>)}</ol></div></div>
                      <p className={styles.rationale}><strong>Rationale</strong>{proposal.rationale}</p>
                      <EvidenceList evidence={proposal.evidence} assets={sourceAssets} links={assetLinks} />
                      {proposal.status === 'proposed' ? <div className={styles.actionRow}><Button type="button" tone="secondary" small disabled={draftDirty || busyAction !== null} onClick={() => void decideProposal(proposal.id, 'reject')}>Reject proposal</Button><Button type="button" small disabled={draftDirty || busyAction !== null} onClick={() => void decideProposal(proposal.id, 'accept')}>Accept proposal</Button></div> : null}
                      {draftDirty ? <p className={styles.subtle}>Save mapping changes before deciding a proposal.</p> : null}
                    </article>;
                  })}
                </PanelBody>
              </Panel>
            </section>
          ) : null}

          <section className={styles.reviewGrid}>
            <Panel title="Review and publish" eyebrow="Server-authorized actions">
              <PanelBody>
                {draft ? <>
                  <p className={styles.subtle}>Review actions are sent to the API with your current session and role. API authorization and validation errors are shown above.</p>
                  <div className={styles.reviewActions}>
                    <div><strong>Design review</strong><span>{draft.reviews.some((review) => review.kind === 'design') ? `Recorded for version ${draft.version}` : 'Not recorded'}</span><Button type="button" tone="secondary" small disabled={draftDirty || busyAction !== null} onClick={() => void reviewDraft('design')}>{busyAction === 'review-design' ? 'Submitting…' : 'Submit design review'}</Button></div>
                    <div><strong>Process review</strong><span>{draft.reviews.some((review) => review.kind === 'process') ? `Recorded for version ${draft.version}` : 'Not recorded'}</span><Button type="button" tone="secondary" small disabled={draftDirty || busyAction !== null} onClick={() => void reviewDraft('process')}>{busyAction === 'review-process' ? 'Submitting…' : 'Submit process review'}</Button></div>
                  </div>
                  <label className={styles.checkboxRow}><input type="checkbox" checked={allowPredecessorVisitors} onChange={(event) => setAllowPredecessorVisitors(event.target.checked)} /> Allow visitors with a predecessor release link to continue after replacement</label>
                  {publishBlockers.length > 0 ? <ul className={styles.blockerList}>{publishBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className={styles.success}>The draft is ready to ask the service to publish. The publish endpoint remains authoritative.</p>}
                  <Button type="button" disabled={publishBlocked} onClick={() => void publishDraft()}>{busyAction === 'publish' ? 'Publishing…' : 'Publish release'}</Button>
                </> : <p className={styles.subtle}>A current draft is required before it can be reviewed or published.</p>}
              </PanelBody>
            </Panel>

            <Panel title="Factory-floor issues" eyebrow="Exact release context" action={<Button type="button" tone="quiet" small disabled={flagsLoading} onClick={() => setReloadCount((count) => count + 1)}>Reload issues</Button>}>
              <PanelBody className={styles.flagList}>
                {flagsLoading ? <p className={styles.subtle} role="status">Loading issue responses…</p> : null}
                {flagsError ? <p className={styles.error} role="alert">{flagsError}</p> : null}
                {flags.length === 0 && !flagsLoading && !flagsError ? <p className={styles.subtle}>No factory-floor issues are recorded for this job.</p> : null}
                {flags.map((flag) => <FlagResponseCard key={flag.id} flag={flag} jobId={jobId} releases={releases} busy={flagBusyId === flag.id} value={flagDrafts[flag.id] ?? emptyFlagResponse} error={flagErrors[flag.id] ?? null} onChange={(next) => setFlagDrafts((items) => ({ ...items, [flag.id]: next }))} onRespond={() => void respondToFlag(flag)} />)}
              </PanelBody>
            </Panel>
          </section>
        </>
      ) : null}
    </main>
  );
}
