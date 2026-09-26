'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { Answer, Asset, ContextRef, EvidenceRef, Flag, ReleaseView, Step } from '@/contracts';
import { Button, Panel, PanelBody, SourceReference, StatusBadge, TextInput } from '@/components/ui';
import { ApiClientError, api } from '@/lib/api/client';
import type { ApiClient } from '@/lib/api/client';
import { BendScene, ModelViewer, type SceneData } from '@/features/visualization';
import styles from './operator.module.css';

type FloorApi = Pick<ApiClient, 'assets' | 'flags' | 'questions' | 'releases'>;
type FloorTab = 'guide' | 'model' | 'ask' | 'flags';

const tabs: Array<{ id: FloorTab; label: string }> = [
  { id: 'guide', label: 'Guide' },
  { id: 'model', label: 'Model' },
  { id: 'ask', label: 'Ask' },
  { id: 'flags', label: 'Flags' },
];

function explainError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ENDPOINT_UNAVAILABLE') {
    return 'This service endpoint is not available in the current build. Nothing was recorded.';
  }
  if (error instanceof ApiClientError && error.code === 'UNAUTHENTICATED') {
    return 'This release session has expired. Reopen the original authorised QR link.';
  }
  if (error instanceof ApiClientError && error.code === 'RELEASE_REVOKED') {
    return 'Access to this release has been revoked. Ask the designer for a current authorised link.';
  }
  return error instanceof Error ? error.message : 'The request could not be completed. Nothing was recorded.';
}

function sourceLabel(evidence: EvidenceRef, assets: Asset[]): { label: string; detail: string } {
  if (evidence.kind === 'document') {
    const asset = assets.find((item) => item.id === evidence.assetId);
    return {
      label: asset?.filename ?? 'Released source document',
      detail: 'Page ' + evidence.page + (evidence.excerpt ? ' · “' + evidence.excerpt + '”' : ''),
    };
  }
  if (evidence.kind === 'workshop_note') return { label: 'Confirmed workshop note', detail: evidence.noteId };
  return { label: 'Recorded human clarification', detail: evidence.recordId };
}

function EvidenceList({ evidence, assets }: { evidence: EvidenceRef[]; assets: Asset[] }) {
  if (evidence.length === 0) return <p className={styles.muted}>No source reference is attached to this item.</p>;
  return (
    <ul className={styles.evidenceList}>
      {evidence.map((item, index) => {
        const source = sourceLabel(item, assets);
        return (
          <li key={item.kind + '-' + index}>
            <SourceReference label={source.label} detail={source.detail} />
          </li>
        );
      })}
    </ul>
  );
}

function readySourceAsset(assets: Asset[], kind: 'drawing_pdf' | 'model_glb'): Asset | null {
  return assets.find((asset) => asset.kind === kind && asset.status === 'ready' && asset.sha256 !== null) ?? null;
}

function FlagCard({
  flag,
  onAcknowledge,
  acknowledged,
  busy,
  canAcknowledge,
}: {
  flag: Flag;
  onAcknowledge: (flag: Flag) => void;
  acknowledged: boolean;
  busy: boolean;
  canAcknowledge: boolean;
}) {
  return (
    <article className={styles.flagCard}>
      <div className={styles.flagHeader}>
        <div>
          <p className={styles.eyebrow}>{flag.context.bendId ? 'Operation ' + flag.context.bendId : 'General issue'} · {new Date(flag.createdAt).toLocaleString()}</p>
          <h3>{flag.question}</h3>
        </div>
        <StatusBadge label={flag.status === 'open' ? 'Awaiting designer' : flag.status === 'responded' ? 'Response received' : 'Resolved'}
          tone={flag.status === 'open' ? 'review' : 'complete'} />
      </div>
      {flag.photoAssetIds.length > 0 ? (
        <p className={styles.muted}>{flag.photoAssetIds.length} release-scoped photo attachment{flag.photoAssetIds.length === 1 ? '' : 's'}</p>
      ) : null}
      {flag.response ? (
        <div className={styles.response}>
          <p className={styles.eyebrow}>Designer response · {new Date(flag.response.at).toLocaleString()}</p>
          <p>{flag.response.text}</p>
          {flag.response.kind === 'replacement_release' ? <p className={styles.muted}>This response points to a replacement release. Follow it only when the release owner authorises that transition above.</p> : null}
          {canAcknowledge ? <Button type="button" tone="secondary" small disabled={busy || acknowledged} onClick={() => onAcknowledge(flag)}>
            {acknowledged ? 'Acknowledgement recorded' : 'Acknowledge response'}
          </Button> : null}
        </div>
      ) : <p className={styles.muted}>Your note is stored with this release and operation. The designer response will appear here when available.</p>}
    </article>
  );
}

