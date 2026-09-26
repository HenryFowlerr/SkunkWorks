"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Job, Role } from "@/contracts";
import { Button, StatusBadge, TextInput, buttonClassName } from "@/components/ui";
import { api } from "@/lib/api/client";
import styles from "./jobs.module.css";

function jobStage(job: Job) {
  if (job.latestReleaseId) return { label: "Released", tone: "complete" as const };
  if (job.draftId) return { label: "Draft in review", tone: "review" as const };
  if (job.sourceAssetIds.length >= 2 && job.workshopSnapshotId && job.machineId) {
    return { label: "Inputs attached", tone: "info" as const };
  }
  if (job.sourceAssetIds.length > 0) return { label: "Intake incomplete", tone: "review" as const };
  return { label: "Intake", tone: "neutral" as const };
}

function sourceSummary(job: Job) {
  const count = job.sourceAssetIds.length;
  return {
    label: count === 0 ? "No source files" : `${count} source file${count === 1 ? "" : "s"} attached`,
    detail: count === 0 ? "Attach source evidence." : "Open the project to inspect the retained files.",
  };
}

function facilitySummary(job: Job) {
  if (!job.workshopSnapshotId) {
    return { label: "Not selected", detail: "No documented facility profile is recorded." };
  }
  if (!job.machineId) {
    return { label: "Profile selected", detail: "Select the workshop machine before review." };
  }
  return { label: "Profile and machine selected", detail: "Recorded facility context is ready for review." };
}

function releaseSummary(job: Job) {
  if (job.latestReleaseId) return "A published handoff is available to the floor.";
  if (job.draftId) return "A draft exists and still needs engineering review.";
  return "No handoff has been published.";
}

function nextAction(job: Job, isFabricator: boolean) {
  if (job.sourceAssetIds.length === 0) return "Attach source files";
  if (job.sourceAssetIds.length === 1) return "Complete the source set";
  if (!job.workshopSnapshotId) return "Select a facility profile";
  if (!job.machineId) return "Select a workshop machine";
  if (job.latestReleaseId) return isFabricator ? "Review the released handoff" : "Review the current release";
  if (job.draftId) return isFabricator ? "Await the reviewed release" : "Review the draft";
  return isFabricator ? "Await engineering review" : "Start the engineering review";
}

