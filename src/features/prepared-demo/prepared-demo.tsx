'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  PitchDemoInsightSchema,
  PitchDemoPackageSchema,
  PitchMobilePreviewAnswerSchema,
  type PitchDemoInsight,
  type PitchDemoPackage,
  type PitchMobilePreviewAnswer,
} from '@/contracts';
import styles from './prepared-demo.module.css';

type Envelope<T> = { data: T };

async function request<T>(path: string, schema: { parse(value: unknown): T }, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    cache: 'no-store',
  });
  const payload = await response.json() as { data?: unknown; error?: { message?: string } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? 'The prepared demo request failed.');
  return schema.parse((payload as Envelope<unknown>).data);
}

function usePackage() {
  const [value, setValue] = useState<PitchDemoPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void request('/api/demo/engineering-test-block', PitchDemoPackageSchema)
      .then((next) => { if (active) { setValue(next); setError(null); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'The prepared package could not be loaded.'); });
    return () => { active = false; };
  }, []);
  return { value, error };
}

function Citation({ sourceKey, excerpt }: { sourceKey: string; excerpt: string }) {
  return <p className={styles.citation}><code>{sourceKey}</code> <span>“{excerpt}”</span></p>;
}

function PackageHeader({ value, view }: { value: PitchDemoPackage; view: 'engineering' | 'floor' }) {
  return <header className={styles.hero}>
    <div><p className={styles.eyebrow}>Prepared pitch · {view === 'engineering' ? 'Engineer desk' : 'Floor phone view'}</p><h1>{value.partName}</h1><p>{value.partNumber}</p></div>
    <span className={styles.ready}>Knowledge base ready</span>
  </header>;
}

function Loading({ error }: { error: string | null }) {
  return <main className={styles.shell}>{error ? <p className={styles.error} role="alert">{error}</p> : <p role="status">Loading prepared Engineering Test Block…</p>}</main>;
}

