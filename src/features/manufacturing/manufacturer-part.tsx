'use client';
import Link from 'next/link';
import { useEffect,useState } from 'react';
import type { Asset, Flag, Id, WorkshopSnapshot } from '@/contracts';
import { api,type ApiClient } from '@/lib/api/client';
import { Button,StatusBadge,buttonClassName } from '@/components/ui';
import { NativePartSources } from '@/features/parts/native-part-sources';
import { PartQr } from '@/features/parts/part-qr';
import { partPath } from '@/lib/parts/path';
import { ModelViewer } from '@/features/visualization';
import styles from './manufacturing.module.css';

type Bundle=Awaited<ReturnType<ApiClient['jobs']['get']>>;

function readySource(assets: Asset[], kind: 'drawing_pdf' | 'model_glb' | 'model_stl'): Asset | null {
  return assets.find((asset) => asset.kind === kind && asset.status === 'ready' && asset.sha256 !== null) ?? null;
}

/**
 * Displays only the job's selected, authenticated source files.  A drawing
 * and visual model remain useful before an engineer publishes guidance, but
 * neither is presented as an approved manufacturing instruction here.
 */
function SourcePacketPreview({ assets, approved, client }: { assets: Asset[]; approved: boolean; client: Pick<ApiClient, 'assets'> }) {
  const drawing = readySource(assets, 'drawing_pdf');
  const model = readySource(assets, 'model_glb') ?? readySource(assets, 'model_stl');
  const drawingId = drawing?.id ?? null;
  const [drawingAccess, setDrawingAccess] = useState<{ assetId: Id; url: string | null; error: string | null } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const drawingUrl = drawingAccess?.assetId === drawingId ? drawingAccess.url : null;
  const drawingError = drawingAccess?.assetId === drawingId ? drawingAccess.error : null;

  useEffect(() => {
    if (!drawingId) return undefined;
    let active = true;
    void client.assets.getLink({ assetId: drawingId }).then((link) => {
      if (active) setDrawingAccess({ assetId: drawingId, url: link.url, error: null });
    }).catch((cause: unknown) => {
      if (active) setDrawingAccess({ assetId: drawingId, url: null, error: cause instanceof Error ? cause.message : 'The drawing could not be opened.' });
    });
    return () => { active = false; };
  }, [client, drawingId, reload]);

  if (!drawing && !model && !assets.some((asset) => asset.kind === 'native_part' || asset.kind === 'native_drawing')) return null;
  return <section id="source-files" className={styles.sourcePacket} aria-label="Part source files">
    <div className={styles.sourcePacketHeader}>
      <div><h3>Part source files</h3><p className={styles.muted}>{approved ? 'Approved handoff sources are available below.' : 'Retained source previews only. Engineering guidance is still awaiting approval.'}</p></div>
      {drawing ? <Button type="button" tone="secondary" small onClick={() => setReload((value) => value + 1)}>Refresh secure link</Button> : null}
    </div>
    {drawing ? <article className={styles.sourcePreview}>
      <h4>Technical drawing</h4><p className={styles.muted}>{drawing.filename} · {drawing.drawingRevision ? `Revision ${drawing.drawingRevision}` : 'revision not provided'}</p>
      {drawingUrl ? <><iframe className={styles.sourcePdf} title={`Source drawing ${drawing.filename}`} src={drawingUrl} /><p className={styles.sourceActions}><a href={drawingUrl} target="_blank" rel="noreferrer" download>Open or download drawing PDF</a></p></> : drawingError ? <p className={styles.error} role="alert">{drawingError}</p> : <p role="status" className={styles.muted}>Requesting authorized drawing access…</p>}
    </article> : null}
    {model ? <article className={styles.sourcePreview}>
      <h4>3D visual reference</h4><p className={styles.muted}>{model.filename} · {model.kind === 'model_stl' ? 'STL visual reference — not semantic drawing evidence.' : 'GLB visual reference.'}</p>
      <ModelViewer assetId={model.id as Id} format={model.kind === 'model_stl' ? 'stl' : 'glb'} resolveAssetUrl={async (assetId) => (await client.assets.getLink({ assetId })).url} onError={setModelError} />
      {modelError ? <p className={styles.error} role="alert">{modelError}</p> : null}
    </article> : null}
    <NativePartSources assets={assets} client={client} />
  </section>;
}

