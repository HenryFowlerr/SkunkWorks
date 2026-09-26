'use client';

import { useState } from 'react';
import type { Id, PitchAnalysisResult, PitchCapabilityCheck, PitchCitation, PitchIssueTriage, PitchKnowledgeBase } from '@/contracts';
import { Button, Field, Panel, PanelBody, StatusBadge } from '@/components/ui';
import type { ApiClient } from '@/lib/api/client';
import { ApiClientError } from '@/lib/api/client';
import styles from '../review.module.css';

type PitchApi = Pick<ApiClient, 'jobs'>;

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ENDPOINT_UNAVAILABLE') {
    return 'Pitch analysis is not configured on this deployment. No draft was created.';
  }
  return error instanceof Error ? error.message : 'Pitch analysis could not be completed. No draft was created.';
}

function CitationList({ citations }: { citations: PitchCitation[] }) {
  if (!citations.length) return <p className={styles.subtle}>No source citation was returned for this observation.</p>;
  return <ul className={styles.pitchCitations}>{citations.map((citation, index) => <li key={`${citation.sourceKey}-${index}`}><code>{citation.sourceKey}</code><span>“{citation.excerpt}”</span></li>)}</ul>;
}

function capabilityTone(decision: PitchCapabilityCheck['decision']) {
  return decision === 'clear_for_engineer_review' ? 'complete' : decision === 'blocked' ? 'blocked' : 'review';
}

function CapabilityResult({ value }: { value: PitchCapabilityCheck }) {
  return <article className={styles.pitchResult} aria-label="Capability check draft">
    <header className={styles.findingHeader}><div><p className={styles.eyebrow}>Draft result · {value.code}</p><h3>{value.title}</h3></div><StatusBadge label={value.decision.replaceAll('_', ' ')} tone={capabilityTone(value.decision)} /></header>
    <p>{value.explanation}</p>
    <div className={styles.pitchRows}>{value.checks.map((check) => <section key={check.id} className={styles.pitchRow}><header><strong>{check.label}</strong><StatusBadge label={check.status} tone={check.status === 'supported' ? 'complete' : check.status === 'conflict' ? 'blocked' : 'review'} /></header><p>{check.reason}</p><CitationList citations={check.citations} /></section>)}</div>
    {value.requiredEngineerDecisions.length ? <div className={styles.pitchDecisionList}><strong>Engineer decisions still needed</strong><ul>{value.requiredEngineerDecisions.map((decision) => <li key={decision}>{decision}</li>)}</ul></div> : null}
  </article>;
}

function KnowledgeBaseResult({ value }: { value: PitchKnowledgeBase }) {
  return <article className={styles.pitchResult} aria-label="Knowledge-base draft">
    <header className={styles.findingHeader}><div><p className={styles.eyebrow}>Draft knowledge base</p><h3>{value.title}</h3></div><StatusBadge label="Engineer review required" tone="review" /></header>
    <section className={styles.pitchTextClaim}><strong>Part summary</strong><p>{value.partSummary}</p><CitationList citations={value.partSummaryCitations} /></section>
    <section className={styles.pitchTextClaim}><strong>Source summary</strong><p>{value.sourceSummary}</p><CitationList citations={value.sourceSummaryCitations} /></section>
    <div className={styles.pitchRows}>
      {value.operatorSteps.map((step) => <section key={step.id} className={styles.pitchRow}><header><strong>{step.title}</strong><StatusBadge label={step.guidanceKind} tone={step.guidanceKind === 'attention' ? 'review' : 'neutral'} /></header><p>{step.instruction}</p><CitationList citations={step.citations} /></section>)}
      {value.attentionPoints.map((point) => <section key={point.title} className={styles.pitchRow}><header><strong>{point.title}</strong><StatusBadge label="Attention" tone="review" /></header><p>{point.instruction}</p><p className={styles.subtle}>{point.reason}</p><CitationList citations={point.citations} /></section>)}
    </div>
    {value.openQuestions.length ? <div className={styles.pitchDecisionList}><strong>Open questions</strong><ol>{value.openQuestions.map((question, index) => <li key={`${question}-${index}`}><span>{question}</span><CitationList citations={value.openQuestionCitations[index] ?? []} /></li>)}</ol></div> : null}
  </article>;
}