export function PreparedEngineeringDemo() {
  const { value, error } = usePackage();
  const [insights, setInsights] = useState<PitchDemoInsight[]>([]);
  const [insightError, setInsightError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => void request('/api/demo/engineering-test-block/insights', { parse: (data: unknown) => PitchDemoInsightSchema.array().parse(data) })
      .then((next) => { if (active) { setInsights(next); setInsightError(null); } })
      .catch((cause: unknown) => { if (active) setInsightError(cause instanceof Error ? cause.message : 'The insight inbox could not be refreshed.'); });
    load();
    const timer = window.setInterval(load, 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!value) return <Loading error={error} />;
  const { capability, knowledgeBase } = value;
  return <main className={styles.shell}>
    <PackageHeader value={value} view="engineering" />
    <section className={styles.inputCard} aria-label="Prepared inputs">
      <p className={styles.eyebrow}>Pre-uploaded project inputs</p>
      {value.inputFiles.map((file) => <div key={file.name} className={styles.fileRow}><div><strong>{file.name}</strong><span>{file.kind}</span></div><b>{file.status}</b></div>)}
    </section>
    <section className={styles.grid}>
      <article className={styles.card}><p className={styles.eyebrow}>Astra capability check</p><h2>{capability.title}</h2><p>{capability.explanation}</p>{capability.checks.map((check) => <div key={check.id} className={styles.check}><strong>{check.label}</strong><p>{check.reason}</p>{check.citations.map((citation, index) => <Citation key={index} {...citation} />)}</div>)}</article>
      <article className={styles.card}><p className={styles.eyebrow}>Astra knowledge base</p><h2>{knowledgeBase.title}</h2><p>{knowledgeBase.partSummary}</p><div className={styles.attentionList}>{knowledgeBase.attentionPoints.map((point) => <div key={point.title} className={styles.attention}><strong>{point.title}</strong><p>{point.instruction}</p></div>)}</div><Link className={styles.primary} href="/prepared-demo/floor">Open the mobile chat</Link></article>
    </section>
    <section className={styles.inbox} aria-live="polite" aria-label="Floor insights">
      <header><div><p className={styles.eyebrow}>Engineer insight inbox</p><h2>{insights.length ? `${insights.length} floor insight${insights.length === 1 ? '' : 's'} received` : 'Waiting for a floor insight'}</h2></div><span className={insights.length ? styles.notification : styles.ready}>{insights.length ? 'New insight' : 'Live'}</span></header>
      {insightError ? <p className={styles.error} role="alert">{insightError}</p> : null}
      {insights.map((item) => <article key={item.id} className={styles.insight}><p className={styles.eyebrow}>Luna draft · hold remains active</p><h3>{item.triage.title}</h3><p>{item.triage.summary}</p><dl><dt>Engineer decision</dt><dd>{item.triage.engineerDecisionNeeded}</dd><dt>Suggested reply</dt><dd>{item.triage.suggestedReply}</dd></dl></article>)}
      {!insights.length && !insightError ? <p className={styles.muted}>Ask a question or send a concern from the mobile view. Luna will turn the observation into a concise engineer report.</p> : null}
    </section>
  </main>;
}

export function PreparedFloorDemo() {
  const { value, error } = usePackage();
  const [question, setQuestion] = useState('What should I confirm before starting?');
  const [answer, setAnswer] = useState<PitchMobilePreviewAnswer | null>(null);
  const [issue, setIssue] = useState('The internal passage orientation is unclear at setup.');
  const [busy, setBusy] = useState<'question' | 'insight' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!value) return <Loading error={error} />;
  const ask = async () => {
    setBusy('question'); setMessage(null);
    try {
      const next = await request('/api/demo/engineering-test-block/questions', PitchMobilePreviewAnswerSchema, { method: 'POST', body: JSON.stringify({ question }) });
      setAnswer(next);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The phone answer could not be created.'); }
    finally { setBusy(null); }
  };
  const flag = async () => {
    setBusy('insight'); setMessage(null);
    try {
      const created = await request('/api/demo/engineering-test-block/insights', PitchDemoInsightSchema, { method: 'POST', body: JSON.stringify({ operation: null, text: issue }) });
      setMessage(`Sent to engineering: ${created.triage.title}. The report remains on hold until an engineer responds.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The floor insight could not be sent.'); }
    finally { setBusy(null); }
  };

  return <main className={`${styles.shell} ${styles.phone}`}>
    <PackageHeader value={value} view="floor" />
    <section className={styles.modelCard}><div className={styles.modelShape} aria-hidden="true"><i /><i /><i /></div><div><strong>Engineering Test Block</strong><p>Prepared 3D reference · supplied STL</p></div></section>
    <section className={styles.card}><p className={styles.eyebrow}>Watch points</p>{value.knowledgeBase.attentionPoints.map((point) => <div className={styles.attention} key={point.title}><strong>{point.title}</strong><p>{point.instruction}</p></div>)}</section>
    <section className={styles.card} aria-label="Ask the part knowledge base"><p className={styles.eyebrow}>Ask the knowledge base</p><textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} rows={3} /><button className={styles.primary} type="button" disabled={busy !== null || question.trim().length < 4} onClick={() => void ask()}>{busy === 'question' ? 'Checking…' : 'Ask Luna'}</button>{answer ? <div className={styles.answer}><strong>{answer.evidenceState.replaceAll('_', ' ')}</strong><p>{answer.text}</p>{answer.suggestedEngineerReview ? <p className={styles.muted}>{answer.suggestedEngineerReview}</p> : null}</div> : null}</section>
    <section className={styles.card} aria-label="Send a floor insight"><p className={styles.eyebrow}>Need engineering input?</p><textarea value={issue} onChange={(event) => setIssue(event.target.value)} maxLength={1000} rows={3} /><button className={styles.secondary} type="button" disabled={busy !== null || issue.trim().length < 4} onClick={() => void flag()}>{busy === 'insight' ? 'Creating report…' : 'Send insight to engineer'}</button></section>
    {message ? <p className={styles.message} role="status">{message}</p> : null}
    <Link className={styles.back} href="/prepared-demo/engineering">View engineer desk</Link>
  </main>;
}
