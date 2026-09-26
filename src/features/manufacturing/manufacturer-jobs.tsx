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
    <header className={styles.header}><div><p>Manufacturing</p><h1>Parts and handoffs</h1><p>Find the part, check its approved information, then open the floor view to ask or flag a question.</p></div><Link className={buttonClassName({tone:'secondary'})} href={`/studio/manufacturing/equipment${workspace}`}>Equipment and capabilities</Link></header>
    <div className={styles.notice}>These are parts visible in your workspace. Workspace access does not mean a facility has accepted the work. Confirm the selected facility and setup on each part.</div>
    {error?<div role="alert" className={styles.error}>{error} <Button tone="secondary" onClick={()=>setReload(v=>v+1)}>Retry</Button></div>:null}
    {!data&&!error?<p role="status">Loading manufacturing work…</p>:null}
    {data?<><section className={styles.section}><h2>Find a part</h2><div className={styles.search}><TextInput id="manufacturer-search" label="Search part name or number" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    {!data.jobs.length?<p className={styles.muted}>No parts are shared in this workspace yet. Ask engineering to add the part and select the receiving facility. You can prepare your equipment profile now.</p>:!jobs.length?<p role="status">No parts match “{query}”.</p>:<ul className={styles.list}>{jobs.map(job=>{const facility=data.facilities.find(f=>f.id===job.workshopSnapshotId);return <li className={styles.row} key={job.id}><div><h3>{job.title}</h3><p className={styles.muted}>{job.partNumber} · {facility?.name??(job.workshopSnapshotId?'Selected facility · see part details':'Receiving facility not selected')}</p><StatusBadge label={job.latestReleaseId?'Approved guidance available':'Engineering approval pending'} tone={job.latestReleaseId?'complete':'review'}/></div><Link className={buttonClassName({tone:'secondary'})} href={`/studio/manufacturing/jobs/${job.id}${workspace}`}>View part handoff</Link></li>;})}</ul>}</section>
    <section className={styles.section}><h2>Facility evidence</h2><p className={styles.muted}>Keep machine limits, tooling and setup notes current. Unknown information stays unknown until the facility confirms it.</p><ul className={styles.list}>{data.facilities.map(f=><li key={f.id} className={styles.row}><div><strong>{f.name}</strong><p className={styles.muted}>{f.machines.length} recorded machines · {f.confirmedAt?`Confirmed ${new Date(f.confirmedAt).toLocaleDateString()}`:'Awaiting confirmation'}</p></div><StatusBadge label={f.confirmedBy&&f.confirmedAt?'Confirmed profile':'Needs confirmation'} tone={f.confirmedBy&&f.confirmedAt?'complete':'review'}/></li>)}</ul>{!data.facilities.length?<p>No facility profile is recorded yet.</p>:null}</section></>:null}
  </div>;
}
