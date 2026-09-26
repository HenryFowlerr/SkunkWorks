"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Asset, FacilityCheckResult, FacilityRequirement } from "@/contracts";
import { Button, Panel, PanelBody, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api/client";
import styles from "./facility-check-panel.module.css";

type Kind = FacilityRequirement["kind"];

const KIND_LABELS: Record<Kind, string> = {
  bend_length: "Usable bend length",
  process: "Named process",
  tool: "Named tool",
  access: "Operation access or sequence",
};

export function FacilityCheckPanel({ jobId }: { jobId: string }) {
  const [jobVersion, setJobVersion] = useState<number | null>(null);
  const [drawings, setDrawings] = useState<Asset[]>([]);
  const [kind, setKind] = useState<Kind>("bend_length");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [assetId, setAssetId] = useState("");
  const [page, setPage] = useState("1");
  const [excerpt, setExcerpt] = useState("");
  const [result, setResult] = useState<FacilityCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void api.jobs.get({ jobId }).then(({ job, assets }) => {
      if (!active) return;
      setJobVersion(job.version);
      const readyDrawings = assets.filter((asset) => asset.kind === "drawing_pdf" && asset.status === "ready" && job.sourceAssetIds.includes(asset.id));
      setDrawings(readyDrawings);
      setAssetId((current) => readyDrawings.some((asset) => asset.id === current) ? current : readyDrawings[0]?.id ?? "");
      setError(null);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "The job could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [jobId, reload]);

  async function runCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setError(null);
    if (!jobVersion || !assetId) {
      setError("Attach a ready drawing and select a workshop machine before checking.");
      return;
    }
    const source = { assetId, page: Number(page), excerpt: excerpt.trim() };
    const common = { id: crypto.randomUUID(), label: label.trim(), source };
    const requirement: FacilityRequirement = kind === "bend_length"
      ? { ...common, kind, requiredMm: Number(value) }
      : kind === "process"
        ? { ...common, kind, requiredProcess: value.trim() }
        : kind === "tool"
          ? { ...common, kind, requiredTool: value.trim() }
          : { ...common, kind, operation: value.trim() };

    setChecking(true);
    try {
      const checked = await api.jobs.checkFacility({ jobId, expectedJobVersion: jobVersion, requirements: [requirement] });
      setResult(checked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The facility check could not be completed.");
    } finally {
      setChecking(false);
    }
  }

  const assessment = result?.assessments[0];
  return (
    <Panel title="Facility evidence check" eyebrow="Engineer review">
      <PanelBody>
        <div className={styles.stack}>
          <p className={styles.help}>Compare a requirement you transcribe from an attached drawing with the selected workshop profile. The excerpt and page are entered by you; this preview does not verify them against the PDF or save a release decision.</p>
          {loading ? <p role="status">Loading selected job…</p> : null}
          {error ? <div className={styles.error} role="alert">{error} <Button type="button" small tone="secondary" onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Reload job</Button></div> : null}
          {!loading && drawings.length === 0 ? <p className={styles.notice}>Attach a drawing PDF to this job before running a cited check.</p> : null}
          <form className={styles.form} onSubmit={runCheck}>
            <label className={styles.field}>Requirement to compare
              <select value={kind} onChange={(event) => { setKind(event.target.value as Kind); setResult(null); }} disabled={loading || checking}>
                {Object.entries(KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className={styles.field}>Operation or part label
              <input required maxLength={160} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Bend B03" disabled={loading || checking} />
            </label>
            <label className={styles.field}>{kind === "bend_length" ? "Required bend length (mm)" : kind === "process" ? "Required process" : kind === "tool" ? "Required tool name" : "Access or sequence question"}
              {kind === "bend_length"
                ? <input required type="number" min="0.001" step="any" value={value} onChange={(event) => setValue(event.target.value)} disabled={loading || checking} />
                : <input required maxLength={kind === "access" ? 1000 : 160} value={value} onChange={(event) => setValue(event.target.value)} placeholder={kind === "access" ? "Can the tool reach both angled operations?" : undefined} disabled={loading || checking} />}
            </label>
            <div className={styles.sourceRow}>
              <label className={styles.field}>Drawing source
                <select required value={assetId} onChange={(event) => setAssetId(event.target.value)} disabled={loading || checking || drawings.length === 0}>
                  {drawings.length === 0 ? <option value="">No ready drawing</option> : null}
                  {drawings.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}
                </select>
              </label>
              <label className={styles.field}>Page
                <input required type="number" min="1" step="1" value={page} onChange={(event) => setPage(event.target.value)} disabled={loading || checking} />
              </label>
            </div>
            <label className={styles.field}>Relevant drawing text
              <textarea required maxLength={1000} rows={2} value={excerpt} onChange={(event) => setExcerpt(event.target.value)} placeholder="Transcribe the stated requirement from the drawing" disabled={loading || checking} />
            </label>
            <div className={styles.actions}>
              <Button type="submit" disabled={loading || checking || drawings.length === 0}>{checking ? "Checking…" : "Compare with facility"}</Button>
              <Button type="button" tone="secondary" disabled={loading || checking} onClick={() => { setLoading(true); setResult(null); setReload((value) => value + 1); }}>Refresh job inputs</Button>
            </div>
          </form>
          {assessment && result ? (
            <div className={styles.result} role="status">
              <div className={styles.resultHead}>
                <strong>{assessment.requirement.label}</strong>
                <StatusBadge label={assessment.status} tone={assessment.status === "conflict" ? "review" : assessment.status === "supported" ? "complete" : "neutral"} />
              </div>
              <p>{assessment.explanation}</p>
              <p className={styles.detail}>Drawing: {drawings.find((asset) => asset.id === assessment.requirement.source.assetId)?.filename ?? "attached drawing"}, page {assessment.requirement.source.page} · “{assessment.requirement.source.excerpt}”</p>
              <p className={styles.detail}>Facility: {result.workshopName} v{result.workshopVersion} · {result.machineName}</p>
              {assessment.facilityBasis.map((basis) => <p className={styles.detail} key={basis}>{basis}</p>)}
              <p className={styles.caveat}>This is a documented-profile comparison, not a physical manufacturability approval. The result is a preview and is not yet part of the published release gate.</p>
            </div>
          ) : null}
        </div>
      </PanelBody>
    </Panel>
  );
}