export function ManufacturerPart({jobId,workspaceId,client=api}:{jobId:string;workspaceId:string;client?:Pick<ApiClient,'jobs'|'workshops'|'flags'|'assets'>}) {
  const [data,setData]=useState<{bundle:Bundle;facility:WorkshopSnapshot|null;flags:Flag[]}|null>(null);
  const [error,setError]=useState<string|null>(null); const [reload,setReload]=useState(0);
  useEffect(()=>{let active=true;
    async function load(){
      const bundle=await client.jobs.get({jobId});
      if(bundle.job.workspaceId!==workspaceId)throw Error('This part does not belong to the selected workspace.');
      const [facilities,flags]=await Promise.all([client.workshops.list({workspaceId}),client.flags.list({jobId})]);
      const approved=bundle.releases.find(r=>r.id===bundle.job.latestReleaseId&&r.jobId===jobId);
      const selectedFacilityId=approved?.snapshot.workshopSnapshotId??bundle.job.workshopSnapshotId;
      const facility=facilities.find(f=>f.id===selectedFacilityId)??null;
      // The list contains current facility versions; do not substitute one for the selected evidence.
      if(active){setData({bundle,facility,flags:flags.filter(f=>f.context.jobId===jobId)});setError(null);}
    }
    void load().catch(e=>{if(active)setError(e instanceof Error?e.message:'Part handoff unavailable.');});
    return()=>{active=false;};
  },[jobId,workspaceId,client,reload]);
  const back=`/studio/manufacturing?workspace=${encodeURIComponent(workspaceId)}`;
  if(!data)return <div className={styles.page}><Link href={back}>← Manufacturing parts</Link>{error?<div role="alert">{error}<Button onClick={()=>setReload(v=>v+1)}>Retry</Button></div>:<p role="status">Loading part handoff…</p>}</div>;
  const {bundle,facility,flags}=data;
  const approved=bundle.releases.find(r=>r.id===bundle.job.latestReleaseId&&r.jobId===jobId);
  const machine=facility?.machines.find(m=>m.id===(approved?.snapshot.machineId??bundle.job.machineId));
  const approvedSources=approved?bundle.assets.filter(a=>approved.snapshot.sourceAssetIds.includes(a.id)):[];
  const outstanding=flags.filter(f=>f.status!=='resolved');
  return <div className={styles.page}>
    <Link href={back}>← Manufacturing parts</Link>
    <header className={styles.header}><div><p>Manufacturing handoff · {bundle.job.partNumber}</p><h1>{bundle.job.title}</h1><p>{bundle.job.partFamily}</p></div><Link className={buttonClassName()} href={partPath(jobId)}>{approved?'Open approved floor view':'Open part previews'}</Link></header>
    {error?<p role="alert" className={styles.error}>{error} Showing previously loaded information.</p>:null}
    <StatusBadge label={approved?'Approved guidance available':'Engineering approval pending'} tone={approved?'complete':'review'}/>
    {!approved?<div className={styles.notice}>Engineering has not approved guidance for this part. You can inspect retained source previews, but draft instructions are not a manufacturing handoff.</div>:null}
    <nav className={styles.nav} aria-label="Part handoff sections"><a href="#specifications">Part specifications</a><a href="#source-files">Source files</a><a href="#facility">Facility and setup</a><a href="#questions">Questions and answers</a></nav>
    <div className={styles.grid}><section id="specifications" className={styles.section}><h2>Part specifications</h2><dl className={styles.specs}><dt>Part number</dt><dd>{bundle.job.partNumber}</dd><dt>Approved source files</dt><dd>{approved?`${approvedSources.length} files in the approved handoff`:'Awaiting engineering approval'}</dd><dt>Detailed guidance</dt><dd>{approved?`${approved.snapshot.steps.filter(s=>s.guidance?.decision==='include').length} operations selected by engineering`:'Not approved'}</dd><dt>Material / tolerances</dt><dd>{approved?'Refer to the approved drawing.':'Awaiting an approved drawing.'} These fields have not been extracted into the part record.</dd></dl>
    {approved&&approved.snapshot.bends.length?<><h3>Recorded operation requirements</h3><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Operation</th><th>Drawing angle</th><th>Inside radius</th><th>Direction</th></tr></thead><tbody>{approved.snapshot.bends.map(b=><tr key={b.bendId}><th>{b.bendId}</th><td>{b.finishedAngle.evidenceState==='supported'&&b.finishedAngle.value?`${b.finishedAngle.value.degrees}° ${b.finishedAngle.value.convention.replaceAll('_',' ')}`:b.finishedAngle.evidenceState.replaceAll('_',' ')}</td><td>{b.insideRadiusMm.evidenceState==='supported'&&b.insideRadiusMm.value!==null?`${b.insideRadiusMm.value} mm`:b.insideRadiusMm.evidenceState.replaceAll('_',' ')}</td><td>{b.directionText.evidenceState==='supported'?b.directionText.value:b.directionText.evidenceState.replaceAll('_',' ')}</td></tr>)}</tbody></table></div><p className={styles.muted}>Open the floor view for the exact approved steps and source citations. These recorded requirements do not certify the setup.</p></>:null}
    <SourcePacketPreview assets={approved?approvedSources:bundle.assets.filter(a=>bundle.job.sourceAssetIds.includes(a.id))} approved={Boolean(approved)} client={client}/></section>
    <section id="facility" className={styles.section}><h2>Facility and setup</h2><dl className={styles.specs}><dt>Facility</dt><dd>{facility?.name??(bundle.job.workshopSnapshotId?'An earlier facility profile is selected. Ask engineering to confirm its applicable setup.':'Not selected')}</dd><dt>Machine</dt><dd>{machine?.name??'Not available in the current profile'}</dd><dt>Process</dt><dd>{machine?.process.replaceAll('_',' ')??'Unknown'}</dd><dt>Profile evidence</dt><dd>{facility?.confirmedAt&&facility.confirmedBy?`Confirmed ${new Date(facility.confirmedAt).toLocaleDateString()}`:'Confirmation unavailable'}</dd><dt>Tooling / reach</dt><dd>{machine?.tools.length?machine.tools.map(t=>t.name).join(', '):'Tooling not recorded'}. Reach and clearance require setup evidence.</dd></dl><p><Link href={`/studio/manufacturing/equipment?workspace=${encodeURIComponent(workspaceId)}`}>Review equipment and capabilities</Link></p><PartQr jobId={jobId}/></section></div>
    <section id="questions" className={styles.section}><div className={styles.header}><h2>Questions and approved answers</h2><Button tone="secondary" onClick={()=>setReload(v=>v+1)}>Refresh answers</Button></div><p className={styles.muted}>{outstanding.length} unresolved reports. A reply does not by itself clear an operation hold. Ask or flag from the floor view so the selected operation is attached.</p><ul className={styles.list}>{flags.map(flag=><li key={flag.id} className={styles.row}><div><h3>{flag.question}</h3><p className={styles.muted}>{flag.context.releaseId===approved?.id?'Current approved guidance':'Earlier or unapproved guidance'} · {flag.context.bendId??'General part question'} · {new Date(flag.createdAt).toLocaleString()}</p>{flag.response?<><strong>Engineer-approved answer</strong><p>{flag.response.text}</p></>:<p>Waiting for engineering.</p>}</div><StatusBadge label={flag.status==='open'?'Awaiting answer':flag.status==='responded'?'Engineer replied':'Resolved'} tone={flag.status==='resolved'?'complete':'review'}/></li>)}</ul>{!flags.length?<p>No floor questions are recorded for this part yet.</p>:null}</section>
  </div>;
}