function TriageResult({ value }: { value: PitchIssueTriage }) {
  return <article className={styles.pitchResult} aria-label="Engineer triage draft">
    <header className={styles.findingHeader}><div><p className={styles.eyebrow}>Draft issue triage</p><h3>{value.title}</h3></div><StatusBadge label={value.severity} tone={value.severity === 'hold' ? 'blocked' : 'review'} /></header>
    <p>{value.summary}</p>
    <div className={styles.pitchDecisionList}><strong>Known evidence</strong><ul>{value.knownEvidence.map((item, index) => <li key={`${item}-${index}`}><span>{item}</span><CitationList citations={value.knownEvidenceCitations[index] ?? []} /></li>)}</ul></div>
    {value.unknowns.length ? <div className={styles.pitchDecisionList}><strong>Unknowns</strong><ul>{value.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    <div className={styles.pitchTextClaim}><strong>Engineer decision needed</strong><p>{value.engineerDecisionNeeded}</p></div>
    <div className={styles.responseBox}><strong>Suggested reply — still a draft</strong><p>{value.suggestedReply}</p></div>
    <CitationList citations={value.citations} />
  </article>;
}

/** A non-persistent, readable-PDF workflow kept separate from bend-guide generation. */
export function PitchAnalysisPanel({
  jobId,
  jobVersion,
  hasDrawing,
  hasSupplierSelection,
  client,
}: {
  jobId: Id;
  jobVersion: number;
  hasDrawing: boolean;
  hasSupplierSelection: boolean;
  client: PitchApi;
}) {
  const [capability, setCapability] = useState<PitchCapabilityCheck | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState<PitchKnowledgeBase | null>(null);
  const [triage, setTriage] = useState<PitchIssueTriage | null>(null);
  const [issueText, setIssueText] = useState('');
  const [operation, setOperation] = useState('');
  const [busy, setBusy] = useState<'capability' | 'knowledge_base' | 'triage' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blockers = [
    ...(hasDrawing ? [] : ['Attach a ready, verified drawing PDF.']),
    ...(hasSupplierSelection ? [] : ['Select a supplier snapshot and machine on the job.']),
  ];

  async function request(action: 'capability' | 'knowledge_base' | 'triage') {
    if (busy || blockers.length) return;
    if (action === 'triage' && issueText.trim().length < 4) {
      setError('Describe the floor issue in at least four characters before creating a triage draft.');
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const input = action === 'triage'
        ? { jobId, expectedJobVersion: jobVersion, action, issue: { operation: operation.trim() || null, text: issueText.trim() } }
        : { jobId, expectedJobVersion: jobVersion, action };
      const result: PitchAnalysisResult = await client.jobs.pitch(input);
      if (result.action === 'capability') {
        setCapability(result.capability);
        setKnowledgeBase(null);
        setTriage(null);
      } else if (result.action === 'knowledge_base') {
        setCapability(result.capability);
        setKnowledgeBase(result.knowledgeBase);
        setTriage(null);
      } else {
        setTriage(result.triage);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  const canCreateKnowledgeBase = capability?.decision === 'clear_for_engineer_review';
  return <Panel id="pitch-analysis" title="Pitch analysis for readable drawings" eyebrow="Non-persistent engineer draft">
    <PanelBody>
      <div className={styles.pitchPanel}>
        <p className={styles.subtle}>Use this flow for the uploaded PDF and selected supplier profile, including the Engineering Test Block. The STL stays a visual reference. Results are cited drafts only: they cannot publish a QR guide, authorize machining, or send a floor reply.</p>
        {blockers.length ? <ul className={styles.blockerList}>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.pitchActions}>
          <Button type="button" disabled={Boolean(busy) || blockers.length > 0} onClick={() => void request('capability')}>{busy === 'capability' ? 'Checking supplier…' : 'Run supplier capability check'}</Button>
          <Button type="button" tone="secondary" disabled={Boolean(busy) || blockers.length > 0 || !canCreateKnowledgeBase} onClick={() => void request('knowledge_base')}>{busy === 'knowledge_base' ? 'Creating draft…' : 'Create knowledge-base draft'}</Button>
        </div>
        {capability ? <CapabilityResult value={capability} /> : null}
        {capability && !canCreateKnowledgeBase ? <p className={styles.subtle}>A knowledge-base draft stays unavailable until the capability result is clear for engineer review.</p> : null}
        {knowledgeBase ? <KnowledgeBaseResult value={knowledgeBase} /> : null}
        {knowledgeBase ? <section className={styles.pitchFlagForm} aria-label="Floor issue triage preview">
          <h3>Floor issue to triage</h3><p className={styles.subtle}>This creates an engineer-facing draft only. Use the controlled release flag workflow to record and approve any actual reply.</p>
          <Field id="pitch-affected-operation" label="Affected operation (optional)"><input id="pitch-affected-operation" className="field__control" maxLength={180} value={operation} onChange={(event) => setOperation(event.target.value)} placeholder="e.g. drilling pattern" /></Field>
          <Field id="pitch-floor-issue" label="Floor report"><textarea id="pitch-floor-issue" className="field__control" rows={3} maxLength={1000} value={issueText} onChange={(event) => setIssueText(event.target.value)} placeholder="Describe what is unclear or preventing progress…" /></Field>
          <Button type="button" tone="secondary" disabled={Boolean(busy) || blockers.length > 0 || issueText.trim().length < 4} onClick={() => void request('triage')}>{busy === 'triage' ? 'Creating triage…' : 'Create engineer triage draft'}</Button>
        </section> : null}
        {triage ? <TriageResult value={triage} /> : null}
      </div>
    </PanelBody>
  </Panel>;
}