export function OperatorFloor({ releaseId, client = api }: { releaseId: string; client?: FloorApi }) {
  return <OperatorFloorSession key={releaseId} releaseId={releaseId} client={client} />;
}

function OperatorFloorSession({ releaseId, client }: { releaseId: string; client: FloorApi }) {
  const router = useRouter();
  const [view, setView] = useState<ReleaseView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<FloorTab>('guide');
  const [stepIndex, setStepIndex] = useState(0);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [flagQuestion, setFlagQuestion] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoAsset, setPhotoAsset] = useState<Asset | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagBusy, setFlagBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [acknowledgedIds, setAcknowledgedIds] = useState<string[]>([]);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const flagIdempotencyKey = useRef<string | null>(null);
  const photoIdempotencyKey = useRef<string | null>(null);
  const speechRecognition = useRef<{ stop: () => void } | null>(null);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const next = await client.releases.get({ releaseId });
        if (active) {
          setView(next);
          setTab(next.sourceAssets.some((asset) => asset.kind === 'model_glb' && asset.status === 'ready') ? 'model' : 'guide');
        }
      } catch (error) {
        if (active) setLoadError(explainError(error));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [client, releaseId, reloadToken]);

  useEffect(() => () => speechRecognition.current?.stop(), []);

  useEffect(() => {
    if (!view || tab !== 'flags') return undefined;
    let active = true;
    const refresh = async () => {
      try {
        setFlagsLoading(true);
        const next = await client.flags.list({ releaseId: view.release.id });
        if (active) {
          setFlags(next);
          setFlagsError(null);
        }
      } catch (error) {
        if (active) setFlagsError(explainError(error));
      } finally {
        if (active) setFlagsLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client, tab, view]);

  const release = view?.release ?? null;
  const snapshot = release?.snapshot ?? null;
  const allSteps = snapshot?.steps ?? [];
  // An older step without a recorded engineer decision is not an approved floor guide.
  const steps = allSteps.filter((step) => (step as Step & { guidance?: { decision: string } }).guidance?.decision === 'include');
  const currentStep: Step | null = steps[stepIndex] ?? null;
  const currentBend = currentStep ? snapshot?.bends.find((bend) => bend.bendId === currentStep.bendId) ?? null : null;
  const drawingAsset = view ? readySourceAsset(view.sourceAssets, 'drawing_pdf') : null;
  const modelAsset = view ? readySourceAsset(view.sourceAssets, 'model_glb') : null;
  const sceneData: SceneData | null = snapshot?.panelModel ? {
    panelModel: snapshot.panelModel,
    bends: snapshot.bends,
    steps: allSteps,
  } : null;

  const startVoiceInput = () => {
    if (listening) {
      speechRecognition.current?.stop();
      return;
    }
    type Recognition = {
      lang: string;
      interimResults: boolean;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    const browser = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError('Voice input is not available in this browser. Type your question instead.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setQuestion((existing) => [existing.trim(), transcript].filter(Boolean).join(' '));
    };
    recognition.onerror = (event) => setSpeechError(event.error === 'not-allowed'
      ? 'Microphone access was denied. Type your question instead.'
      : 'Voice input stopped without a transcript. Type your question instead.');
    recognition.onend = () => { setListening(false); speechRecognition.current = null; };
    setSpeechError(null);
    try {
      recognition.start();
      speechRecognition.current = recognition;
      setListening(true);
    } catch {
      setSpeechError('Voice input could not start. Type your question instead.');
    }
  };

  const buildContext = (step: Step | null): ContextRef | null => {
    if (!view) return null;
    return {
      jobId: view.job.id,
      releaseId: view.release.id,
      draftId: null,
      draftVersion: null,
      stepId: step?.id ?? null,
      bendId: step?.bendId ?? null,
    };
  };

  const openDrawingLink = async () => {
    if (!drawingAsset) return;
    setDocumentBusy(true);
    setDocumentError(null);
    try {
      const result = await client.assets.getLink({ assetId: drawingAsset.id });
      setDocumentUrl(result.url);
    } catch (error) {
      setDocumentError(explainError(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  const askQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const context = buildContext(currentStep);
    if (!context || !question.trim() || !view?.permissions.canAsk) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const result = await client.questions.ask({ context, question: question.trim() });
      setAnswer(result);
      setQuestion('');
    } catch (error) {
      setAskError(explainError(error));
    } finally {
      setAsking(false);
    }
  };

  const submitFlag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const context = buildContext(currentStep);
    if (!context || !view?.permissions.canFlag || !flagQuestion.trim()) return;
    setFlagBusy(true);
    setFlagError(null);
    try {
      let selectedPhoto = photoAsset;
      if (photoFile && !selectedPhoto) {
        if (!photoFile.type.startsWith('image/') || photoFile.size > 10 * 1024 * 1024) {
          throw new Error('Choose an image no larger than 10 MB. The flag has not been created.');
        }
        photoIdempotencyKey.current ??= crypto.randomUUID();
        selectedPhoto = await client.assets.uploadReleasePhoto({
          releaseId: view.release.id,
          file: photoFile,
          idempotencyKey: photoIdempotencyKey.current,
        });
        setPhotoAsset(selectedPhoto);
      }
      if (selectedPhoto && (selectedPhoto.status !== 'ready' || selectedPhoto.sha256 === null)) {
        throw new Error('The uploaded photo is not verified and ready yet. The flag has not been created.');
      }
      flagIdempotencyKey.current ??= crypto.randomUUID();
      const created = await client.flags.create({
        context,
        question: flagQuestion.trim(),
        photoAssetIds: selectedPhoto ? [selectedPhoto.id] : [],
        idempotencyKey: flagIdempotencyKey.current,
      });
      setFlags((existing) => existing ? [created, ...existing.filter((flag) => flag.id !== created.id)] : [created]);
      setFlagQuestion('');
      setPhotoFile(null);
      setPhotoAsset(null);
      flagIdempotencyKey.current = null;
      photoIdempotencyKey.current = null;
      setLastAction('Flag saved to the published release.');
    } catch (error) {
      setFlagError(explainError(error));
    } finally {
      setFlagBusy(false);
    }
  };

  const acknowledge = async (flag: Flag) => {
    setFlagBusy(true);
    setFlagError(null);
    try {
      const updated = await client.flags.acknowledge({ flagId: flag.id, expectedVersion: flag.version });
      setFlags((existing) => existing?.map((item) => item.id === updated.id ? updated : item) ?? [updated]);
      setAcknowledgedIds((existing) => existing.includes(updated.id) ? existing : [...existing, updated.id]);
      setLastAction('Acknowledgement recorded for this release response.');
    } catch (error) {
      setFlagError(explainError(error));
    } finally {
      setFlagBusy(false);
    }
  };

  const followReplacement = async () => {
    if (!view?.canFollowReplacement || !view.replacementReleaseId) return;
    try {
      await client.releases.followReplacement({ releaseId: view.release.id, replacementReleaseId: view.replacementReleaseId });
      router.push('/floor/' + view.replacementReleaseId);
    } catch (error) {
      setLoadError(explainError(error));
    }
  };

  const advanceStep = (direction: -1 | 1) => {
    setStepIndex((index) => Math.max(0, Math.min(steps.length, index + direction)));
    setPreviewProgress(0);
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!touchStart || event.pointerType !== 'touch') return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 85) advanceStep(dx < 0 ? 1 : -1);
    setTouchStart(null);
  };

  const renderGuide = () => {
    if (!view || !snapshot) return null;
    return (
      <div className={styles.guideGrid}>
        <div className={styles.guideMain}>
          {sceneData ? (
            <BendScene data={sceneData} completedStepCount={currentStep ? allSteps.findIndex((step) => step.id === currentStep.id) : 0}
              activeStepProgress={currentStep ? previewProgress : 0}
              selectedBendId={currentStep?.bendId ?? null} interactive reducedMotion={false}
              onBendSelect={(bendId) => {
                const selectedIndex = steps.findIndex((step) => step.bendId === bendId);
                if (selectedIndex >= 0) { setStepIndex(selectedIndex); setPreviewProgress(0); }
              }} />
          ) : (
            <Panel title="Illustrative geometry unavailable" eyebrow="Published release">
              <PanelBody><p>This release has no reviewed geometry preview. Use the released drawing and approved guide.</p></PanelBody>
            </Panel>
          )}
          <Panel title={currentStep ? 'Operation ' + currentStep.bendId : 'Guide complete'} eyebrow={currentStep ? 'Step ' + (stepIndex + 1) + ' of ' + steps.length : 'All released steps'}>
            <PanelBody>
              {currentStep ? (
                <article className={styles.stepCard} onPointerDown={(event) => {
                  const target = event.target;
                  if (event.pointerType === 'touch' && !(target instanceof HTMLElement && target.closest('button,input,textarea,select,a'))) {
                    setTouchStart({ x: event.clientX, y: event.clientY });
                  }
                }} onPointerUp={onPointerUp} onPointerCancel={() => setTouchStart(null)}>
                  <p className={styles.instruction}>{currentStep.instruction}</p>
                  {currentBend ? <div className={styles.bendReadout}>
                    <div><span className={styles.eyebrow}>Finished angle</span><strong>{currentBend.finishedAngle.value ? currentBend.finishedAngle.value.degrees + '° ' + currentBend.finishedAngle.value.convention.replace('_', ' ') : 'Not established'}</strong></div>
                    <div><span className={styles.eyebrow}>Signed fold from flat</span><strong>{currentBend.foldRotationDeg.value === null ? 'Not established' : currentBend.foldRotationDeg.value + '°'}</strong></div>
                  </div> : null}
                  {currentBend?.directionText.value ? <p className={styles.muted}>{currentBend.directionText.value}</p> : null}
                  {sceneData && currentBend ? <label className={styles.progressControl} htmlFor="fold-preview-progress">
                    <span>Illustrative fold preview</span>
                    <input id="fold-preview-progress" type="range" min="0" max="100" value={Math.round(previewProgress * 100)}
                      onChange={(event) => setPreviewProgress(Number(event.currentTarget.value) / 100)} disabled={!sceneData} />
                    <span className="mono">{Math.round(previewProgress * 100)}% · visual only</span>
                  </label> : null}
                  <div className={styles.stepFooter}>
                    <Button type="button" tone="secondary" onClick={() => advanceStep(-1)} disabled={stepIndex <= 0}>Previous</Button>
                    <span className={styles.muted}>Swipe left or right to change guide step</span>
                    <Button type="button" onClick={() => advanceStep(1)} disabled={stepIndex >= steps.length}>Next</Button>
                  </div>
                  <div className={styles.sourceBlock}>
                    <h3>Released evidence</h3>
                    <EvidenceList evidence={[...currentStep.evidence, ...(currentBend?.finishedAngle.evidence ?? []), ...(currentBend?.foldRotationDeg.evidence ?? [])]} assets={view.sourceAssets} />
                  </div>
                </article>
              ) : (
                <div className={styles.emptyGuide}>
                  <p>{steps.length === 0 ? 'No extra operation guidance was approved for this release. Use the released drawing and workshop process.' : 'You have reached the end of the selected guide.'}</p>
                  {stepIndex > 0 ? <Button type="button" tone="secondary" onClick={() => advanceStep(-1)}>Return to previous operation</Button> : null}
                </div>
              )}
            </PanelBody>
          </Panel>
        </div>
        <aside className={styles.guideSide}>
          <Panel title="Released drawing" eyebrow="Controlled source">
            <PanelBody>
              {drawingAsset ? (
                <div className={styles.assetCard}>
                  <strong>{drawingAsset.filename}</strong>
                  <span className={styles.muted}>Revision {drawingAsset.drawingRevision ?? 'as released'} · verified source asset</span>
                  {documentUrl ? <SourceReference label="Open released drawing" detail="Authorised short-lived link" href={documentUrl} /> : null}
                  <Button type="button" tone="secondary" small disabled={documentBusy} onClick={() => void openDrawingLink()}>
                    {documentBusy ? 'Requesting link…' : 'Load authorised drawing link'}
                  </Button>
                  {documentError ? <p className={styles.error} role="alert">{documentError}</p> : null}
                </div>
              ) : <p className={styles.muted}>No ready PDF drawing is attached to this release.</p>}
            </PanelBody>
          </Panel>
          <Panel title="Release identity" eyebrow="Immutable guide">
            <PanelBody>
              <dl className={styles.releaseDetails}>
                <div><dt>Part</dt><dd>{view.job.partNumber}</dd></div>
                <div><dt>Revision</dt><dd>R{view.release.revisionNumber}</dd></div>
                <div><dt>Released</dt><dd>{new Date(view.release.publishedAt).toLocaleDateString()}</dd></div>
                <div><dt>Session</dt><dd>{view.actor.kind === 'release_visitor' ? 'Release visitor' : view.actor.displayName}</dd></div>
              </dl>
              {view.replacementReleaseId ? (
                view.canFollowReplacement ? <Button type="button" tone="secondary" onClick={() => void followReplacement()}>Follow authorised replacement</Button>
                  : <p className={styles.muted}>A replacement exists, but this session has not been authorised to follow it. Ask the designer for an access link.</p>
              ) : null}
            </PanelBody>
          </Panel>
        </aside>
      </div>
    );
  };

  const renderModel = () => {
    if (!view) return null;
    if (!modelAsset) return <Panel title="Model unavailable" eyebrow="Release asset"><PanelBody><p>No ready verified GLB is attached to this release. No substitute model is shown.</p></PanelBody></Panel>;
    return <Panel title={modelAsset.filename} eyebrow="Supplied final model"><PanelBody>
      <p className={styles.muted}>Orbit or zoom to orient yourself, then choose the relevant operation above. This model has no reviewed clickable operation markers.</p>
      <ModelViewer assetId={modelAsset.id} resolveAssetUrl={async (assetId) => (await client.assets.getLink({ assetId })).url}
      />
    </PanelBody></Panel>;
  };

  const renderAsk = () => {
    if (!view) return null;
    return (
      <div className={styles.narrowColumn}>
        <Panel title="Ask about this operation" eyebrow="Release-bound question">
          <PanelBody>
            <p className={styles.muted}>Your question includes this release and the selected operation. Check any cited evidence before acting; an uncertain answer should go to the designer.</p>
            {view.permissions.canAsk ? (
              <form className={styles.form} onSubmit={(event) => void askQuestion(event)}>
                <TextInput id="floor-question" label="Question for the designer&apos;s released information" value={question}
                  onChange={(event) => setQuestion(event.currentTarget.value)} disabled={asking} placeholder="For example, which face is the reference side?" />
                <Button type="button" tone="secondary" onClick={startVoiceInput} disabled={asking} aria-pressed={listening}>
                  {listening ? 'Stop listening' : 'Speak question'}
                </Button>
                {speechError ? <p className={styles.muted} role="status">{speechError}</p> : null}
                <Button type="submit" disabled={asking || question.trim().length < 3}>{asking ? 'Checking released sources…' : 'Ask this release'}</Button>
              </form>
            ) : <p className={styles.muted}>This release session does not have permission to ask questions.</p>}
            {askError ? <p className={styles.error} role="alert">{askError}</p> : null}
          </PanelBody>
        </Panel>
        {answer ? (
          <Panel title="Answer" eyebrow={answer.evidenceState.replace('_', ' ')}>
            <PanelBody><p className={styles.answerText}>{answer.text}</p><EvidenceList evidence={answer.evidence} assets={view.sourceAssets} />
              {answer.evidenceState !== 'supported' || answer.suggestedFlag ? <Button type="button" tone="secondary" onClick={() => {
                setFlagQuestion(answer.suggestedFlag || question || 'I need a designer to clarify this operation.');
                setTab('flags');
              }}>Flag for designer review</Button> : null}
            </PanelBody>
          </Panel>
        ) : null}
      </div>
    );
  };

  const renderFlags = () => {
    if (!view) return null;
    return (
      <div className={styles.flagsGrid}>
        <div className={styles.narrowColumn}>
          <Panel title="Raise a floor flag" eyebrow={currentStep ? 'Operation ' + currentStep.bendId : 'Published release'}>
            <PanelBody>
              <p className={styles.muted}>This note is stored against the current release and step. Attach a photo only if it helps the designer understand the issue.</p>
              {view.permissions.canFlag ? (
                <form className={styles.form} onSubmit={(event) => void submitFlag(event)}>
                  <label className="field" htmlFor="floor-flag-question">
                    <span className="field__label">What needs the designer&apos;s attention?</span>
                    <textarea id="floor-flag-question" className="field__control" rows={4} maxLength={2000} value={flagQuestion}
                      onChange={(event) => { setFlagQuestion(event.currentTarget.value); flagIdempotencyKey.current = null; }} disabled={flagBusy}
                      placeholder="Describe what is unclear or what you found." />
                  </label>
                  <label className={styles.filePicker} htmlFor="floor-flag-photo">
                    <span className="field__label">Optional issue photo</span>
                    <input id="floor-flag-photo" type="file" accept="image/*" capture="environment" disabled={flagBusy}
                      onChange={(event) => {
                        const selected = event.currentTarget.files?.[0] ?? null;
                        setPhotoFile(selected);
                        setPhotoAsset(null);
                        photoIdempotencyKey.current = null;
                        flagIdempotencyKey.current = null;
                      }} />
                    <span className={styles.muted}>{photoFile ? photoFile.name : 'Choose from camera or photo library · 10 MB maximum'}</span>
                  </label>
                  {photoAsset ? <StatusBadge label={photoAsset.status === 'ready' && photoAsset.sha256 ? 'Photo verified for attachment' : 'Photo not ready to attach'} tone={photoAsset.status === 'ready' && photoAsset.sha256 ? 'complete' : 'review'} /> : null}
                  <Button type="submit" disabled={flagBusy || flagQuestion.trim().length < 3}>{flagBusy ? 'Saving to release…' : 'Save flag to release'}</Button>
                  {flagError ? <p className={styles.error} role="alert">{flagError}</p> : null}
                </form>
              ) : <p className={styles.muted}>This session is read-only for issue reporting.</p>}
              {lastAction ? <p className={styles.success} role="status">{lastAction}</p> : null}
            </PanelBody>
          </Panel>
        </div>
        <section className={styles.flagFeed} aria-label="Release flags and designer responses">
          <div className={styles.flagFeedHeader}>
            <div><p className={styles.eyebrow}>Same release · live refresh</p><h2>Flags and responses</h2></div>
            {flagsLoading ? <StatusBadge label="Refreshing" tone="info" /> : null}
          </div>
          {flagsError ? <p className={styles.error} role="alert">{flagsError}</p> : null}
          {flags === null && !flagsError ? <p className={styles.muted}>Loading release flags…</p> : null}
          {flags?.length === 0 ? <p className={styles.muted}>No flags have been recorded for this release.</p> : null}
          {flags?.map((flag) => <FlagCard key={flag.id} flag={flag} onAcknowledge={(item) => void acknowledge(item)}
            acknowledged={acknowledgedIds.includes(flag.id)} busy={flagBusy} canAcknowledge={view.actor.kind === 'release_visitor'} />)}
        </section>
      </div>
    );
  };

  return (
    <main className={styles.floorShell}>
      <header className={styles.floorHeader}>
        <Link className={styles.brand} href="/" aria-label="Chappe home"><span className={styles.brandMark}>C</span> Chappe <span className={styles.brandDivider}>/</span> Factory floor</Link>
        {view ? <span className={styles.headerPart}>{view.job.partNumber} · R{view.release.revisionNumber}</span> : null}
      </header>
      {loading ? <div className={styles.loading} role="status">Loading this authorised release…</div> : null}
      {loadError ? (
        <Panel title="Release unavailable" eyebrow="No cached or sample data shown">
          <PanelBody><p className={styles.error} role="alert">{loadError}</p><Button type="button" tone="secondary" onClick={() => setReloadToken((token) => token + 1)}>Try again</Button></PanelBody>
        </Panel>
      ) : null}
      {view && !loading ? (
        <>
          <div className={styles.releaseHeading}>
            <div><p className={styles.eyebrow}>{view.job.partFamily}</p><h1>{view.job.title}</h1><p className={styles.muted}>Released revision {view.release.revisionNumber} · {steps.length} selected guide steps</p></div>
            <StatusBadge label="Published release" tone="complete" />
          </div>
          {view.replacementReleaseId && view.canFollowReplacement ? <div className={styles.replacementNotice} role="status">A designer-authorised replacement is available. The current guide stays open until you follow it.
            <Button type="button" tone="secondary" small onClick={() => void followReplacement()}>Follow replacement</Button></div> : null}
          {steps.length > 0 ? <div className={styles.operationJump}>
            <label htmlFor="floor-operation">Jump to an operation</label>
            <select id="floor-operation" value={Math.min(stepIndex, steps.length - 1)} onChange={(event) => {
              setStepIndex(Number(event.currentTarget.value));
              setPreviewProgress(0);
              setAnswer(null);
              setTab('guide');
            }}>
              {steps.map((step, index) => <option key={step.id} value={index}>{index + 1}. {step.bendId} — {step.instruction.slice(0, 64)}</option>)}
            </select>
          </div> : null}
          <nav className={styles.floorTabs} aria-label="Factory floor views" role="tablist">
            {tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} aria-controls={'floor-panel-' + item.id}
              id={'floor-tab-' + item.id} key={item.id} className={tab === item.id ? styles.tabActive : styles.tab}
              onClick={() => setTab(item.id)}>{item.label}{item.id === 'flags' && flags?.length ? <span className={styles.tabCount}>{flags.length}</span> : null}</button>)}
          </nav>
          <section id={'floor-panel-' + tab} role="tabpanel" aria-labelledby={'floor-tab-' + tab} className={styles.floorPanel}>
            {tab === 'guide' ? renderGuide() : null}
            {tab === 'model' ? renderModel() : null}
            {tab === 'ask' ? renderAsk() : null}
            {tab === 'flags' ? renderFlags() : null}
          </section>
          <footer className={styles.floorFooter}>Visual previews are navigation aids. Follow only the reviewed release and your workshop&apos;s approved process.</footer>
        </>
      ) : null}
    </main>
  );
}
