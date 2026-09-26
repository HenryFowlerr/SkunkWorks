(() => {
  'use strict';
  const $ = (s, root=document) => root.querySelector(s);
  const app = $('#app');
  const CONFIG = window.CHAPPE_CONFIG || {};
  const API = CONFIG.endpoint || (CONFIG.supabaseUrl ? `${CONFIG.supabaseUrl.replace(/\/$/,'')}/functions/v1/chappe-demo` : '');
  const KEY = CONFIG.anonKey || '';
  const STORAGE = 'chappe-static-demo-v1';
  const TOKEN_STORAGE = 'chappe-static-demo-engineer-tokens';
  const FACILITIES_STORAGE = 'chappe-demo-facilities';
  const PROFILE_STORAGE = 'chappe-demo-profiles';
  const DRAFT_STORAGE = 'chappe-demo-job-draft';
  const seed = { id:'local-demo', guideStatus:'draft', guideText:'B2: target internal angle 90 degrees; signed fold rotation -90 degrees. Confirm the return flange orientation against drawing A and the reviewed model before proceeding.', issues:[] };
  const state = { session:null, mode: API && KEY ? 'connecting' : 'local', error:'', facility:'Ridgeway Fabrication', draftFacility:'', draftName:'', op:'B2', view:'overview', responding:null, uploadFiles:[], showInvite:false, invitation:null };
  const docs = [
    {name:'sensor-mount-alpha.drawing.pdf', size:'Drawing revision A', href:'assets/sensor-mount-alpha.drawing.pdf'},
    {name:'sensor-mount-alpha.bend.json', size:'Authored panel / bend manifest', href:'assets/sensor-mount-alpha.bend.json'},
    {name:'sensor-mount-alpha.final.glb', size:'Prepared final-form 3D preview (GLB, not native CAD)', href:'assets/sensor-mount-alpha.final.glb'}
  ];
  const operations = [
    {id:'B1',title:'Left flange',detail:'Routine 90° bend',guide:false},
    {id:'B2',title:'Return flange orientation',detail:'Complex · selected for detailed guidance',guide:true},
    {id:'B3',title:'Right flange',detail:'Routine 90° bend',guide:false},
    {id:'B4',title:'Top tab',detail:'Routine 90° bend',guide:false},
    {id:'B5',title:'Bottom tab',detail:'Routine 90° bend',guide:false}
  ];
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function stored(key,fallback){try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}}
  function customFacilities(){return stored(FACILITIES_STORAGE,[]).filter(x=>x&&typeof x.name==='string')}
  function profiles(){return stored(PROFILE_STORAGE,{})}
  function jobDraft(){return stored(DRAFT_STORAGE,null)}
  function invitedFacility(){return (query().get('facility')||'').slice(0,100)}
  function isPreparedFacility(){return ['Ridgeway Fabrication','Harbour Toolworks'].includes(state.facility)}
  function inviteUrl(name){return `${baseUrl()}#/manufacturer?invite=preview&facility=${encodeURIComponent(name)}`}
  function getLocal(){try{return JSON.parse(localStorage.getItem(STORAGE))||null}catch{return null}}
  function saveLocal(session){localStorage.setItem(STORAGE,JSON.stringify(session));}
  function tokens(){try{return JSON.parse(localStorage.getItem(TOKEN_STORAGE))||{}}catch{return {}}}
  function saveToken(id,token){if(!token)return; const t=tokens();t[id]=token;localStorage.setItem(TOKEN_STORAGE,JSON.stringify(t));}
  function hasToken(){return !!tokens()[state.session?.id];}
  function sessionId(){return state.session?.id||'';}
  function normalize(s){if(!s)return null;return {id:s.id||s.sessionId||'local-demo',guideStatus:s.guideStatus||'draft',guideText:s.guideText||seed.guideText,issues:Array.isArray(s.issues)?s.issues:[]};}
  async function remote(action,fields={}){
    const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${KEY}`,'apikey':KEY},body:JSON.stringify({action,...fields})});
    let result;try{result=await response.json()}catch{throw new Error(`Demo service returned HTTP ${response.status}.`)}
    if(!response.ok)throw new Error(result.error||result.message||`Demo service returned HTTP ${response.status}.`);
    return result;
  }
  async function initSession(requested){
    const local=getLocal();
    if(API&&KEY){
      try{
        const result=requested ? await remote('get',{sessionId:requested}) : local?.id && !local.id.startsWith('local-') ? await remote('get',{sessionId:local.id}) : await remote('create');
        state.session=normalize(result.session||result);state.mode='live';state.error='';
        if(result.engineerToken)saveToken(state.session.id,result.engineerToken);
        saveLocal(state.session);render();return;
      }catch(e){state.error=e.message||'Demo service unavailable';state.mode='local';}
    }
    if(requested && local?.id!==requested){state.session=null;state.error='This session cannot be found in this browser. The live demo service is unavailable.';}
    else state.session=normalize(local||seed);
    render();
  }
  async function createSession(){
    if(state.mode==='live'){
      try{const r=await remote('create');state.session=normalize(r.session||r);saveToken(state.session.id,r.engineerToken);saveLocal(state.session);state.error='';render();toast('New demo session created.');return}catch(e){state.error=e.message||'Could not create a session';state.mode='local';}
    }
    state.session=normalize({...seed,id:'local-'+crypto.randomUUID()});saveLocal(state.session);render();toast('Local preview reset in this browser.');
  }
  async function mutate(action,fields){
    if(!state.session)throw new Error('Open a demo session first.');
    if(state.mode==='live'){
      const token=tokens()[sessionId()];
      if(['approve','respond'].includes(action)&&!token)throw new Error('Engineer control is unavailable in this browser. Start a new session here.');
      const result=await remote(action,{sessionId:sessionId(),...fields,...(token&&['approve','respond'].includes(action)?{engineerToken:token}:{})});
      state.session=normalize(result.session||result);saveLocal(state.session);render();return;
    }
    const s=structuredClone(state.session);
    if(action==='approve'){s.guideStatus='approved';s.guideText=fields.guideText;}
    if(action==='issue'){s.issues.push({id:crypto.randomUUID(),kind:fields.kind,operationId:fields.operationId,body:fields.body,status:'pending',holdActive:true,answer:null,createdAt:new Date().toISOString()});}
    if(action==='respond'){const issue=s.issues.find(x=>x.id===fields.issueId);if(issue){issue.answer=fields.answer;issue.status='answered';issue.holdActive=fields.holdActive!==false;}}
    state.session=s;saveLocal(s);render();
  }
  async function refresh(){if(state.mode!=='live'||!sessionId())return;try{const r=await remote('get',{sessionId:sessionId()});const latest=normalize(r.session||r);if(JSON.stringify(latest)!==JSON.stringify(state.session)){state.session=latest;saveLocal(latest);render();toast('This part was updated.');}}catch(e){state.error=e.message||'Refresh failed';state.mode='local';render();}}
  function baseUrl(){return location.href.split('#')[0].split('?')[0]}
  function operatorUrl(){return `${baseUrl()}#/operator?session=${encodeURIComponent(sessionId())}`}
  const PHONE_PREVIEW_URL = 'https://henryfowlerr.github.io/SkunkWorks/#/phone-preview';
  function currentRoute(){const hash=location.hash.slice(1);return hash.split('?')[0]||'/'}
  function query(){return new URLSearchParams(location.hash.split('?')[1]||'')}
  function brand(){return `<a href="#/" class="brand" aria-label="Chappe home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>Chappe</a>`}
  function topbar(route,variant=''){const phoneLink=route==='/'?'#/phone-preview':`#/operator?session=${encodeURIComponent(sessionId())}`;return `<header class="topbar ${variant}">${brand()}<nav class="top-links" aria-label="Primary"><a class="optional" href="#/" ${route==='/'?'aria-current="page"':''}>Why Chappe</a><a href="#/engineer" ${route==='/engineer'?'aria-current="page"':''}>Engineering</a><a class="optional" href="#/manufacturer" ${route==='/manufacturer'?'aria-current="page"':''}>Manufacturing</a><a class="button slim" href="${phoneLink}">Open phone view ↗</a></nav><details class="mobile-nav"><summary>Menu</summary><nav aria-label="Mobile primary"><a href="#/" ${route==='/'?'aria-current="page"':''}>Why Chappe</a><a href="#/engineer" ${route==='/engineer'?'aria-current="page"':''}>Engineering</a><a href="#/manufacturer" ${route==='/manufacturer'?'aria-current="page"':''}>Manufacturing</a><a href="${phoneLink}">Open phone view ↗</a></nav></details></header>`}
  function banner(){const live=state.mode==='live';return `<div class="storage-banner ${live?'live':state.error?'error':''}"><strong>${live?'Live demo session':'Local preview · saved in this browser only'}</strong>${live?' · Guide approval and floor issues sync across devices.':' · QR link and issues will not sync to another device.'}${state.error?` <span role="alert">Service: ${esc(state.error)}</span>`:''}</div>`}
  function status(text,kind){return `<span class="status ${kind}">${esc(text)}</span>`}
  function toast(message){const old=$('.toast');if(old)old.remove();const el=document.createElement('div');el.className='toast';el.role='status';el.textContent=message;document.body.append(el);$('#announcement').textContent=message;setTimeout(()=>el.remove(),3500)}
  function model(active='B2'){
    const colors={B1:'#afc7e0',B2:active==='B2'?'#0071e3':'#afc7e0',B3:'#afc7e0',B4:'#afc7e0',B5:'#afc7e0'};
    return `<div class="model-frame"><svg viewBox="0 0 540 310" role="img" aria-label="Illustrative flat layout of the prepared Sensor Mount SKW-SM-104; selected bend ${esc(active)}. This is an authored panel diagram, not a physical forming simulation."><defs><pattern id="dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#d2d2d7"/></pattern></defs><rect width="540" height="310" fill="url(#dots)"/><g fill="#e6edf5" stroke="#46576a" stroke-width="1.7"><rect x="165" y="70" width="245" height="164"/><rect x="114" y="70" width="51" height="164"/><rect x="78" y="70" width="36" height="164"/><rect x="410" y="70" width="53" height="164"/><rect x="250" y="30" width="80" height="40"/><rect x="255" y="234" width="70" height="37"/></g><g stroke-width="5" stroke-linecap="round"><path d="M165 72v160" stroke="${colors.B1}"/><path d="M114 72v160" stroke="${colors.B2}"/><path d="M410 72v160" stroke="${colors.B3}"/><path d="M251 70h79" stroke="${colors.B4}"/><path d="M255 234h70" stroke="${colors.B5}"/></g><g fill="#1d1d1f" font-family="-apple-system,Arial,sans-serif" font-size="13" font-weight="700"><text x="216" y="156">BASE · 120 × 80</text><text x="126" y="58">B1</text><text x="75" y="58">B2</text><text x="414" y="58">B3</text><text x="340" y="48">B4</text><text x="332" y="262">B5</text></g></svg></div><div class="model-caption">Prepared authored flat layout from SKW-SM-104 manifest · not a press-brake sequence or safety validation.</div>`
  }
  function brandMorphScene(){return `<section class="brand-morph" aria-label="Chappe signal forms resolve into the Chappe wordmark as the page scrolls"><div class="brand-morph-sticky"><canvas id="brand-morph-canvas" class="brand-morph-canvas" width="1440" height="810" role="img" aria-label="Six Chappe signal forms continuously transform into the Chappe wordmark"><span class="sr-only">Six Chappe signal forms resolve into the Chappe wordmark.</span></canvas><div class="morph-hero hero" aria-labelledby="hero-title"><h1 id="hero-title">Less back-and-forth.<br> <em>Work moves faster.</em></h1><p class="intro">Chappe uses AI to keep engineering and manufacturing aligned, with sources, approvals and unknowns visible.</p><div class="hero-actions"><a class="button pill" href="#/engineer">Explore the demo <span aria-hidden="true">↗</span></a><a class="text-link" href="#/phone-preview">See the phone view <span aria-hidden="true">↗</span></a></div></div></div></section>`}
  function landing(){return `${topbar('/')}<main class="landing landing-intro">
    ${brandMorphScene()}
    <figure class="hero-figure reveal"><div class="hero-product" role="img" aria-label="Concept Chappe workspace: an engineer compares documented facility support, conflict, and unknown evidence beside a prepared part diagram."><div class="hero-product-bar"><span class="hero-product-brand">Chappe <span>/</span> Sensor Mount</span><span>Job 1042 <span class="hero-product-sep">·</span> Drawing A <span class="hero-product-sep">·</span> Draft</span></div><div class="hero-product-body"><div class="hero-product-left"><span class="hero-product-kicker">Receiving facility / Ridgeway Fabrication</span><strong>Know what the workshop can support.</strong><div class="hero-product-line"><span>2.0 mm sheet thickness</span><b class="hp-support">Documented support</b></div><div class="hero-product-line"><span>80 mm bend line</span><b class="hp-support">Documented support</b></div><div class="hero-product-line"><span>B2 return flange access</span><b class="hp-unknown">Unknown · confirm setup</b></div><span class="hero-product-foot">Prepared example · evidence stays visible</span></div><div class="hero-product-right">${model('B2')}<span class="hero-product-marker">B2 / Selected operation</span></div></div></div></figure>
    <section class="chapter shell" aria-labelledby="journey-title"><div class="chapter-lead reveal"><h2 id="journey-title">The detail matters<br>after the drawing leaves.</h2><p class="lead">Follow the prepared Sensor Mount example from facility selection to the exact operation on the floor. Every claim keeps its source and scope.</p></div>
      <div class="sequence" aria-label="The Chappe handoff"><article class="reveal"><div class="num">01</div><h3>Check the facility.</h3><p>Compare drawing requirements with recorded facts. Show documented support, conflict, and unknown separately.</p></article><article class="reveal"><div class="num">02</div><h3>Review the difficult work.</h3><p>Give B2 extra guidance; let routine operations stay routine. An engineer corrects the wording before release.</p></article><article class="reveal"><div class="num">03</div><h3>Release to the floor.</h3><p>Put a QR beside the drawing. The phone opens the approved operation and its release context.</p></article><article class="reveal"><div class="num">04</div><h3>Resolve it together.</h3><p>An operator flags B2. Engineering sees the issue in context and approves the answer.</p></article></div>
    </section>
    <section class="object-chapter" aria-labelledby="object-title"><div class="shell object-layout"><div class="object-copy reveal"><h2 id="object-title">Go straight to the bend that needs a closer look.</h2><p>Choose B2 on the part. Its source and uncertainty travel with the reviewed guidance. The other bends remain easy to find without a wall of instructions.</p><a class="text-link" href="#/review">Inspect the review desk <span aria-hidden="true">↗</span></a></div><div class="object-scene" aria-label="Illustrative three-dimensional rendering of the prepared Sensor Mount. B2 is highlighted; this is not a forming simulation."><svg class="object-part" viewBox="0 0 700 560" role="img" aria-label="Illustrative metal Sensor Mount with the B2 return flange highlighted"><defs><linearGradient id="metal" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#eff3f8"/><stop offset=".52" stop-color="#a8b8c8"/><stop offset="1" stop-color="#e7edf5"/></linearGradient><linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="#4e647e"/><stop offset="1" stop-color="#7f95ad"/></linearGradient></defs><path d="M162 258 428 168 580 292 316 386Z" fill="url(#metal)" stroke="#eef4fa" stroke-width="3"/><path d="M316 386 580 292 580 339 316 433Z" fill="url(#edge)" stroke="#d3deeb" stroke-width="2"/><path d="M162 258 316 386 316 433 162 304Z" fill="#7891ab" stroke="#c9d9e8" stroke-width="2"/><path d="M162 258 116 238 116 285 162 304Z" fill="#6289bd" stroke="#a3c3ec" stroke-width="3"/><path d="M116 238 162 258 316 386 274 369Z" fill="#4c90df" stroke="#b4d7ff" stroke-width="2"/><path d="M428 168 462 155 612 274 580 292Z" fill="#bac9d9" stroke="#e5edf4" stroke-width="2"/><circle cx="314" cy="268" r="13" fill="#5f738b"/><circle cx="436" cy="225" r="13" fill="#5f738b"/><circle cx="459" cy="310" r="13" fill="#5f738b"/></svg><div class="object-label"><span class="object-pulse"></span><strong>B2</strong><span>Return flange orientation</span></div><div class="object-caption">Prepared part illustration · no physical forming validation</div></div></div></section>
    <section class="preview-qr-section shell" aria-labelledby="preview-qr-title"><div class="preview-qr-copy reveal"><h2 id="preview-qr-title">Scan into the operation.</h2><p>This permanent QR opens a read-only prepared guide for Sensor Mount B2. A reviewed live demo session gets its own release QR after engineer approval.</p><a class="button pill" href="#/phone-preview">Open phone preview <span aria-hidden="true">↗</span></a><a class="preview-qr-url" href="${PHONE_PREVIEW_URL}">${PHONE_PREVIEW_URL}</a></div><div class="preview-qr-art reveal"><a href="${PHONE_PREVIEW_URL}" aria-label="Open the read-only Chappe phone preview"><img src="assets/phone-preview-qr.svg" width="320" height="320" alt="QR code for the read-only Chappe Sensor Mount phone preview"></a><span>Prepared B2 preview · read only</span><a href="assets/phone-preview-qr.svg" download="chappe-phone-preview-qr.svg">Download QR label</a></div></section>
    <section class="trust-chapter shell" aria-labelledby="trust-title"><div class="trust-intro reveal"><h2 id="trust-title">A clear answer includes<br>what we don’t know.</h2><p>Chappe’s prepared comparison reports documented support and conflict only for the facts in its source packet. B2 tooling reach remains unknown until a person confirms it.</p></div><div class="trust-list reveal"><div class="trust-state support"><strong>Documented support</strong><span>Recorded profile meets the stated value.</span></div><div class="trust-state conflict"><strong>Documented conflict</strong><span>Recorded profile contradicts a requirement.</span></div><div class="trust-state unknown"><strong>Unknown</strong><span>Evidence is missing or outside the check.</span></div></div></section>
    <section class="final-chapter"><div class="shell reveal"><h2>See the complete handoff.</h2><p>A five-minute journey from documented facility facts to an engineer-approved response on the floor.</p><a class="button pill" href="#/engineer">Start with engineering <span aria-hidden="true">↗</span></a></div></section>
    </main><footer class="shell footer"><span>Chappe · A SkunkWorks project</span><span>Prepared synthetic Sensor Mount example · Demonstration only</span></footer>`}
  function nav(which){if(which==='manufacturer')return `<aside class="sidebar" aria-label="Manufacturer sections"><p class="work-nav-heading">Manufacturing</p><button class="side-link is-active" data-scroll="facility-record" aria-controls="facility-record" aria-current="true"><span class="work-nav-index">01</span><span>Facility profile</span></button><button class="side-link" data-scroll="received-work" aria-controls="received-work"><span class="work-nav-index">02</span><span>Received work</span></button><button class="side-link" data-scroll="floor-conversation" aria-controls="floor-conversation"><span class="work-nav-index">03</span><span>Questions and flags</span></button></aside>`;return `<aside class="sidebar" aria-label="Engineering sections">${which==='engineer'?'<p class="work-nav-heading">Engineering</p>':''}<a class="side-link ${which==='engineer'?'active':''}" href="#/engineer">Jobs</a><a class="side-link ${which==='engineer-job'?'active':''}" href="#/engineer/job">Sensor Mount</a><a class="side-link ${which==='engineer-new'?'active':''}" href="#/engineer/new">New job draft</a><a class="side-link ${which==='review'?'active':''}" href="#/review">Guide review</a><a class="side-link ${which==='issues'?'active':''}" href="#/issues">Floor issues</a><a class="side-link ${which==='qr'?'active':''}" href="#/qr">QR / handoff</a></aside>`}
  function wrap(which,body){const editorial=which==='engineer'||which==='manufacturer';const route=which.startsWith('engineer')||['review','issues','qr'].includes(which)?'/engineer':'/'+which;const shell=editorial?`work-editorial work-editorial--${which}`:'';return `${editorial?`<div class="${shell}">`:''}${topbar(route,editorial?'topbar--editorial':'')}${banner()}<div class="workspace ${editorial?'work-editorial__workspace':''}">${nav(which)}<main class="work-main"><div class="work-max">${body}</div></main></div>${editorial?'</div>':''}`}
  function workHead(kicker,title,description,buttons='',showKicker=false){return `<div class="work-top"><div class="work-top__copy">${showKicker&&kicker?`<p class="work-kicker">${esc(kicker)}</p>`:''}<h1>${title}</h1><p>${description}</p></div><div class="work-actions">${buttons}</div></div>`}
  function metadata(){return `<div class="meta-strip"><span><strong>Job</strong> <span class="mono">1042</span></span><span><strong>Part</strong> <span class="mono">SKW-SM-104</span></span><span><strong>Source</strong> Drawing rev A</span><span><strong>Facility</strong> ${esc(state.facility)}</span><span><strong>Guide</strong> ${state.session?.guideStatus==='approved'?'Release 1 · engineer approved':'Draft · awaiting approval'}</span></div>`}
  function uploadedRows(files=state.uploadFiles){return files.length ? `<ul class="file-rows">${files.map(f=>`<li><strong>${esc(f.name)}</strong><span>${esc((f.size/1048576).toFixed(1))} MB · selected in this browser only</span></li>`).join('')}</ul>` : `<p class="upload-empty">No files selected in this browser.</p>`}
  function facilityOptions(){return ['Ridgeway Fabrication','Harbour Toolworks',...customFacilities().map(f=>f.name)].map(name=>`<option value="${esc(name)}" ${state.facility===name?'selected':''}>${esc(name)}</option>`).join('')}
  function invitePanel(){const i=state.invitation;return `<div class="invite-panel"><div class="eyebrow">New manufacturer / local preview</div><h3>Add a receiving facility</h3><p>Enter the contact, then copy a preview link or open an email draft. This Pages demo cannot create an account or send mail; the live invitation service runs in the Next app.</p><form id="invite-form" class="invite-form"><label class="field"><span>Manufacturer name</span><input name="name" required maxlength="100" placeholder="e.g. Northline Fabrication"></label><label class="field"><span>Contact email</span><input name="email" type="email" required maxlength="200" placeholder="team@example.com"></label><button class="button" type="submit">Create preview invitation →</button></form>${i?`<div class="invite-result"><strong>Invitation preview for ${esc(i.name)}</strong><p>Copy this link into an email. The recipient can complete a local capability form; their responses will not sync back to this engineer page.</p><div class="link-field"><input id="invite-link" readonly value="${esc(i.url)}" aria-label="Manufacturer preview link"><button class="button secondary slim" id="copy-invite">Copy link</button></div><a class="text-link" href="mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent('Chappe manufacturer invitation preview')}&body=${encodeURIComponent(`Open this Chappe onboarding preview: ${i.url}

This is a demo link; account creation and profile sharing are not active on GitHub Pages.`)}">Open email draft ↗</a></div>`:''}</div>`}
  function draftFacilityOptions(value){return ['Ridgeway Fabrication','Harbour Toolworks',...customFacilities().map(f=>f.name)].map(name=>`<option value="${esc(name)}" ${value===name?'selected':''}>${esc(name)}</option>`).join('')}
  function engineer(){const draft=jobDraft();return wrap('engineer',`${workHead('','Engineering','Open a job or start a new one with its source files.',`<a class="button secondary" href="#/engineer/new">New job draft</a>`)}<div class="dashboard-grid"><section class="dashboard-projects" aria-labelledby="jobs-title"><div class="dashboard-heading"><h2 id="jobs-title">Projects</h2><span>1 prepared example${draft?' · 1 local draft':''}</span></div><div class="project-table-wrap"><table class="project-table"><thead><tr><th scope="col">Project</th><th scope="col">Source files</th><th scope="col">Receiving facility</th><th scope="col">Release</th><th scope="col"><span class="sr-only">Open project</span></th></tr></thead><tbody><tr><td><a class="project-table__title" href="#/engineer/job"><strong>Sensor Mount</strong><small>SKW-SM-104 · Job 1042</small></a></td><td><strong>3 prepared files</strong><small>Drawing · manifest · 3D preview</small></td><td>${esc(state.facility)}</td><td>${status(state.session?.guideStatus==='approved'?'Release 1 approved':'Draft for review',state.session?.guideStatus==='approved'?'good':'warn')}</td><td><a class="project-table__open" href="#/engineer/job" aria-label="Open Sensor Mount project">Open ↗</a></td></tr>${draft?`<tr><td><a class="project-table__title" href="#/engineer/new"><strong>${esc(draft.name)}</strong><small>Local browser draft</small></a></td><td><strong>${esc(draft.files.length)} source file${draft.files.length===1?'':'s'}</strong><small>Names saved in this browser</small></td><td>${esc(draft.facility||'Not selected')}</td><td>${status('Local draft','neutral')}</td><td><a class="project-table__open" href="#/engineer/new" aria-label="Open ${esc(draft.name)} local draft">Open ↗</a></td></tr>`:''}</tbody></table></div><p class="scope-copy">Sensor Mount is the prepared five-minute journey. Local drafts do not run a facility check or generate guidance.</p></section><section class="dashboard-intake" aria-labelledby="intake-title"><div class="dashboard-heading"><h2 id="intake-title">Start with your files</h2></div><p>Drop CAD or technical drawings to begin a local draft.</p><div id="file-drop" class="file-drop" role="group" aria-label="Choose or drop CAD and technical drawing files"><div class="file-drop-symbol" aria-hidden="true">＋</div><strong>Drop files here</strong><span>CAD model exports and technical drawings</span><label class="button secondary" for="source-files">Choose files</label><input id="source-files" type="file" multiple accept=".sldprt,.sldasm,.ipt,.iam,.step,.stp,.iges,.igs,.dxf,.dwg,.stl,.obj,.glb,.pdf,application/pdf" class="sr-only"></div><div class="intake-file-note"><span>Accepted locally</span><span>CAD exports · technical drawings · PDF</span></div>${state.uploadFiles.length?`${uploadedRows()}<a class="button pill" href="#/engineer/new">Continue draft →</a>`:'<p class="scope-copy">Files remain in this browser. This Pages demo does not upload or interpret them.</p>'}</section></div>`)}
  function engineerNew(){const saved=jobDraft();const files=state.uploadFiles.length?state.uploadFiles:saved?.files||[];const defaultName=state.draftName||saved?.name||files[0]?.name.replace(/\.[^.]+$/,'')||'';const selected=state.draftFacility||saved?.facility||'';return wrap('engineer-new',`${workHead('','New job draft','Name the job, review the selected files and choose a manufacturer.',`<a class="button secondary" href="#/engineer">All jobs</a>`)}<form id="draft-form" class="draft-form"><label class="field"><span>Project name</span><input name="name" required maxlength="100" value="${esc(defaultName)}" placeholder="Part or project name"></label><div id="file-drop" class="file-drop" role="group" aria-label="Choose or drop CAD and technical drawing files"><div class="file-drop-symbol" aria-hidden="true">＋</div><strong>Drop files here</strong><span>CAD model exports and technical drawings</span><label class="button secondary" for="source-files">Choose files</label><input id="source-files" type="file" multiple accept=".sldprt,.sldasm,.ipt,.iam,.step,.stp,.iges,.igs,.dxf,.dwg,.stl,.obj,.glb,.pdf,application/pdf" class="sr-only"></div>${uploadedRows(files)}<label class="field"><span>Manufacturer</span><select id="draft-facility" name="facility"><option value="">Choose later</option>${draftFacilityOptions(selected)}</select></label><button class="button pill" type="submit" ${files.length?'':'disabled'}>Save local draft</button><p class="scope-copy">Only the project name and file names are saved in this browser. File contents are not uploaded or analysed. The prepared Sensor Mount job is the only example with a facility comparison and reviewable guide.</p></form>`)}
  function engineerJob(){return wrap('engineer-job',`${workHead('','Sensor Mount','Prepared Job 1042 · select a workshop and review the exact guidance before release.',`<a class="button secondary" href="#/engineer">All jobs</a><button class="button secondary" id="new-session">New demo session</button><a class="button" href="#/review">Review guide →</a>`)}${metadata()}<section class="section desk-section"><div class="section-head"><div><h2>Drawing and design files</h2><p>Inspect the prepared source packet for this example.</p></div></div><div class="source-workbench"><div class="source-files"><h3>Prepared sources</h3><ul class="source-list">${docs.map(d=>`<li><strong>${esc(d.name)}</strong><span>${esc(d.size)}</span><a href="${d.href}" target="_blank" rel="noopener">Open ↗</a></li>`).join('')}</ul><p class="scope-copy">New files form a separate local draft; they do not change this prepared example.</p><a class="text-link" href="#/engineer/new">Start a new job draft ↗</a></div><div class="source-model">${model()}</div></div></section><section class="section desk-section"><div class="section-head"><div><h2>Choose the workshop</h2><p>Prepared profile facts inform this example. Newly added facilities remain unknown until verified data is connected.</p></div></div><div class="facility-control"><label class="field"><span>Manufacturer</span><select id="facility" ${state.session?.guideStatus==='approved'?'disabled title="This demo release is already approved for Ridgeway Fabrication"':''}>${facilityOptions()}</select></label><button class="button secondary" id="add-facility" type="button" aria-expanded="${state.showInvite}" ${state.session?.guideStatus==='approved'?'disabled title="Start a new demo session to choose a different facility"':''}>＋ Add manufacturer</button></div>${state.showInvite?invitePanel():''}<div id="facility-results">${facilityResults()}</div>${state.session?.guideStatus==='approved'?'<p class="scope-copy">This released example is fixed to its selected facility. Start a new demo session to compare another workshop.</p>':''}</section><section class="section desk-section"><div class="section-head"><div><h2>Review the difficult operation</h2><p>B2 is proposed for detailed floor guidance. The engineer can correct its wording and approve the release.</p></div><a class="button" href="#/review">Open review desk →</a></div><div class="decision-row"><strong>B2 · Return flange orientation</strong>${status(state.session?.guideStatus==='approved'?'Engineer approved':'Draft proposal',state.session?.guideStatus==='approved'?'good':'warn')}</div><p class="scope-copy">Tooling reach remains unknown; the guide is not a physical suitability certificate. Routine bends remain selectable without detailed instructions.</p></section>`)}
  function facilityResults(){if(!isPreparedFacility())return `<div class="result-row"><div><strong>2.0 mm sheet thickness</strong><p>Drawing A · material thickness</p></div><div class="source">No confirmed profile linked to this demo facility.</div>${status('Unknown','warn')}</div><div class="result-row"><div><strong>80 mm bend line and B2 setup</strong><p>Authored manifest and drawing A</p></div><div class="source">Manufacturer onboarding is local to the recipient browser.</div>${status('Unknown','warn')}</div><p class="evidence-followup">No confirmed capability profile for ${esc(state.facility)}. Choose a prepared facility to continue this example.</p>`;const harbour=state.facility==='Harbour Toolworks';return `<div class="result-row"><div><strong>2.0 mm sheet thickness</strong><p>Drawing A · material thickness</p></div><div class="source">${harbour?'Profile v2: sheet capacity to 1.6 mm':'Profile v3: sheet capacity to 3.0 mm'}</div>${status(harbour?'Documented conflict':'Documented support',harbour?'bad':'good')}</div><div class="result-row"><div><strong>80 mm bend line</strong><p>Authored bend manifest · B2 hinge length</p></div><div class="source">${harbour?'Profile v2: bend length to 400 mm':'Profile v3: bend length to 500 mm'}</div>${status('Documented support','good')}</div><div class="result-row"><div><strong>B2 return flange access</strong><p>Drawing A + authored panel layout · setup reach needs human confirmation</p></div><div class="source">No setup or tooling reach record for the return.</div>${status('Unknown · confirm setup','warn')}</div><p class="evidence-followup">${harbour?'The documented 1.6 mm limit conflicts with the drawing’s 2.0 mm requirement. Change the facility, profile evidence, or design before release.':'B2 tooling reach is still unknown. Confirm the setup with the facility before manufacturing.'}</p>`}
  function review(){const s=state.session||seed;const approved=s.guideStatus==='approved';const blocked=state.facility==='Harbour Toolworks'||!isPreparedFacility();return wrap('review',`${workHead('Engineer workspace / review','Guide review','Decide exactly what the operator receives. Prepared proposal; engineer approval is the release gate.',`<a class="button secondary" href="#/engineer/job">View sources</a><button class="button" id="publish-top" ${approved||blocked||(!hasToken()&&state.mode==='live')?'disabled title="Approval unavailable until the draft, facility and engineer access are ready"':''}>${approved?'Release 1 approved':blocked?'Resolve facility conflict':'Approve & publish'}${approved?'':' →'}</button>`)}${metadata()}<section class="section"><div class="review-layout"><div><div class="section-head"><div><h2>Operations</h2><p>One detailed card; routine bends stay navigable.</p></div></div><div class="operation-list">${operations.map(o=>`<button class="operation-row ${state.op===o.id?'selected':''}" data-op="${o.id}" aria-pressed="${state.op===o.id}"><span><strong>${o.id} · ${o.title}</strong><small>${o.detail}</small></span>${o.guide?status(s.guideStatus==='approved'?'Approved guide':'Draft suggestion',s.guideStatus==='approved'?'good':'warn'):status('No detail card','neutral')}</button>`).join('')}</div></div><div class="review-inspector"><div class="eyebrow">Selected operation / ${esc(state.op)}</div><h2 style="font-size:27px;letter-spacing:-.04em;margin:8px 0 5px">${esc(operations.find(o=>o.id===state.op)?.title)}</h2>${model(state.op)}${state.op==='B2'?`<div class="note warn"><strong>Source and uncertainty.</strong> Drawing A gives a 90° internal-angle target. The authored manifest maps B2 to the left return. ${approved?'This is the engineer-approved wording for Release 1.':'The wording below is a prepared demo proposal.'} It does not validate tooling clearance.</div><label class="field"><span>${approved?'Approved floor wording':'Proposed floor wording · engineer can correct'}</span><textarea id="guide-text" maxlength="1000" ${approved?'readonly':''}>${esc(s.guideText)}</textarea><small>The exact approved wording is shown on the operator guide. This release is immutable once approved.</small></label><label class="checkline"><input type="checkbox" checked disabled> Include detailed guidance for B2</label><div class="work-actions"><button class="button" id="publish" ${approved||blocked||(!hasToken()&&state.mode==='live')?'disabled title="Approval unavailable until the draft, facility and engineer access are ready"':''}>${approved?'Release 1 approved':blocked?'Resolve facility conflict':'Approve & publish'}${approved?'':' →'}</button><a class="button secondary" href="#/qr">Preview handoff</a></div>${!hasToken()&&state.mode==='live'?'<div class="note warn">This browser has no engineer token for this session. Open the engineer workspace and start a new session to approve; the QR never carries the token.</div>':''}`:`<div class="note">This is a routine area. It stays in the operation chooser but receives no detailed instruction card. Select B2 for the proposed guidance.</div>`}</div></div></section>`)}
  function manufacturer(){
    const invited=invitedFacility();
    const name=invited||state.facility;
    const prepared=['Ridgeway Fabrication','Harbour Toolworks'].includes(name);
    const profile=profiles()[name]||{};
    const ridge=name==='Ridgeway Fabrication';
    const receivedIndex=prepared?'03':'02';
    const conversationIndex=prepared?'04':'03';
    return wrap('manufacturer',`${workHead(invited?'Invitation preview · local browser only':'Manufacturing / facility record',esc(name),invited?'Complete the workshop information below. This link previews onboarding; it does not create an account or send details to engineering.':'See the received example and the facility facts that engineering compares.','',true)}
      ${invited?`<div class="invitation-notice"><strong>Invitation preview</strong><span>Opened from an engineer-generated link. This page is available without sign-in; saved details stay in this browser only.</span></div>`:metadata()}
      <section class="section desk-section" id="facility-record">
        <div class="work-section-grid">
          <p class="work-section-label">${prepared?'01 / DOCUMENTED PROFILE':'01 / CAPABILITY FORM'}</p>
          <div class="work-section-content">
            <div class="section-head"><div><h2>${prepared?'Documented example profile':'Tell engineering about this workshop'}</h2><p>${prepared?'These prepared facts support only the comparisons shown for Job 1042. Edit the local draft below to explore onboarding; it does not change those documented facts.':'Record equipment and limits for a future engineer review. This form is a local preview and makes no verified capability claim.'}</p></div></div>
            ${prepared?`<table class="info-table"><thead><tr><th>Recorded capability</th><th>Value</th><th>Evidence</th><th>State</th></tr></thead><tbody><tr><td>Sheet thickness limit</td><td>${ridge?'3.0':'1.6'} mm</td><td>Prepared profile ${ridge?'v3':'v2'}</td><td>${status('Recorded','neutral')}</td></tr><tr><td>Bend length limit</td><td>${ridge?'500':'400'} mm</td><td>Prepared profile ${ridge?'v3':'v2'}</td><td>${status('Recorded','neutral')}</td></tr><tr><td>B2 tooling reach</td><td>Not recorded</td><td>Needs human setup confirmation</td><td>${status('Unknown','warn')}</td></tr></tbody></table>`:''}
            <form id="profile-form" class="profile-form" data-facility="${esc(name)}">
              <div class="profile-draft-head"><p class="work-subsection-label">${prepared?'02 / LOCAL DRAFT':'LOCAL-ONLY DRAFT'}</p><p>${prepared?'Use this area to explore onboarding details. It is separate from the documented example profile above.':'This form saves a capability draft in this browser only; it does not submit a workshop claim.'}</p></div>
              <div class="profile-fields"><label class="field"><span>Main processes</span><input name="processes" maxlength="200" value="${esc(profile.processes||'')}" placeholder="e.g. sheet cutting, CNC bending"></label><label class="field"><span>Machines and tooling</span><textarea name="machines" maxlength="1000" placeholder="List machine models, tool families and setup notes">${esc(profile.machines||'')}</textarea></label><label class="field"><span>Maximum sheet thickness (mm)</span><input name="thickness" type="number" min="0" max="1000" step="0.1" value="${esc(profile.thickness||'')}" placeholder="Optional"></label><label class="field"><span>Maximum bend length (mm)</span><input name="length" type="number" min="0" max="100000" step="1" value="${esc(profile.length||'')}" placeholder="Optional"></label><label class="field span-two"><span>Limits and setup requirements</span><textarea name="limits" maxlength="1000" placeholder="Anything an engineer must confirm before handoff">${esc(profile.limits||'')}</textarea></label></div>
              <div class="profile-save"><button class="button" type="submit">Save local draft</button><span>${profile.savedAt?'Saved in this browser · '+esc(new Date(profile.savedAt).toLocaleString()):'Nothing has been submitted to Chappe or verified by engineering.'}</span></div>
            </form>
          </div>
        </div>
      </section>
      ${invited?`<section class="section desk-section" id="received-work"><div class="work-section-grid"><p class="work-section-label">${receivedIndex} / RECEIVED WORK</p><div class="work-section-content"><div class="section-head"><div><h2>No jobs sent yet</h2><p>This invitation preview does not assign Sensor Mount or share an engineer workspace with this browser.</p></div></div><div class="received-row"><div><strong>Ready for engineering review</strong><span>Once account invitations and profile submission run on a hosted server, engineering can confirm this facility and send work.</span></div></div></div></div></section>`:`<section class="section desk-section" id="received-work"><div class="work-section-grid"><p class="work-section-label">${receivedIndex} / RECEIVED WORK</p><div class="work-section-content"><div class="section-head"><div><h2>Sensor Mount · Job 1042</h2><p>Prepared drawing A and selective B2 guidance for the five-minute demo.</p></div>${status(state.session?.guideStatus==='approved'?'Release 1 available':'Awaiting engineer approval',state.session?.guideStatus==='approved'?'good':'warn')}</div><div class="received-row"><div><strong>SKW-SM-104</strong><span>Drawing A · Return flange B2 · ${esc(name)}</span></div><a class="text-link" href="#/operator?session=${encodeURIComponent(sessionId())}">Open floor view ↗</a></div><p class="scope-copy">The live demo session shares guide approval and floor issues. The prepared profile is not a workshop attestation.</p></div></div></section>`}
      <section class="section desk-section" id="floor-conversation"><div class="work-section-grid"><p class="work-section-label">${conversationIndex} / FLOOR CONVERSATION</p><div class="work-section-content"><div class="section-head"><div><h2>Questions and flags</h2><p>Issues remain attached to the job, release and B2 operation.</p></div></div>${invited?'<div class="issues-empty">No floor conversation is attached to this invitation preview.</div>':issueList(false)}</div></div></section>`)}
  function openIssues(){return (state.session?.issues||[]).filter(i=>!i.answer&&i.status!=='answered')}
  function issueList(engineer){const items=state.session?.issues||[];if(!items.length)return '<div class="issues-empty">No floor issues yet. Open the phone view and ask or flag B2 to exercise the loop.</div>';return items.slice().reverse().map(i=>`<article class="issue-row"><div>${status(i.answer?'Engineer answered':'Awaiting engineer',i.answer?'good':'warn')} <span class="mono">${esc(i.operationId||'B2')}</span> · ${esc(i.kind==='flag'?'Direct flag':'Question')}</div><p><strong>${esc(i.body)}</strong></p><small>Job 1042 · ${state.session?.guideStatus==='approved'?'Release 1':'Draft preview'} · ${esc(i.createdAt?new Date(i.createdAt).toLocaleString():'This session')}</small>${i.answer?`<div class="response"><strong>Engineer-approved response</strong>${esc(i.answer)}<div style="margin-top:8px">${status(i.holdActive===false?'Hold explicitly cleared':'B2 hold remains',i.holdActive===false?'good':'warn')}</div></div>`:engineer?`<div class="issue-actions"><button class="button secondary slim" data-respond="${esc(i.id)}">Review & respond →</button></div>`:''}</article>`).join('')}
  function issues(){let issue=(state.session?.issues||[]).find(i=>i.id===state.responding);return wrap('issues',`${workHead('Engineer workspace / floor feedback','Floor issues','Each item carries job, release and operation context. Only an engineer-approved response returns to the phone.',`<a class="button secondary" href="#/operator?session=${encodeURIComponent(sessionId())}">Open phone view</a>`)}${metadata()}<section class="section"><div class="grid-two"><div><div class="section-head"><div><h2>${openIssues().length} awaiting engineer</h2><p>Question and direct flag use the same review loop.</p></div></div>${issueList(true)}</div><div class="pane">${issue?`<div class="eyebrow">Job 1042 / ${esc(issue.operationId||'B2')} / ${state.session?.guideStatus==='approved'?'Release 1':'Draft preview'}</div><h3 style="margin-top:9px">${esc(issue.kind==='flag'?'Direct operator flag':'Operator question')}</h3><p>${esc(issue.body)}</p><div class="note warn">Affected operation ${esc(issue.operationId||'B2')} is on hold pending your decision. Do not infer a setup answer from the drawing alone.</div><label class="field"><span>Your approved response</span><textarea id="response-text" maxlength="1000" placeholder="Write a concise clarification grounded in the approved source or ask the operator to keep B2 on hold."></textarea><small>No AI-generated candidate is used in this static demo.</small></label><label class="checkline"><input id="keep-hold" type="checkbox" checked> Keep B2 on hold after this answer</label><p class="muted" style="font-size:12px">Uncheck only when engineering explicitly authorises this operation to resume.</p><button class="button" id="send-response" data-issue="${esc(issue.id)}" ${!hasToken()&&state.mode==='live'?'disabled title="Engineer token absent in this browser"':''}>Approve response →</button>${!hasToken()&&state.mode==='live'?'<p class="muted">This browser lacks the engineer token. Start a new session here to respond.</p>':''}`:`<h3>Issue context</h3><p>Select an awaiting issue to inspect its operation and approve a response.</p>`}</div></div></section>`)}
  function qr(){const approved=state.session?.guideStatus==='approved';return wrap('qr',`${workHead('Engineer workspace / handoff','QR and drawing label','This demo session link opens its release context and approved guide.',`<a class="button secondary" href="#/review">${approved?'View reviewed guide':'Review guide'}</a>`)}${metadata()}<section class="section"><div class="grid-two equal"><div class="pane"><div class="eyebrow">Print label / prepared example</div><h2 style="margin:9px 0">Sensor Mount <span class="mono">SKW-SM-104</span></h2><p>Drawing revision A · ${approved?'Release 1 approved':'Not released'}</p><div class="qr-pane" style="margin-top:20px"><div class="qr-box" id="qr-box">Generating QR…</div><div><strong>Scan for the part guide</strong><p style="margin:8px 0 16px">${approved?'Opens the engineer-approved B2 guidance and answers for this demo session.':'Approve the guide before treating this as a released handoff.'}</p>${status(approved?'Engineer approved':'Draft · not for floor',approved?'good':'warn')}</div></div></div><div><h2>Operator link</h2><p class="muted">For the pitch, open this link on a phone or scan the label above.</p><div class="link-field"><input id="operator-link" readonly value="${esc(operatorUrl())}" aria-label="Operator link"><button class="button secondary slim" id="copy-link">Copy</button></div><div class="work-actions" style="margin-top:13px"><a class="button" href="${esc(operatorUrl())}">Open phone view ↗</a><button class="button secondary" id="print-label">Print label</button></div><div class="note ${state.mode==='live'?'':'warn'}">${state.mode==='live'?'This link carries the session ID only. Engineer approval token stays in this browser.':'Local preview only: the link works in this browser, but cannot sync to a different phone until the live demo service is configured.'}</div></div></div></section>`)}
  function operator(){const s=state.session;const op=operations.find(o=>o.id===state.op)||operations[1];if(!s)return `${topbar('/operator')}${banner()}<main class="shell chapter"><h1>Part session unavailable</h1><p>${esc(state.error||'Open the demo from engineering to create a session.')}</p><a class="button" href="#/engineer">Go to engineering</a></main>`;const issues=(s.issues||[]).filter(i=>(i.operationId||'B2')===state.op);const held=issues.some(i=>i.holdActive!==false);const pending=issues.some(i=>!i.answer&&i.status!=='answered');return `${topbar('/operator')}${banner()}<main class="phone-page"><div class="phone"><div class="phone-header"><a class="back" href="#/qr">← Drawing / handoff</a><div class="eyebrow" style="margin-top:17px">Job 1042 · ${s.guideStatus==='approved'?'Release 1':'Draft preview'}</div><h1>Sensor Mount</h1><p><span class="mono">SKW-SM-104</span> · Drawing rev A · ${esc(state.facility)}</p></div><div class="phone-inner"><div class="section-head"><div><h2 style="font-size:19px">Choose the area</h2><p>Prepared part illustration and bend labels.</p></div></div><div class="op-chips" aria-label="Choose operation">${operations.map(o=>`<button class="op-chip ${state.op===o.id?'selected':''}" data-op="${o.id}" aria-pressed="${state.op===o.id}" title="${esc(o.title)}">${o.id}</button>`).join('')}</div>${model(state.op)}<section class="section"><div class="eyebrow">Selected / ${esc(state.op)}</div><h2 style="margin:6px 0">${esc(op.title)}</h2>${held?`<div class="step held"><div class="eyebrow" style="color:var(--ch-status-review)">Hold this operation</div><h3>${pending?'Await engineer decision.':'Engineer answer available · B2 hold remains.'}</h3><p>${pending?'Your issue was sent with Job 1042 and B2 context. Do not continue this affected operation based on an unconfirmed answer.':'Read the approved answer below. Engineering has not cleared this operation to resume.'}</p></div>`:''}${op.guide?`<div class="step"><div class="eyebrow">${s.guideStatus==='approved'?'Engineer-approved · Release 1':'Draft preview · not released'}</div><h3>${s.guideStatus==='approved'?esc(s.guideText):'The detailed B2 guide awaits engineer approval.'}</h3><p>Source: drawing revision A + authored bend manifest. The guide is an aid, not a certified machine sequence.</p></div>`:`<div class="step"><h3>Use the drawing for this routine area.</h3><p>No extra instruction card was approved for ${esc(state.op)}. Its 90° internal-angle target is shown in the prepared drawing and bend manifest.</p></div>`}${issues.map(i=>`<div class="step"><div class="eyebrow">${esc(i.kind==='flag'?'Flag':'Question')} · ${i.answer?'Engineer answered':'Sent to engineering'}</div><p style="margin:7px 0">${esc(i.body)}</p>${i.answer?`<div class="response"><strong>Approved answer · Release 1 context</strong>${esc(i.answer)}<div style="margin-top:8px">${status(i.holdActive===false?'Hold explicitly cleared by engineering':'B2 hold remains',i.holdActive===false?'good':'warn')}</div></div>`:status('Pending decision','warn')}</div>`).join('')}</section><section class="section"><h2>Need to ask or flag?</h2><p class="muted" style="font-size:13px;margin:0">The message carries Job 1042, ${esc(state.op)}, and this part’s release context.</p>${state.op==='B2'&&s.guideStatus==='approved'?`<form id="issue-form"><label class="field"><span>What needs attention?</span><textarea id="issue-body" required minlength="4" maxlength="500" placeholder="Describe the question or issue at this operation"></textarea></label><div class="phone-actions"><button class="button" type="submit" name="kind" value="question">Ask engineering</button><button class="button secondary" type="submit" name="kind" value="flag">Flag an issue</button></div></form>`:`<div class="note warn">${s.guideStatus!=='approved'?'The guide is still a draft. Engineering must approve it before floor feedback can be sent.':'This prepared live feedback loop covers B2 only. Select B2 to ask or flag in this demo.'}</div>`}<p class="muted" style="font-size:12px;margin-top:13px">Questions and flags go to the engineer. A flag places this operation on hold. Voice and photo intake need future work.</p></section></div></div></main>`}
  function phonePreview(){
    const op=operations.find(o=>o.id===state.op)||operations[1];
    return `<header class="topbar">${brand()}<nav class="top-links" aria-label="Primary"><a class="button slim" href="#/engineer">Explore demo ↗</a></nav></header>
      <div class="storage-banner preview-banner"><strong>Prepared phone preview</strong> · Example content only. This is not a live release or engineer approval.</div>
      <main class="phone-page"><div class="phone"><div class="phone-header"><a class="back" href="#/">← About Chappe</a><div class="eyebrow" style="margin-top:17px">Job 1042 · Sample guide preview</div><h1>Sensor Mount</h1><p><span class="mono">SKW-SM-104</span> · Drawing rev A · Prepared example</p></div>
      <div class="phone-inner"><div class="section-head"><div><h2 style="font-size:19px">Choose the area</h2><p>Prepared part illustration and bend labels.</p></div></div>
      <div class="op-chips" aria-label="Choose operation">${operations.map(o=>`<button class="op-chip ${state.op===o.id?'selected':''}" data-op="${o.id}" aria-pressed="${state.op===o.id}" title="${esc(o.title)}">${o.id}</button>`).join('')}</div>
      ${model(state.op)}
      <section class="section"><div class="eyebrow">Selected / ${esc(state.op)}</div><h2 style="margin:6px 0">${esc(op.title)}</h2>${op.guide?`<div class="step"><div class="eyebrow">Sample engineer-reviewed wording · preview only</div><h3>${esc(seed.guideText)}</h3><p>Prepared from drawing revision A and an authored bend manifest. A real engineer must review, correct and approve a release before this can be floor guidance. Tooling clearance remains unknown.</p></div>`:`<div class="step"><h3>No detailed guide proposed for this routine area.</h3><p>The drawing remains the source for ${esc(op.id)}. This preview does not validate the operation or issue instructions.</p></div>`}</section>
      <section class="section"><h2>Questions stay with the operation</h2><p class="muted">In a live approved session, an operator can ask or flag an issue and engineering sees the job, release and operation context. This preview cannot send a message.</p><a class="button" href="#/engineer">Start the live demo →</a><p class="muted" style="font-size:12px;margin-top:13px">To see a real session QR, review and approve B2 in the engineer workspace.</p></section>
      </div></div></main>`;
  }
  function drawQR(){const box=$('#qr-box');if(!box)return;if(!window.QRCode){box.textContent='QR unavailable · use the link';return}box.innerHTML='';try{window.QRCode.toString(operatorUrl(),{type:'svg',width:160,margin:1,color:{dark:'#1d1d1f',light:'#ffffff'}},(err,svg)=>{if(err){box.textContent='QR unavailable · use the link';return}box.innerHTML=svg})}catch{box.textContent='QR unavailable · use the link'}}
  let revealObserver;
  let brandMorph;
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  function setupBrandMorph(){
    brandMorph=null;
    if(currentRoute()!=='/')return;
    const scene=$('.brand-morph');const stage=$('.brand-morph-sticky');const canvas=$('#brand-morph-canvas');const context=canvas?.getContext('2d',{alpha:true});
    if(!scene||!stage||!canvas||!context)return;
    const sources=Array.from({length:96},(_,index)=>`assets/chappe-morph/frames/frame-${String(index).padStart(3,'0')}.webp`);
    const morph={scene,stage,canvas,context,sources,frames:[],current:-1};
    const draw=index=>{
      const image=morph.frames[index];if(!image||!image.complete||!image.naturalWidth)return;
      context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    };
    morph.draw=draw;
    morph.frames=sources.map((source,index)=>{
      const image=new Image();image.decoding='async';
      image.addEventListener('load',()=>{if(brandMorph===morph&&morph.current===index)draw(index)});
      image.src=source;return image;
    });
    brandMorph=morph;
    updateBrandMorph();
  }
  function updateBrandMorph(){
    const morph=brandMorph;if(!morph)return;
    const start=morph.scene.offsetTop;
    const travel=Math.max(1,morph.scene.offsetHeight-morph.stage.offsetHeight);
    const progress=reduceMotion.matches?1:Math.max(0,Math.min(1,(scrollY-start)/travel));
    const next=Math.round(progress*95);
    if(next!==morph.current){morph.current=next;morph.draw(next);}
    const hero=$('.morph-hero');if(!hero)return;
    const rawCopy=Math.max(0,Math.min(1,(progress-.62)/.38));
    const copy=reduceMotion.matches?1:1-Math.pow(1-rawCopy,3);
    morph.canvas.style.setProperty('--morph-y',`${Math.round(-copy*innerHeight*.26)}px`);
    morph.canvas.style.setProperty('--morph-scale',(1-copy*.19).toFixed(3));
    hero.style.setProperty('--morph-copy',copy.toFixed(3));
    hero.style.setProperty('--morph-copy-shift',`${Math.round((1-copy)*Math.min(innerHeight*.11,86))}px`);
  }
  function setupMotion(){
    revealObserver?.disconnect();document.body.classList.remove('motion-ready');setupBrandMorph();
    if(currentRoute()!=='/'||reduceMotion.matches||!('IntersectionObserver' in window)){updateScrollMotion();return;}
    document.body.classList.add('motion-ready');
    revealObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){entry.target.classList.add('is-visible');revealObserver.unobserve(entry.target)}}},{threshold:.1,rootMargin:'0px 0px -24px 0px'});
    document.querySelectorAll('.reveal').forEach(el=>revealObserver.observe(el));
    updateScrollMotion();
  }
  let motionFrame=0;
  function updateScrollMotion(){
    if(currentRoute()!=='/')return;
    updateBrandMorph();
    if(reduceMotion.matches)return;
    const section=$('.object-chapter');if(!section)return;
    const rect=section.getBoundingClientRect();const progress=Math.max(0,Math.min(1,(innerHeight-rect.top)/(innerHeight+rect.height)));
    document.documentElement.style.setProperty('--object-turn',`${(progress-.5)*12}deg`);
    const media=$('.hero-image');if(media){const top=media.getBoundingClientRect().top;document.documentElement.style.setProperty('--photo-shift',`${Math.max(-18,Math.min(18,(innerHeight/2-top)*.035))}px`)}
  }
  let workNavObserver;
  function setupWorkNavigation(){
    workNavObserver?.disconnect();
    const surface=$('.work-editorial--manufacturer');
    if(!surface)return;
    const buttons=Array.from(surface.querySelectorAll('[data-scroll]'));
    const sections=buttons.map(button=>document.getElementById(button.dataset.scroll)).filter(Boolean);
    const activate=id=>buttons.forEach(button=>{const active=button.dataset.scroll===id;button.classList.toggle('is-active',active);button.toggleAttribute('aria-current',active)});
    if(buttons[0])activate(buttons[0].dataset.scroll);
    if(!('IntersectionObserver' in window)||!sections.length)return;
    workNavObserver=new IntersectionObserver(entries=>{
      const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>Math.abs(a.boundingClientRect.top)-Math.abs(b.boundingClientRect.top));
      if(visible[0])activate(visible[0].target.id);
    },{rootMargin:'-25% 0px -58% 0px',threshold:0});
    sections.forEach(section=>workNavObserver.observe(section));
  }
  function updateTopbar(){document.querySelector('.topbar')?.classList.toggle('is-scrolled',window.scrollY>24)}
  window.addEventListener('scroll',()=>{if(motionFrame)return;motionFrame=requestAnimationFrame(()=>{motionFrame=0;updateTopbar();updateScrollMotion()})},{passive:true});
  reduceMotion.addEventListener('change',()=>setupMotion());
  function render(){const r=currentRoute();const page={'/':landing,'/engineer':engineer,'/engineer/job':engineerJob,'/engineer/new':engineerNew,'/review':review,'/manufacturer':manufacturer,'/issues':issues,'/qr':qr,'/operator':operator,'/phone-preview':phonePreview}[r]||landing;app.innerHTML=page();const title={'/':'Less back-and-forth','/engineer':'Engineering jobs','/engineer/job':'Sensor Mount','/engineer/new':'New job draft','/phone-preview':'Phone preview'}[r]||r.slice(1)[0].toUpperCase()+r.slice(2);document.title=`${title} · Chappe`;if(r==='/qr')drawQR();setupMotion();updateTopbar();}
  document.addEventListener('click',async e=>{
    const scrollTarget=e.target.closest('[data-scroll]');if(scrollTarget){e.preventDefault();document.getElementById(scrollTarget.dataset.scroll)?.scrollIntoView({behavior:reduceMotion.matches?'auto':'smooth'});return}
    const op=e.target.closest('[data-op]');if(op){state.op=op.dataset.op;render();return}
    const respond=e.target.closest('[data-respond]');if(respond){state.responding=respond.dataset.respond;render();$('#response-text')?.focus();return}
    if(e.target.closest('#publish,#publish-top')){if(state.session?.guideStatus==='approved'){toast('Release 1 is already approved and immutable.');return}if(!isPreparedFacility()){toast('This facility has no verified profile in the demo. Choose a prepared facility to publish.');return}if(state.facility==='Harbour Toolworks'){toast('Resolve the documented facility conflict before publishing.');return}const guideText=($('#guide-text')?.value||state.session?.guideText||'').trim();if(!guideText){toast('Write the B2 guidance before approving.');return}try{await mutate('approve',{guideText});toast('B2 guidance approved and released.');location.hash='#/qr'}catch(err){toast(err.message)}return}
    if(e.target.closest('#send-response')){const answer=($('#response-text')?.value||'').trim();if(!answer){toast('Write an engineer response first.');return}try{await mutate('respond',{issueId:e.target.closest('#send-response').dataset.issue,answer,holdActive:$('#keep-hold')?.checked!==false});state.responding=null;render();toast('Approved answer returned to the floor.')}catch(err){toast(err.message)}return}
    if(e.target.closest('#copy-link')){try{await navigator.clipboard.writeText(operatorUrl());toast('Operator link copied.')}catch{const input=$('#operator-link');input.select();document.execCommand('copy');toast('Operator link copied.')}return}
    if(e.target.closest('#print-label')){window.print();return}
    if(e.target.closest('#new-session')){await createSession();return}
    if(e.target.closest('#add-facility')){state.showInvite=!state.showInvite;render();return}
    if(e.target.closest('#copy-invite')){const input=$('#invite-link');if(!input)return;try{await navigator.clipboard.writeText(input.value)}catch{input.select();document.execCommand('copy')}toast('Invitation preview link copied.');return}
  });
  document.addEventListener('change',e=>{if(e.target.id==='facility'){state.facility=e.target.value;render()}if(e.target.id==='draft-facility')state.draftFacility=e.target.value;if(e.target.id==='source-files')selectFiles(e.target.files)});
  function selectFiles(files){const name=$('#draft-form [name="name"]');if(name)state.draftName=name.value;const facility=$('#draft-facility');if(facility)state.draftFacility=facility.value;const accepted=/\.(sldprt|sldasm|ipt|iam|step|stp|iges|igs|dxf|dwg|stl|obj|glb|pdf)$/i;const all=Array.from(files||[]);const valid=all.filter(f=>accepted.test(f.name));state.uploadFiles=valid.map(f=>({name:f.name,size:f.size}));render();toast(all.length===valid.length?`${valid.length} file${valid.length===1?'':'s'} selected in this browser. No upload or analysis occurred.`:`${all.length-valid.length} unsupported file${all.length-valid.length===1?'':'s'} skipped. No upload occurred.`)}
  document.addEventListener('dragover',e=>{if(e.target.closest('#file-drop')){e.preventDefault();e.target.closest('#file-drop').classList.add('dragging')}});
  document.addEventListener('dragleave',e=>{if(e.target.closest('#file-drop'))e.target.closest('#file-drop').classList.remove('dragging')});
  document.addEventListener('drop',e=>{const zone=e.target.closest('#file-drop');if(zone){e.preventDefault();zone.classList.remove('dragging');selectFiles(e.dataTransfer.files)}});
  document.addEventListener('submit',async e=>{if(e.target.id==='draft-form'){e.preventDefault();const form=new FormData(e.target);const name=String(form.get('name')||'').trim().slice(0,100);const files=state.uploadFiles.length?state.uploadFiles:jobDraft()?.files||[];if(!name||!files.length){toast('Give the draft a name and choose at least one file.');return}const draft={name,facility:String(form.get('facility')||''),files,savedAt:new Date().toISOString()};localStorage.setItem(DRAFT_STORAGE,JSON.stringify(draft));state.draftName=name;state.draftFacility=draft.facility;render();toast('Local draft saved. File names only; no upload occurred.');return}if(e.target.id==='invite-form'){e.preventDefault();const form=new FormData(e.target);const name=String(form.get('name')||'').trim().slice(0,100);const email=String(form.get('email')||'').trim().slice(0,200);if(!name||!email)return;if(['Ridgeway Fabrication','Harbour Toolworks',...customFacilities().map(f=>f.name)].some(x=>x.toLowerCase()===name.toLowerCase())){toast('That manufacturer is already in the list. Select it instead.');return}const existing=customFacilities();localStorage.setItem(FACILITIES_STORAGE,JSON.stringify([...existing,{name,email}]));state.facility=name;state.invitation={name,email,url:inviteUrl(name)};state.showInvite=true;render();toast('Preview link ready. No email was sent.');return}if(e.target.id==='profile-form'){e.preventDefault();const form=new FormData(e.target);const name=e.target.dataset.facility;const profile={processes:String(form.get('processes')||''),machines:String(form.get('machines')||''),thickness:String(form.get('thickness')||''),length:String(form.get('length')||''),limits:String(form.get('limits')||''),savedAt:new Date().toISOString()};const next=profiles();next[name]=profile;localStorage.setItem(PROFILE_STORAGE,JSON.stringify(next));render();toast('Facility draft saved in this browser only.');return}if(e.target.id!=='issue-form')return;e.preventDefault();if(state.op!=='B2'||state.session?.guideStatus!=='approved'){toast('B2 must be selected in an approved release.');return}const kind=e.submitter?.value||'question';const body=($('#issue-body')?.value||'').trim();if(body.length<4){toast('Add a short description before sending.');return}try{await mutate('issue',{kind,operationId:state.op,body});toast(kind==='flag'?'Flag sent. Hold this operation until engineering responds.':'Question sent to engineering. Hold this operation until answered.')}catch(err){toast(err.message)}});
  window.addEventListener('hashchange',async()=>{const requested=query().get('session');if(currentRoute()==='/phone-preview')render();else if(requested&&requested!==sessionId())await initSession(requested);else if(!state.session)await initSession();else render();window.scrollTo(0,0)});
  window.addEventListener('storage',e=>{if([STORAGE,TOKEN_STORAGE].includes(e.key)&&state.mode==='local'){state.session=normalize(getLocal()||seed);render()}});
  setInterval(()=>{if(currentRoute()==='/operator'||currentRoute()==='/issues')refresh()},3500);
  /* Public landing: an original, scroll-linked product narrative. The static SVG is
     deliberately a prepared illustration rather than a claim of manufacturing
     simulation. It keeps the opening useful even where WebGL is unavailable. */
  function precisionPartSvg(){
    return `<svg class="precision-hero__part" viewBox="0 0 1440 900" role="img" aria-label="Prepared Sensor Mount illustration moving from its flat pattern to a folded bracket with the B2 return flange selected.">
      <defs>
        <pattern id="precision-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="currentColor" stroke-width=".75"/></pattern>
        <linearGradient id="precision-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f8f8f5"/><stop offset=".5" stop-color="#9da6a4"/><stop offset="1" stop-color="#e6e8e3"/></linearGradient>
        <linearGradient id="precision-edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#35403d"/><stop offset="1" stop-color="#7c8985"/></linearGradient>
        <filter id="precision-shadow" x="-30%" y="-30%" width="160%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="22"/><feOffset dx="0" dy="24"/><feComponentTransfer><feFuncA type="linear" slope=".22"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <rect class="precision-hero__grid" width="1440" height="900" fill="url(#precision-grid)"/>
      <g class="precision-hero__flat">
        <path d="M385 308H1008V634H385Z" fill="#e6e9e5" stroke="#26302d" stroke-width="3"/>
        <path d="M260 308H385V634H260Z" fill="#cdd4d0" stroke="#26302d" stroke-width="3"/>
        <path d="M1008 308H1142V634H1008Z" fill="#cdd4d0" stroke="#26302d" stroke-width="3"/>
        <path d="M617 214H796V308H617Z" fill="#cdd4d0" stroke="#26302d" stroke-width="3"/>
        <path d="M640 634H774V716H640Z" fill="#cdd4d0" stroke="#26302d" stroke-width="3"/>
        <path d="M260 308V634M385 308V634M1008 308V634M617 308H796M640 634H774" fill="none" stroke="#3157c7" stroke-width="8" stroke-linecap="round"/>
        <g fill="#68736f" opacity=".72"><circle cx="528" cy="420" r="18"/><circle cx="866" cy="420" r="18"/><circle cx="528" cy="530" r="18"/><circle cx="866" cy="530" r="18"/></g>
        <g class="precision-hero__flat-measure" fill="none" stroke="#68736f" stroke-width="2"><path d="M385 258H1008M385 246V270M1008 246V270"/><path d="M1168 308V634M1156 308H1180M1156 634H1180"/></g>
        <g class="precision-hero__flat-measure" fill="#26302d" font-family="ui-monospace, monospace" font-size="20"><text x="635" y="245">120.0</text><text x="1190" y="485">80.0</text></g>
      </g>
      <g class="precision-hero__formed" filter="url(#precision-shadow)">
        <path d="M389 484 726 304 1080 451 747 635Z" fill="url(#precision-metal)" stroke="#f4f6f2" stroke-width="4"/>
        <path d="M389 484 747 635 747 743 389 565Z" fill="url(#precision-edge)" stroke="#cdd6d1" stroke-width="3"/>
        <path d="M747 635 1080 451 1080 560 747 743Z" fill="#62716d" stroke="#d6dfd9" stroke-width="3"/>
        <path d="M389 484 306 446 306 555 389 565Z" fill="#3157c7" stroke="#9bb0ee" stroke-width="4"/>
        <path d="M306 446 389 484 747 635 669 600Z" fill="#254694" stroke="#a4b9f2" stroke-width="3"/>
        <path d="M726 304 812 273 1160 416 1080 451Z" fill="#b3bdb9" stroke="#e9eeea" stroke-width="3"/>
        <path d="M747 635 822 670 822 748 747 743Z" fill="#8e9b96" stroke="#e3eae5" stroke-width="3"/>
        <g fill="#44514d"><circle cx="586" cy="491" r="20"/><circle cx="819" cy="389" r="20"/><circle cx="889" cy="511" r="20"/></g>
        <g fill="#aeb8b4"><circle cx="586" cy="491" r="11"/><circle cx="819" cy="389" r="11"/><circle cx="889" cy="511" r="11"/></g>
      </g>
      <g class="precision-hero__focus">
        <path d="M329 493 140 409H74" fill="none" stroke="#3157c7" stroke-width="3"/>
        <circle cx="329" cy="493" r="9" fill="#3157c7"/>
        <rect x="74" y="352" width="235" height="85" fill="#f3f0e9" stroke="#3157c7" stroke-width="2"/>
        <text x="96" y="385" fill="#3157c7" font-family="ui-monospace, monospace" font-size="16">B2 / RETURN FLANGE</text>
        <text x="96" y="414" fill="#141815" font-family="ui-sans-serif, system-ui, sans-serif" font-size="19">Review required</text>
      </g>
      <g class="precision-hero__release">
        <path d="M1080 507 1247 435h92" fill="none" stroke="#141815" stroke-width="2"/>
        <rect x="1240" y="378" width="142" height="118" fill="#f3f0e9" stroke="#141815" stroke-width="2"/>
        <path d="M1260 398h40v40h-40zM1321 398h40v40h-40zM1260 456h40v20h-40zM1321 456h40v20h-40z" fill="#141815"/>
        <text x="1245" y="534" fill="#141815" font-family="ui-monospace, monospace" font-size="16">RELEASE 03</text>
      </g>
    </svg>`
  }

  function landing(){
    return `${topbar('/')}<main class="precision-landing">
      <section id="precision-hero" class="precision-hero" aria-labelledby="precision-hero-title">
        <div class="precision-hero__sticky" data-phase="source">
          <div class="precision-hero__meta precision-hero__meta--left">CHAPPE / REVIEWED HANDOFFS</div>
          <div class="precision-hero__meta precision-hero__meta--right">SKW-SM-104 / PREPARED DEMO</div>
          ${precisionPartSvg()}
          <div class="precision-hero__state" aria-hidden="true">
            <p class="precision-hero__state-item precision-hero__state-item--source"><span>01</span> Source packet / Drawing A</p>
            <p class="precision-hero__state-item precision-hero__state-item--facility"><span>02</span> Facility context / Ridgeway</p>
            <p class="precision-hero__state-item precision-hero__state-item--review"><span>03</span> B2 / engineer review</p>
            <p class="precision-hero__state-item precision-hero__state-item--release"><span>04</span> Released guide / QR linked</p>
          </div>
          <div class="precision-hero__copy">
            <p class="precision-kicker">Manufacturing handoffs, reviewed.</p>
            <h1 id="precision-hero-title">Make difficult operations clear <em>before they reach the floor.</em></h1>
            <p class="precision-hero__lede">Chappe turns a design packet into a reviewed handoff: documented facility context, only the guidance that needs explanation, and a QR-linked release for the workshop.</p>
            <div class="precision-hero__actions">
              <a class="precision-button" href="#/engineer">Explore the prepared handoff <span aria-hidden="true">↗</span></a>
              <a class="precision-link" href="#precision-story">See how it works <span aria-hidden="true">↓</span></a>
            </div>
            <p class="precision-hero__note">Evidence informs the release. An engineer approves it.</p>
          </div>
          <p class="sr-only">The prepared Sensor Mount illustration changes from a flat drawing to a folded part, then marks its B2 return flange as requiring review before its release QR is shown.</p>
        </div>
      </section>

      <section id="precision-story" class="precision-manifest shell" aria-labelledby="manifest-title">
        <div class="precision-manifest__headline reveal">
          <p class="precision-index">01 / THE HANDOFF</p>
          <h2 id="manifest-title">A drawing carries dimensions. Chappe carries the decisions around them.</h2>
        </div>
        <div class="precision-manifest__detail reveal">
          <p>Tooling notes, facility limits, a difficult operation and the reason behind it often split across PDFs, email and memory. Chappe keeps them attached to the work—not to the person who happens to remember.</p>
          <dl class="precision-manifest__facts">
            <div><dt>Source</dt><dd>Drawing A + authored model</dd></div>
            <div><dt>Facility</dt><dd>Recorded capability, not assumed capacity</dd></div>
            <div><dt>Release</dt><dd>Engineer-approved guidance for the floor</dd></div>
          </dl>
        </div>
      </section>

      <section class="precision-packet">
        <div class="shell precision-packet__grid">
          <div class="precision-packet__copy reveal">
            <p class="precision-index">02 / THE PACKET</p>
            <h2>Before a part moves, its context should arrive intact.</h2>
            <p>Chappe puts the drawing, documented workshop facts, and the small number of operations that need human explanation in one release path.</p>
            <a class="precision-link" href="assets/sensor-mount-alpha.drawing.pdf">View the prepared drawing <span aria-hidden="true">↗</span></a>
          </div>
          <div class="precision-packet__artifact reveal" aria-label="An illustration of a Chappe handoff packet">
            <div class="packet-sheet packet-sheet--drawing"><span>DRAWING A</span><strong>Sensor Mount</strong><i>120 × 80 / 2.0 mm</i><b>B2</b></div>
            <div class="packet-sheet packet-sheet--facility"><span>FACILITY RECORD</span><strong>Ridgeway</strong><i>Documented support / 2</i><i>Unknown / 1</i></div>
            <div class="packet-sheet packet-sheet--review"><span>ENGINEER REVIEW</span><strong>Return flange</strong><i>B2 · needs guidance</i><b>Approved in release 03</b></div>
            <svg class="packet-wire" viewBox="0 0 620 430" aria-hidden="true"><path d="M76 103C252 56 349 96 521 88M80 311C223 370 377 347 528 303" fill="none"/><circle cx="76" cy="103" r="7"/><circle cx="521" cy="88" r="7"/><circle cx="80" cy="311" r="7"/><circle cx="528" cy="303" r="7"/></svg>
          </div>
        </div>
      </section>

      <section class="precision-steps shell" aria-labelledby="steps-title">
        <div class="precision-steps__title reveal">
          <p class="precision-index">03 / THE DECISIONS</p>
          <h2 id="steps-title">One handoff.<br>Four deliberate moments.</h2>
        </div>
        <div class="precision-steps__list">
          <article class="precision-step reveal"><span>01</span><div><h3>Read the source packet.</h3><p>Keep the drawing and the authored model beside the job, with scope visible.</p></div><small>Drawing A</small></article>
          <article class="precision-step reveal"><span>02</span><div><h3>Check the receiving facility.</h3><p>Show documented support, conflict and unknown separately—never an invented green tick.</p></div><small>Facility record</small></article>
          <article class="precision-step reveal"><span>03</span><div><h3>Review the difficult work.</h3><p>Give the return flange extra guidance; let routine work stay routine. An engineer owns the wording.</p></div><small>B2 / review</small></article>
          <article class="precision-step reveal"><span>04</span><div><h3>Release one exact guide.</h3><p>A QR opens the approved operation in its job and release context, ready for the workshop.</p></div><small>Release 03</small></article>
        </div>
      </section>

      <section id="trace-chapter" class="precision-trace" aria-labelledby="trace-title">
        <div class="precision-trace__sticky" data-trace="source">
          <header class="precision-trace__head shell">
            <p class="precision-index">04 / TRACEABILITY</p>
            <h2 id="trace-title">One release. <em>Every decision traceable.</em></h2>
          </header>
          <div class="precision-trace__scene shell">
            <div class="trace-map" aria-hidden="true">
              <div class="trace-map__drawing"><span>DRAWING A</span><i></i><i></i><i></i></div>
              <div class="trace-map__facility"><span>Ridgeway Fabrication</span><strong>DOCUMENTED SUPPORT</strong><small>Tool reach: unknown</small></div>
              <div class="trace-map__part"><svg viewBox="0 0 420 300"><path d="M78 148 208 79 350 137 220 211Z" fill="currentColor"/><path d="M78 148 220 211v47L78 190Z" fill="currentColor"/><path d="M220 211 350 137v48l-130 73Z" fill="currentColor"/><path d="M78 148 44 132v45l34 13Z" class="trace-map__b2"/></svg><b>B2</b></div>
              <div class="trace-map__release"><span>RELEASE 03</span><div class="trace-map__qr"></div><small>Engineer approved</small></div>
              <svg class="trace-map__path" viewBox="0 0 1100 500"><path d="M75 278C257 278 240 146 430 146s197 121 365 121 139-73 236-73" fill="none"/><circle cx="75" cy="278" r="8"/><circle cx="430" cy="146" r="8"/><circle cx="795" cy="267" r="8"/><circle cx="1031" cy="194" r="8"/></svg>
            </div>
            <div class="precision-trace__copy">
              <article class="trace-copy trace-copy--source"><span>01</span><h3>Source first.</h3><p>The release starts with the part and the source packet it can actually cite.</p></article>
              <article class="trace-copy trace-copy--facility"><span>02</span><h3>Evidence has a location.</h3><p>Facility information is shown as recorded support, a documented conflict, or an explicit unknown.</p></article>
              <article class="trace-copy trace-copy--review"><span>03</span><h3>One operation gets focus.</h3><p>B2 is isolated because it needs context; routine bends do not turn into noise.</p></article>
              <article class="trace-copy trace-copy--release"><span>04</span><h3>The floor receives a reviewed release.</h3><p>The QR keeps the exact job, version and approved guidance connected.</p></article>
            </div>
          </div>
        </div>
      </section>

      <section class="precision-floor shell" aria-labelledby="floor-title">
        <div class="precision-floor__intro reveal">
          <p class="precision-index">05 / THE FLOOR LOOP</p>
          <h2 id="floor-title">One scan opens the exact work.</h2>
          <p>No hunting through a manual. No detached question. The operator arrives at the selected operation, with the release and source context already in place.</p>
          <a class="precision-button precision-button--light" href="#/phone-preview">Open the phone guide <span aria-hidden="true">↗</span></a>
        </div>
        <div class="precision-floor__object reveal">
          <div class="floor-qr"><a href="${PHONE_PREVIEW_URL}" aria-label="Open the prepared Chappe phone guide"><img src="assets/phone-preview-qr.svg" alt="QR code for the prepared Chappe Sensor Mount B2 phone guide"></a><span>PREPARED / B2</span></div>
          <div class="floor-phone" aria-label="Illustration of the Chappe phone guide for return flange B2"><div class="floor-phone__top"><span>‹ Job 1042</span><b>Release 03</b></div><div class="floor-phone__part"><svg viewBox="0 0 260 165" aria-hidden="true"><path d="M43 80 126 39l91 38-85 48Z" fill="currentColor"/><path d="M43 80 132 125v22L43 103Z" fill="currentColor"/><path d="M132 125 217 77v23l-85 47Z" fill="currentColor"/><path d="M43 80 21 70v26l22 8Z" fill="#3157c7"/></svg></div><div class="floor-phone__body"><small>OPERATION 02 / B2</small><strong>Return flange orientation</strong><p>Align the marked flange before bending. Confirm the setup if reach is not recorded.</p><button type="button">Ask engineering</button></div></div>
          <p class="floor-loop-label"><span></span> Issue returns with job, release and operation context.</p>
        </div>
      </section>

      <section class="precision-truth" aria-labelledby="truth-title">
        <div class="shell">
          <div class="precision-truth__head reveal"><p class="precision-index">06 / TRUST</p><h2 id="truth-title">No green tick where the evidence is missing.</h2><p>Automation can propose. People release.</p></div>
          <div class="precision-truth__rows reveal">
            <div class="truth-row truth-row--support"><span>Documented support</span><strong>Recorded facility fact meets the stated value.</strong><i>Source present</i></div>
            <div class="truth-row truth-row--conflict"><span>Documented conflict</span><strong>Recorded facility fact contradicts a requirement.</strong><i>Human decision</i></div>
            <div class="truth-row truth-row--unknown"><span>Unknown</span><strong>Evidence is missing or outside the prepared check.</strong><i>Review required</i></div>
          </div>
        </div>
      </section>

      <section class="precision-close shell" aria-labelledby="close-title">
        <div class="precision-close__inner reveal">
          <p class="precision-index">CHAPPE / READY TO HAND OFF</p>
          <h2 id="close-title">Send a reviewed release,<br><em>not just a drawing.</em></h2>
          <a class="precision-button" href="#/engineer">Open the prepared demo <span aria-hidden="true">↗</span></a>
          <p>Prepared Sensor Mount demonstration. Chappe surfaces documented evidence and review decisions; it does not certify physical feasibility.</p>
        </div>
      </section>
    </main><footer class="precision-footer shell"><span>Chappe · A SkunkWorks project</span><span>Prepared synthetic Sensor Mount example · Demonstration only</span></footer>`
  }

  function recordLogo(){
    return `<a class="record-nav__brand" href="#/" aria-label="Chappe home"><span class="record-nav__mark" aria-hidden="true"></span><span>Chappe</span></a>`;
  }
  function recordHeader(){
    return `<header class="record-nav">
      ${recordLogo()}
      <nav class="record-nav__links" aria-label="Landing page sections">
        <a href="#/" data-scroll="record-story">The handoff</a>
        <a href="#/" data-scroll="record-release">Workflow</a>
        <a href="#/" data-scroll="record-views">Demo</a>
      </nav>
      <div class="record-nav__actions"><a class="record-nav__utility" href="https://github.com/HenryFowlerr/SkunkWorks" target="_blank" rel="noreferrer">GitHub ↗</a><a class="record-nav__workspace" href="#/engineer">Engineering <span aria-hidden="true">↗</span></a><a class="record-nav__demo" href="#/manufacturer">Manufacturing <span aria-hidden="true">↗</span></a></div>
    </header>`;
  }
  function recordPartSvg(){
    return `<svg viewBox="0 0 670 480" aria-hidden="true">
      <path d="M91 235 325 113 565 216 327 344Z" fill="currentColor" opacity=".95"/>
      <path d="M91 235 327 344v75L91 309Z" fill="currentColor" opacity=".62"/>
      <path d="M327 344 565 216v75L327 419Z" fill="currentColor" opacity=".78"/>
      <path d="M91 235 35 211v69l56 29Z" fill="#2357af"/>
      <path d="M35 211 91 235l236 109-55-24Z" fill="#4978bf"/>
      <path d="M325 113 375 89l239 102-49 25Z" fill="currentColor" opacity=".78"/>
      <path d="M565 216 614 191v74l-49 26Z" fill="currentColor" opacity=".51"/>
      <path d="M207 175 444 276M162 199 398 301M116 224 354 325" fill="none" opacity=".36" stroke="#151515" stroke-width="3"/>
      <ellipse cx="264" cy="221" fill="#4e555c" rx="21" ry="12" transform="rotate(24 264 221)"/>
      <ellipse cx="398" cy="276" fill="#4e555c" rx="21" ry="12" transform="rotate(24 398 276)"/>
      <ellipse cx="455" cy="221" fill="#4e555c" rx="21" ry="12" transform="rotate(24 455 221)"/>
    </svg>`;
  }
  function recordHeroArt(){
    return `<div class="record-hero__art" aria-hidden="true"><svg viewBox="0 0 1430 980">
      <defs>
        <linearGradient id="recordHeroMetal" x1=".1" y1=".1" x2=".9" y2=".9"><stop offset="0" stop-color="#fafaf9"/><stop offset=".35" stop-color="#bec3c8"/><stop offset=".62" stop-color="#777d85"/><stop offset="1" stop-color="#e8ebeb"/></linearGradient>
        <linearGradient id="recordHeroEdge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#3b444b"/><stop offset="1" stop-color="#a8afb5"/></linearGradient>
        <filter id="recordHeroShadow" x="-30%" y="-35%" width="170%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="20"/><feOffset dy="28"/><feComponentTransfer><feFuncA type="linear" slope=".24"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <g class="record-hero__flow" fill="none" opacity=".82" stroke="#2357af" stroke-width="3">
        <path d="M-35 156C164 185 264 103 492 199s318 50 570 23"/><path d="M-30 185C142 220 285 124 487 217s341 60 604 31"/><path d="M-43 217C145 250 276 151 496 236s327 58 597 47"/><path d="M-45 252C126 282 286 183 496 252s330 80 595 64"/><path d="M-55 291C136 310 268 219 498 274s342 80 612 77"/><path d="M-42 325C142 344 281 244 506 299s320 88 611 98"/><path d="M-65 358C130 382 297 277 514 327s322 94 613 120"/><path d="M-60 391C146 407 297 300 521 353s320 99 615 145"/><path d="M-50 425C154 433 302 330 534 385s322 94 596 164"/><path d="M-44 461C139 470 316 353 538 411s322 91 582 182"/>
      </g>
      <g class="record-hero__source" fill="none">
        <path d="M82 190 650 52 1125 260 553 440Z" fill="#d9dddf" opacity=".88" stroke="#8c979e" stroke-width="4"/>
        <path d="M141 201 642 80 1052 259 552 408Z" stroke="#2357af" stroke-width="3"/>
        <path d="M269 171 674 345M381 145 786 319M496 118 901 291M609 91 1014 264" opacity=".4" stroke="#485158" stroke-width="3"/>
        <path d="M137 201 139 364M550 408l4-161M1048 261l3-156" stroke="#2357af" stroke-dasharray="8 10" stroke-width="3"/>
        <circle cx="423" cy="234" fill="#eff0ef" r="21" stroke="#6a737a" stroke-width="3"/><circle cx="690" cy="214" fill="#eff0ef" r="21" stroke="#6a737a" stroke-width="3"/><circle cx="793" cy="298" fill="#eff0ef" r="21" stroke="#6a737a" stroke-width="3"/>
        <path d="M90 468H1117M90 452v31M1117 452v31" stroke="#626c73" stroke-width="3"/>
      </g>
      <g class="record-hero__mount" filter="url(#recordHeroShadow)">
        <path d="M273 383 655 188 1058 356 675 559Z" fill="url(#recordHeroMetal)" stroke="#f7f8f8" stroke-width="5"/>
        <path d="M273 383 675 559v126L273 496Z" fill="url(#recordHeroEdge)" stroke="#dce2e3" stroke-width="4"/>
        <path d="M675 559 1058 356v126L675 685Z" fill="#77818a" stroke="#dae0e2" stroke-width="4"/>
        <path d="M273 383 185 344v113l88 39Z" fill="#2357af" stroke="#9ac1ff" stroke-width="4"/>
        <path d="M185 344 273 383l402 176-88-39Z" fill="#3f74c6" stroke="#c8dcff" stroke-width="3"/>
        <path d="M655 188 737 150l403 168-82 38Z" fill="#c6cbd0" stroke="#eef1f1" stroke-width="4"/>
        <path d="M1058 356 1140 318v126l-82 38Z" fill="#606a73" stroke="#c8d0d3" stroke-width="4"/>
        <path d="M462 286 861 452M383 326 785 494M305 366 705 534" fill="none" opacity=".32" stroke="#535e65" stroke-width="4"/>
        <ellipse cx="556" cy="369" fill="#5e6973" rx="33" ry="18" transform="rotate(23 556 369)"/><ellipse cx="770" cy="456" fill="#5e6973" rx="33" ry="18" transform="rotate(23 770 456)"/><ellipse cx="857" cy="365" fill="#5e6973" rx="33" ry="18" transform="rotate(23 857 365)"/>
      </g>
      <g class="record-hero__callout" fill="none"><path d="M215 427h-124v-108" stroke="#2357af" stroke-width="4"/><rect x="62" y="283" width="190" height="49" fill="#f5f2ef" stroke="#2357af" stroke-width="2"/><text x="78" y="314" fill="#2357af" font-family="ui-monospace,monospace" font-size="17" font-weight="700">B2 / REVIEW</text></g>
    </svg></div>`;
  }
  function recordSourceArt(){
    return `<svg viewBox="0 0 460 350" aria-hidden="true"><rect x="74" y="44" width="310" height="222" fill="#eeeae6" stroke="#151515" stroke-width="2"/><path d="M114 106h220M114 139h182M114 172h235M114 205h136" stroke="#8e8984" stroke-width="3"/><path d="M127 251 197 218l78 34-71 38Z" fill="none" stroke="#2357af" stroke-width="3"/><path d="M155 101v115M265 101v115" stroke="#2357af" stroke-dasharray="7 7" stroke-width="3"/><text x="93" y="75" font-family="ui-monospace,monospace" font-size="12" font-weight="700">DRAWING / REV 04</text><text x="93" y="290" fill="#6e6964" font-family="ui-monospace,monospace" font-size="11">CAD · NOTE · SOURCE</text></svg>`;
  }
  function recordEvidenceArt(){
    return `<svg viewBox="0 0 460 350" aria-hidden="true"><path d="M88 75h286M88 133h286M88 191h286M88 249h286" stroke="#9f9a95" stroke-dasharray="7 7" stroke-width="2"/><path d="M183 48v227M285 48v227" stroke="#9f9a95" stroke-dasharray="7 7" stroke-width="2"/><rect x="110" y="92" width="50" height="24" fill="#151515"/><rect x="205" y="150" width="50" height="24" fill="#2357af"/><rect x="308" y="208" width="50" height="24" fill="#c7c1bb"/><path d="M135 104 230 162 333 220" fill="none" stroke="#2357af" stroke-width="3"/><circle cx="135" cy="104" r="8" fill="#f5f2ef" stroke="#151515" stroke-width="3"/><circle cx="230" cy="162" r="8" fill="#f5f2ef" stroke="#2357af" stroke-width="3"/><circle cx="333" cy="220" r="8" fill="#f5f2ef" stroke="#151515" stroke-width="3"/><text x="84" y="321" fill="#6e6964" font-family="ui-monospace,monospace" font-size="11">SUPPORT · CONFLICT · UNKNOWN</text></svg>`;
  }
  function recordGuideArt(){
    return `<svg viewBox="0 0 460 350" aria-hidden="true"><rect x="164" y="30" width="142" height="282" fill="#e9e6e2" stroke="#151515" stroke-width="3"/><path d="M178 65h114M178 78h74" stroke="#8b8681" stroke-width="3"/><rect x="181" y="107" width="108" height="92" fill="#171717"/><path d="M195 160 232 136l42 18-38 23Z" fill="#d8dbdd"/><path d="M195 160 232 177v10l-37-17Z" fill="#87909a"/><path d="M232 177 274 154v10l-42 23Z" fill="#2357af"/><rect x="181" y="216" width="74" height="12" fill="#2357af"/><path d="M181 244h102M181 258h78M181 272h92" stroke="#8b8681" stroke-width="3"/><path d="M80 92h52v52H80zM329 213h51v51h-51z" fill="none" stroke="#2357af" stroke-width="4"/><path d="M94 106h23v23H94zM343 227h22v22h-22z" fill="#2357af"/></svg>`;
  }
  function recordStagePart(){
    return `<svg viewBox="0 0 670 480" aria-hidden="true"><path d="M91 235 325 113 565 216 327 344Z" fill="#d9dfe1"/><path d="M91 235 327 344v75L91 309Z" fill="#64707a"/><path d="M327 344 565 216v75L327 419Z" fill="#939da5"/><path d="M91 235 35 211v69l56 29Z" fill="#2357af"/><path d="M35 211 91 235l236 109-55-24Z" fill="#4f80ca"/><path d="M325 113 375 89l239 102-49 25Z" fill="#d2d6d9"/><path d="M565 216 614 191v74l-49 26Z" fill="#6f7982"/><path d="M207 175 444 276M162 199 398 301M116 224 354 325" fill="none" opacity=".42" stroke="#4c545b" stroke-width="3"/><ellipse cx="264" cy="221" fill="#4c5660" rx="21" ry="12" transform="rotate(24 264 221)"/><ellipse cx="398" cy="276" fill="#4c5660" rx="21" ry="12" transform="rotate(24 398 276)"/><ellipse cx="455" cy="221" fill="#4c5660" rx="21" ry="12" transform="rotate(24 455 221)"/></svg>`;
  }
  function recordLanding(){
    return `${recordHeader()}<main class="record-landing">
      <section id="record-hero" class="record-hero" aria-labelledby="record-hero-title"><div class="record-hero__sticky">
        ${recordHeroArt()}
        <div class="record-hero__copy"><h1 id="record-hero-title" class="record-hero__headline">From design<br>to the floor,<br>with <em>the answers.</em></h1></div>
        <aside class="record-hero__aside"><p>Chappe turns CAD and drawings into a checked, reviewed release the workshop can actually use.</p><a class="record-button" href="#/engineer">See the handoff <span aria-hidden="true">↗</span></a></aside>
        <div class="record-hero__rule record-rule"></div>
      </div></section>

      <section id="record-story" class="record-shift record-shell" aria-labelledby="record-story-title">
        <div class="record-rule"></div><div class="record-shift__chain" aria-label="The source chain"><span>CAD</span><i>/</i><span>DRAWING</span><i>/</i><span>NOTE</span><i>/</i><span>DECISION</span><i>/</i><span>GUIDE</span></div>
        <div class="record-shift__head"><p class="record-label">The handoff gap</p><h2 id="record-story-title">A drawing starts the job.<br>Context should not disappear <em>after it.</em></h2></div>
        <div class="record-dash"></div>
        <div class="record-shift__lower">
          <div class="record-shift__copy record-reveal reveal"><p>Chappe keeps the source, facility evidence, engineering decisions, and operator guidance attached to one release.</p><a class="record-button" href="#/engineer">Explore a release <span aria-hidden="true">↗</span></a></div>
          <div class="record-shift__visual record-reveal reveal">${recordStagePart()}</div>
          <aside class="record-proof record-reveal reveal"><span class="record-proof__micro">Prepared release</span><strong>Sensor Mount<br>SKW-SM-104</strong><span>Ridgeway Fabrication<br>B2 return flange</span><a href="#/engineer">Engineering review required ↗</a></aside>
        </div>
      </section>

      <section class="record-approach record-shell" aria-labelledby="record-approach-title"><div class="record-rule"></div><p class="record-label record-approach__label">A release, not a file</p>
        <div class="record-approach__grid">
          <article class="record-approach__column record-reveal reveal"><div class="record-approach__art">${recordSourceArt()}</div><h3>Keep the source attached</h3><p>CAD, drawings, notes, and revision context travel with the job—so engineering and manufacturing begin from the same evidence.</p></article>
          <article class="record-approach__column record-reveal reveal"><div class="record-approach__art">${recordEvidenceArt()}</div><h3>Show capability gaps early</h3><p>Surface supported, conflicting, and unknown requirements before a release becomes a workshop surprise.</p></article>
          <article class="record-approach__column record-reveal reveal"><div class="record-approach__art">${recordGuideArt()}</div><h3>Put the exact operation at the machine</h3><p>A QR opens the approved, operation-specific guide where the work happens. Questions route back in context.</p></article>
        </div><h2 id="record-approach-title" class="record-approach__word">THE HANDOFF</h2>
      </section>

      <section id="record-release" class="record-platform" aria-labelledby="record-release-title"><div class="record-platform__sticky">
        <h2 id="record-release-title" class="record-platform__name">THE RELEASE</h2>
        <div class="record-platform__top"><div class="record-rule"></div><div class="record-platform__meta"><p class="record-label">One release. Shared context.</p><p>Not another dashboard. One evidence trail from drawing to machine.</p></div></div>
        <div class="record-platform__stage" data-stage="source" aria-label="Chappe release sequence showing source packet, engineering review, and a floor guide">
          <div class="record-stage__source"><h4>01 / SOURCE PACKET</h4><svg viewBox="0 0 210 200" aria-hidden="true"><path d="M28 102 104 59l78 35-74 44Z" fill="none" stroke="#202020" stroke-width="2"/><path d="M28 102 104 146v22L28 125ZM104 146l78-52v22l-78 52Z" fill="#aeb5ba" stroke="#202020" stroke-width="2"/><path d="M55 86v71M149 75v71" stroke="#2357af" stroke-dasharray="5 5" stroke-width="2"/><path d="M22 32h150M22 43h110M22 54h139" stroke="#817d78" stroke-width="2"/></svg><small>DRAWING · CAD · REVISION</small></div>
          <div class="record-stage__part">${recordStagePart()}</div>
          <div class="record-stage__callout"><i></i>B2 / COMPLEX OPERATION<br>ENGINEER REVIEW</div>
          <a class="record-stage__release" href="#/phone-preview" aria-label="Open the prepared floor guide"><strong>04 / FLOOR GUIDE</strong><img class="record-stage__qr" src="assets/phone-preview-qr.svg" alt=""/><small>SCAN QR · OPEN OPERATION ↗</small></a>
          <svg class="record-stage__route" viewBox="0 0 1120 520" preserveAspectRatio="none" aria-hidden="true"><path d="M108 268C288 268 305 136 540 188s187 183 387 136" vector-effect="non-scaling-stroke"/></svg>
        </div>
      </div></section>

      <section class="record-features record-shell" aria-labelledby="record-features-title"><div class="record-rule record-features__rule"></div><p id="record-features-title" class="record-label record-features__label">What moves with the part</p>
        <div class="record-features__grid">
          <article class="record-feature record-reveal reveal"><div class="record-feature__art">${recordSourceArt()}</div><h3>Source, not screenshots</h3><p>Keep the original design evidence behind every manufacturing decision.</p></article>
          <article class="record-feature record-reveal reveal"><div class="record-feature__art">${recordEvidenceArt()}</div><h3>Uncertainty, made visible</h3><p>Put conflicts and unresolved questions in view before the job reaches the floor.</p></article>
          <article class="record-feature record-reveal reveal"><div class="record-feature__art">${recordGuideArt()}</div><h3>Guidance at the point of work</h3><p>Release a clear machine-side guide that an operator can open in seconds.</p></article>
        </div><div class="record-features__action"><a class="record-button record-button--paper" href="#/engineer">View the prepared demo <span aria-hidden="true">↗</span></a></div>
      </section>

      <section id="record-views" class="record-views record-shell" aria-labelledby="record-views-title"><div class="record-views__layout">
        <div id="record-view-preview" class="record-views__object" data-view="engineering" aria-hidden="true">${recordPartSvg()}<span id="record-view-preview-title" class="record-views__preview-title">01 / ENGINEERING VIEW</span><small>ONE RELEASE / FOUR CONNECTED VIEWS</small></div>
        <div class="record-views__content"><p class="record-label">One handoff, four views</p><h2 id="record-views-title" class="sr-only">One handoff, four views</h2>
          <button type="button" class="record-view is-active" data-record-view="engineering" data-preview="01 / ENGINEERING VIEW" data-description="Send source intent, own decisions, and close the loop on complex operations." aria-pressed="true"><strong>Engineering</strong><span>01 / REVIEW ↗</span></button>
          <button type="button" class="record-view" data-record-view="workshop" data-preview="02 / WORKSHOP VIEW" data-description="Check the job against actual capability before accepting the work." aria-pressed="false"><strong>Workshop</strong><span>02 / CHECK ↗</span></button>
          <button type="button" class="record-view" data-record-view="operator" data-preview="03 / OPERATOR VIEW" data-description="Scan the release and open the approved guide at the point of work." aria-pressed="false"><strong>Operator</strong><span>03 / GUIDE ↗</span></button>
          <button type="button" class="record-view" data-record-view="feedback" data-preview="04 / FEEDBACK VIEW" data-description="Route the real question back to the person who can answer it." aria-pressed="false"><strong>Feedback</strong><span>04 / QUESTION ↗</span></button>
          <p id="record-view-description" class="record-view__description">Send source intent, own decisions, and close the loop on complex operations.</p>
        </div>
      </div></section>

      <section class="record-close record-shell" aria-labelledby="record-close-title"><div class="record-rule"></div><div class="record-close__inner"><h2 id="record-close-title">Manufacturing handoffs,<br>with the context intact.</h2><aside class="record-close__aside"><p>Chappe makes the path from a drawing to a finished part visible, reviewable, and usable by the people doing the work.</p><a class="record-button" href="#/engineer">Open the prepared demo <span aria-hidden="true">↗</span></a></aside></div></section>
    </main>
    <footer class="record-footer record-shell"><div class="record-footer__brand">Chappe</div><div><strong>Product</strong><a href="#/" data-scroll="record-story">The handoff</a><a href="#/" data-scroll="record-release">Workflow</a></div><div><strong>Demo</strong><a href="#/engineer">Prepared release</a><a href="#/phone-preview">Floor guide</a></div><div><strong>Project</strong><a href="https://github.com/HenryFowlerr/SkunkWorks" target="_blank" rel="noreferrer">GitHub ↗</a><span>A SkunkWorks project</span></div><div class="record-footer__legal">Prepared synthetic Sensor Mount example · Demonstration only · Chappe does not certify physical feasibility.</div></footer>`;
  }

  let recordScene;
  function setupBrandMorph(){
    recordScene=null;
    if(currentRoute()!=='/')return;
    const hero=$('#record-hero');
    const heroSticky=$('.record-hero__sticky');
    const stage=$('.record-platform__stage');
    const release=$('#record-release');
    const releaseSticky=$('.record-platform__sticky');
    if(!hero||!heroSticky||!stage||!release||!releaseSticky)return;
    recordScene={hero,heroSticky,stage,release,releaseSticky};
    document.querySelectorAll('[data-record-view]').forEach(button=>button.addEventListener('click',()=>{
      document.querySelectorAll('[data-record-view]').forEach(item=>{
        const active=item===button;
        item.classList.toggle('is-active',active);
        item.setAttribute('aria-pressed',String(active));
      });
      const description=$('#record-view-description');if(description)description.textContent=button.dataset.description||'';
      const preview=$('#record-view-preview');if(preview)preview.dataset.view=button.dataset.recordView||'engineering';
      const previewTitle=$('#record-view-preview-title');if(previewTitle)previewTitle.textContent=button.dataset.preview||'';
    }));
    updateBrandMorph();
  }
  function updateBrandMorph(){
    const view=recordScene;
    if(!view)return;
    const heroTravel=Math.max(1,view.hero.offsetHeight-view.heroSticky.offsetHeight);
    const heroProgress=reduceMotion.matches?1:Math.max(0,Math.min(1,(scrollY-view.hero.offsetTop)/heroTravel));
    view.heroSticky.style.setProperty('--record-hero-p',heroProgress.toFixed(3));
    const releaseTravel=Math.max(1,view.release.offsetHeight-view.releaseSticky.offsetHeight);
    const releaseProgress=reduceMotion.matches?1:Math.max(0,Math.min(1,(scrollY-view.release.offsetTop)/releaseTravel));
    view.stage.dataset.stage=releaseProgress<.34?'source':releaseProgress<.69?'review':'release';
  }

  function render(){
    const r=currentRoute();
    const page={'/':recordLanding,'/engineer':engineer,'/engineer/job':engineerJob,'/engineer/new':engineerNew,'/review':review,'/manufacturer':manufacturer,'/issues':issues,'/qr':qr,'/operator':operator,'/phone-preview':phonePreview}[r]||recordLanding;
    document.body.classList.toggle('landing-page',false);
    document.body.classList.toggle('record-page',r==='/');
    document.body.classList.toggle('work-page',r==='/engineer'||r==='/manufacturer');
    app.innerHTML=page();
    const title={'/':'Manufacturing handoffs','/engineer':'Engineering jobs','/engineer/job':'Sensor Mount','/engineer/new':'New job draft','/phone-preview':'Phone preview'}[r]||r.slice(1)[0].toUpperCase()+r.slice(2);
    document.title=title+' · Chappe';
    if(r==='/qr')drawQR();
    setupMotion();
    setupWorkNavigation();
    updateTopbar();
  }

  if(currentRoute()==='/phone-preview')render();else initSession(query().get('session'));
})();
