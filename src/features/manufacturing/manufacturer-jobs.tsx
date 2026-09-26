'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Job, WorkshopSnapshot } from '@/contracts';
import { api, type ApiClient } from '@/lib/api/client';
import { Button, StatusBadge, TextInput, buttonClassName } from '@/components/ui';
import styles from './manufacturing.module.css';

export function ManufacturerJobs({ workspaceId, client = api }: { workspaceId: string; client?: Pick<ApiClient,'jobs'|'workshops'> }) {
  const [data,setData]=useState<{jobs:Job[];facilities:WorkshopSnapshot[]}|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [query,setQuery]=useState(''); const [reload,setReload]=useState(0);
  useEffect(()=>{let active=true;
    Promise.all([client.jobs.list({workspaceId}),client.workshops.list({workspaceId})]).then(([jobs,facilities])=>{if(active){setData({jobs:jobs.filter(j=>j.workspaceId===workspaceId),facilities});setError(null);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load manufacturing work.');});
    return()=>{active=false;};
  },[workspaceId,client,reload]);
  const jobs=(data?.jobs??[]).filter(j=>`${j.title} ${j.partNumber}`.toLowerCase().includes(query.toLowerCase()));
  const workspace=`?workspace=${encodeURIComponent(workspaceId)}`;
  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Manufacturing / handoff desk</p>
        <h1>Parts and handoffs</h1>
        <p>Find the part, check its approved information, then open the floor view to ask or flag a question.</p>
      </div>
      <Link className={buttonClassName({tone:'secondary'})} href={`/studio/manufacturing/equipment${workspace}`}>Equipment and capabilities <span aria-hidden="true">↗</span></Link>
    </header>
    <div className={styles.notice}><strong>Scope of this view</strong><span>These are parts visible in your workspace. Visibility does not mean a facility has accepted the work; confirm the selected facility and setup on each part.</span></div>
    {error?<div role="alert" className={styles.error}>{error} <Button tone="secondary" onClick={()=>setReload(v=>v+1)}>Retry</Button></div>:null}
    {!data&&!error?<p role="status">Loading manufacturing work…</p>:null}
    {data?<>
      <section className={styles.section} aria-labelledby="parts-heading">
        <div className={styles.sectionHeader}>
          <div><p className={styles.sectionIndex}>01 / RECEIVED PARTS</p><h2 id="parts-heading">Find a part</h2><p className={styles.muted}>Every row carries the part record, its attached source count, the selected facility, and the current handoff state.</p></div>
          <div className={styles.search}><TextInput id="manufacturer-search" label="Search part name or number" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        </div>
        {!data.jobs.length?<p className={styles.muted}>No parts are shared in this workspace yet. Ask engineering to add the part and select the receiving facility. You can prepare your equipment profile now.</p>:!jobs.length?<p role="status">No parts match “{query}”.</p>:<div className={styles.tableWrap}><table className={styles.handoffTable}><thead><tr><th scope="col">Part</th><th scope="col">Source files</th><th scope="col">Receiving facility</th><th scope="col">Release</th><th scope="col"><span className={styles.srOnly}>Open handoff</span></th></tr></thead><tbody>{jobs.map(job=>{const facility=data.facilities.find(f=>f.id===job.workshopSnapshotId);const approved=Boolean(job.latestReleaseId);return <tr key={job.id}><td><strong className={styles.partTitle}>{job.title}</strong><span className={styles.cellMeta}>{job.partNumber} · {job.partFamily}</span></td><td><strong>{job.sourceAssetIds.length} source file{job.sourceAssetIds.length===1?'':'s'}</strong><span className={styles.cellMeta}>{job.sourceAssetIds.length?'Attached to the part record':'No source attached'}</span></td><td><strong>{facility?.name??(job.workshopSnapshotId?'Selected facility':'Not selected')}</strong><span className={styles.cellMeta}>{facility?.machines.length?`${facility.machines.length} recorded machine${facility.machines.length===1?'':'s'}`:'Review in part details'}</span></td><td><StatusBadge label={approved?'Approved guidance':'Engineering review'} tone={approved?'complete':'review'}/></td><td><Link className={styles.openLink} href={`/studio/manufacturing/jobs/${job.id}${workspace}`}>View part handoff <span aria-hidden="true">↗</span></Link></td></tr>;})}</tbody></table></div>}</section>
      <section className={styles.section} aria-labelledby="facility-heading"><div className={styles.sectionHeader}><div><p className={styles.sectionIndex}>02 / FACILITY EVIDENCE</p><h2 id="facility-heading">Facility evidence</h2><p className={styles.muted}>Keep machine limits, tooling and setup notes current. Unknown information stays unknown until the facility confirms it.</p></div></div>{data.facilities.length?<div className={styles.tableWrap}><table className={styles.handoffTable}><thead><tr><th scope="col">Facility</th><th scope="col">Recorded equipment</th><th scope="col">Evidence state</th><th scope="col">Review</th></tr></thead><tbody>{data.facilities.map(f=>{const confirmed=Boolean(f.confirmedBy&&f.confirmedAt);return <tr key={f.id}><td><strong className={styles.partTitle}>{f.name}</strong><span className={styles.cellMeta}>Facility profile</span></td><td><strong>{f.machines.length} recorded machine{f.machines.length===1?'':'s'}</strong><span className={styles.cellMeta}>{f.machines.length?'Machine details available':'No equipment recorded'}</span></td><td>{confirmed?`Confirmed ${new Date(f.confirmedAt!).toLocaleDateString()}`:'Awaiting facility confirmation'}</td><td><StatusBadge label={confirmed?'Confirmed profile':'Needs confirmation'} tone={confirmed?'complete':'review'}/></td></tr>;})}</tbody></table></div>:<p>No facility profile is recorded yet.</p>}</section>
    </>:null}
  </div>;
}
