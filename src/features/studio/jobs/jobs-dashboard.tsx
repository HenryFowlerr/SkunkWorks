"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Job, Role } from "@/contracts";
import { Button, Panel, PanelBody, StatusBadge, buttonClassName } from "@/components/ui";
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

export function JobsDashboard({
  workspaceId,
  role = "designer",
  onOpenJob,
}: {
  workspaceId: string;
  role?: Role;
  onOpenJob?: (job: Job) => void;
}) {
  const isFabricator = role === "fabricator";
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const isLoading = loading || loadedWorkspaceId !== workspaceId;
  const visibleJobs = loadedWorkspaceId === workspaceId
    ? jobs.filter((job) => job.workspaceId === workspaceId)
    : [];

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
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{isFabricator ? "Workshop workspace" : "Designer workspace"}</p>
          <h1>{isFabricator ? "Workshop jobs" : "Jobs"}</h1>
          <p className={styles.muted}>{isFabricator
            ? "Review the selected setup and guide before work begins. Open a job to see its source and current review state."
            : "Source-backed work moving from design review to the factory floor."}</p>
        </div>
        <div className={styles.headingActions}>
          {isFabricator ? null : <Link className={buttonClassName()} href={`/studio/jobs/new?workspace=${encodeURIComponent(workspaceId)}`}>Start job</Link>}
          <Button type="button" tone="secondary" onClick={() => { setLoading(true); setError(null); setReloadVersion((value) => value + 1); }} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh jobs"}
          </Button>
        </div>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {error && visibleJobs.length > 0 ? <p className={styles.muted} role="status">Showing the last loaded jobs; refresh did not complete.</p> : null}
      <Panel title="Workspace jobs" eyebrow="Live records">
        <PanelBody>
          {isLoading && visibleJobs.length === 0 ? <p className={styles.muted} role="status">Loading jobs from this workspace…</p> : null}
          {!isLoading && !error && visibleJobs.length === 0 ? (
            <div>
              <p className={styles.muted}>No jobs have been created in this workspace yet.</p>
              <p className={styles.muted}>{isFabricator
                ? "When a designer shares a job with this workspace, its drawing, setup and guide review will appear here."
                : "Start a job intake to attach a drawing, model and confirmed workshop machine."}</p>
            </div>
          ) : null}
          {visibleJobs.length > 0 ? (
            <ul className={styles.jobList} aria-label="Jobs">
              {visibleJobs.map((job) => {
                const stage = jobStage(job);
                return (
                  <li className={styles.jobCard} key={job.id}>
                    <div className={styles.jobMain}>
                      <p className={styles.eyebrow}>{job.partNumber}</p>
                      <h3 className={styles.jobTitle}>{job.title}</h3>
                      <div className={styles.jobMeta}>
                        <span>{job.partFamily}</span>
                        <span>{job.sourceAssetIds.length} source asset{job.sourceAssetIds.length === 1 ? "" : "s"}</span>
                        <span>Updated record v{job.version}</span>
                      </div>
                    </div>
                    <div className={styles.jobAction}>
                      <StatusBadge label={stage.label} tone={stage.tone} />
                      {onOpenJob ? (
                        <Button type="button" tone="secondary" small onClick={() => onOpenJob(job)}>
                          Open job
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  );
}