export function JobsDashboard({
  workspaceId,
  role = "designer",
  onOpenJob,
}: {
  workspaceId: string;
  role?: Role;
  onOpenJob?: (job: Job) => void;
}) {
  const [query, setQuery] = useState("");
  const isFabricator = role === "fabricator";
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const isLoading = loading || loadedWorkspaceId !== workspaceId;
  const visibleJobs = loadedWorkspaceId === workspaceId
    ? jobs.filter((job) => job.workspaceId === workspaceId && `${job.title} ${job.partNumber}`.toLowerCase().includes(query.toLowerCase()))
    : [];
  const projectCountLabel = isLoading
    ? "Loading project index"
    : `${visibleJobs.length} ${visibleJobs.length === 1 ? "project" : "projects"}${query ? " match this search" : " in this workspace"}`;

  useEffect(() => {
    let active = true;
    void api.jobs.list({ workspaceId }).then((result) => {
      if (!active) return;
      setJobs(result);
      setLoadedWorkspaceId(workspaceId);
      setError(null);
    }).catch((caught: unknown) => {
      if (!active) return;
      setLoadedWorkspaceId(workspaceId);
      setError(caught instanceof Error ? caught.message : "Jobs could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [workspaceId, reloadVersion]);

  return (
    <div className={styles.stack}>
      <div className={styles.dashboardHeading}>
        <div className={styles.dashboardIntro}>
          <p className={styles.eyebrow}>{isFabricator ? "Workshop workspace" : "Engineering workspace"}</p>
          <h1>{isFabricator ? "Workshop jobs" : "Projects and handoffs"}</h1>
          <p className={styles.muted}>{isFabricator
            ? "See the shared source count, documented facility context, and handoff state before opening a job."
            : "Keep each part, its retained source files, selected facility profile, and handoff state together in one working index."}</p>
        </div>
        <div className={styles.dashboardHeadingActions}>
          {isFabricator ? null : <Link className={buttonClassName()} href={`/studio/jobs/new?workspace=${encodeURIComponent(workspaceId)}`}>Start job</Link>}
          <Button type="button" tone="secondary" onClick={() => { setLoading(true); setError(null); setReloadVersion((value) => value + 1); }} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh jobs"}
          </Button>
        </div>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {error && visibleJobs.length > 0 ? <p className={styles.muted} role="status">Showing the last loaded jobs; refresh did not complete.</p> : null}
      <section className={styles.projectIndex} aria-labelledby="project-index-heading">
        <div className={styles.projectIndexHeader}>
          <div>
            <p className={styles.eyebrow}>Project index</p>
            <h2 id="project-index-heading">Current project records</h2>
            <p className={styles.muted}>Compare what has been attached, selected, reviewed, and released without opening each record.</p>
          </div>
          <p className={styles.projectCount} aria-live="polite">{projectCountLabel}</p>
        </div>

        <div className={styles.projectIndexTools}>
          <TextInput id="engineer-part-search" label="Search part name or number" value={query} onChange={event => setQuery(event.target.value)} />
          <p className={styles.indexNote}>This index shows current source-file counts. Open a project for the individual files and evidence.</p>
        </div>

        <div className={styles.jobSection} aria-label="Workspace jobs">
          {isLoading && visibleJobs.length === 0 ? <p className={styles.muted} role="status">Loading jobs from this workspace…</p> : null}
          {!isLoading && !error && visibleJobs.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{query ? `No parts match “${query}”.` : "No jobs have been created in this workspace yet."}</p>
              <p className={styles.muted}>{isFabricator
                ? "When a designer shares a job with this workspace, its drawing, setup and guide review will appear here."
                : "Start a job intake to attach a drawing, model and confirmed workshop machine."}</p>
            </div>
          ) : null}
          {visibleJobs.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.jobTable}>
                <caption className={styles.screenReaderOnly}>Current projects with source-file, facility, handoff, and next-action state.</caption>
                <thead>
                  <tr>
                    <th scope="col">Project / part</th>
                    <th scope="col">Source files</th>
                    <th scope="col">Facility / machine</th>
                    <th scope="col">Handoff state</th>
                    <th scope="col">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => {
                    const stage = jobStage(job);
                    const source = sourceSummary(job);
                    const facility = facilitySummary(job);
                    return (
                      <tr key={job.id}>
                        <th className={styles.projectCell} scope="row" data-label="Project / part">
                          <span className={styles.partNumber}>{job.partNumber}</span>
                          <strong className={styles.jobTitle}>{job.title}</strong>
                          <span className={styles.cellDetail}>{job.partFamily} · record v{job.version}</span>
                        </th>
                        <td data-label="Source files">
                          <strong className={styles.cellPrimary}>{source.label}</strong>
                          <span className={styles.cellDetail}>{source.detail}</span>
                        </td>
                        <td data-label="Facility / machine">
                          <strong className={styles.cellPrimary}>{facility.label}</strong>
                          <span className={styles.cellDetail}>{facility.detail}</span>
                        </td>
                        <td data-label="Handoff state">
                          <div className={styles.handoffState}>
                            <StatusBadge label={stage.label} tone={stage.tone} />
                            <span className={styles.cellDetail}>{releaseSummary(job)}</span>
                          </div>
                        </td>
                        <td data-label="Next action">
                          <div className={styles.nextActionCell}>
                            <span className={styles.nextActionLabel}>{nextAction(job, isFabricator)}</span>
                            {onOpenJob ? (
                              <Button type="button" tone="secondary" small onClick={() => onOpenJob(job)}>
                                Open job
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
