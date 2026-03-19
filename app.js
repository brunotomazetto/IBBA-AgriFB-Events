/* ═══════════════════════════════════════════════════════════════
   Event Tracker CRM — app.js
   Itaú BBA theme · localStorage persistence · no backend
═══════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────
let events   = [];
let speakers = [];
let cfg      = {};
let activeFilter   = 'All';
let editEvtId      = null;
let editSpkId      = null;

const STATUSES = ['Registered','Requested','F-UP Needed','Scheduled','Concluded','Canceled'];
const STATUS_COLORS = {
  'Registered':'#2e7d32','Requested':'#1565c0','F-UP Needed':'#e65100',
  'Scheduled':'#6a1b9a','Concluded':'#37474f','Canceled':'#b71c1c'
};
const STATUS_BG = {
  'Registered':'#e8f5e9','Requested':'#e3f2fd','F-UP Needed':'#fff3e0',
  'Scheduled':'#f3e5f5','Concluded':'#eceff1','Canceled':'#ffebee'
};

// ── Defaults ───────────────────────────────────────────────────
const CFG_DEFAULTS = {
  name:      'Bruno Tomazetto',
  initials:  'BT',
  sla:       7,
  to:        '',
  cc:        '',
  defaultStatuses: ['Requested','F-UP Needed'],
  subject:   '[Equity Research] Corporate Access Update — {date}',
  opening:   'Dear Corporate Access Team,\n\nPlease find below the pending events requiring your attention as of {date}:',
  closing:   'Please confirm availability and coordinate scheduling at your earliest convenience.',
  signature: 'Thank you,\nEquity Research — Event Tracker',
};

// ── Persistence ────────────────────────────────────────────────
function save() {
  localStorage.setItem('crm_events',   JSON.stringify(events));
  localStorage.setItem('crm_speakers', JSON.stringify(speakers));
  localStorage.setItem('crm_cfg',      JSON.stringify(cfg));
}
function load() {
  try { events   = JSON.parse(localStorage.getItem('crm_events'))   || []; } catch { events   = []; }
  try { speakers = JSON.parse(localStorage.getItem('crm_speakers')) || []; } catch { speakers = []; }
  try { cfg      = JSON.parse(localStorage.getItem('crm_cfg'))      || {}; } catch { cfg      = {}; }
  cfg = { ...CFG_DEFAULTS, ...cfg };
}

// ── ID generators ──────────────────────────────────────────────
function nextEvtId() {
  const nums = events.map(e => parseInt(e.id?.replace('EVT','')) || 0);
  return 'EVT' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4,'0');
}
function nextSpkId() {
  const nums = speakers.map(s => parseInt(s.id?.replace('SPK','')) || 0);
  return 'SPK' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3,'0');
}

// ── Date helpers ───────────────────────────────────────────────
function today()    { const d=new Date(); d.setHours(0,0,0,0); return d; }
function isoToday() { return today().toISOString().slice(0,10); }
function daysDiff(a,b) { return Math.floor((b-a)/86400000); }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}

// ── Status engine ──────────────────────────────────────────────
function computeStatus(ev) {
  if (ev.canceled) return 'Canceled';
  if (ev.scheduledDate) {
    return new Date(ev.scheduledDate) <= today() ? 'Concluded' : 'Scheduled';
  }
  if (!ev.requestedDate) return 'Registered';
  const ref  = ev.fupDate ? new Date(ev.fupDate) : new Date(ev.requestedDate);
  const diff = daysDiff(ref, today());
  return diff > cfg.sla ? 'F-UP Needed' : 'Requested';
}
function computeSLA(ev) {
  if (!ev.requestedDate) return null;
  const st = computeStatus(ev);
  if (['Concluded','Canceled','Scheduled'].includes(st)) return null;
  return daysDiff(new Date(ev.requestedDate), today());
}

// ── Navigation ─────────────────────────────────────────────────
function setPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.subnav-btn').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');
  document.getElementById('snav-'+p)?.classList.add('active');
  if (p==='dashboard') document.querySelector('.nav-link').classList.add('active');
  if (p==='dashboard') renderDashboard();
  if (p==='events')    renderEvents();
  if (p==='speakers')  renderSpeakers();
  if (p==='email')     renderEmailPage();
  if (p==='settings')  renderSettings();
}

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard() {
  // greeting
  const h = new Date().getHours();
  const greet = h<12?'Good morning':h<18?'Good afternoon':'Good evening';
  document.getElementById('greetingText').textContent = `${greet}, ${cfg.name}`;
  document.getElementById('greetingDate').textContent =
    new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  // avatar
  document.getElementById('userAvatarBtn').textContent = cfg.initials || 'BT';

  // counts
  const counts = {}; STATUSES.forEach(s=>counts[s]=0);
  events.forEach(e=>counts[computeStatus(e)]++);
  const total = events.length;

  // quick grid
  const qg = document.getElementById('quickGrid');
  const icons = {
    'All':         '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    'Registered':  '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    'Requested':   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    'F-UP Needed': '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'Scheduled':   '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    'Concluded':   '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    'Canceled':    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };
  const items = [['All',total], ...STATUSES.map(s=>[s,counts[s]])];
  qg.innerHTML = items.map(([s,n])=>`
    <div class="quick-card${activeFilter===s?' active-card':''}" onclick="goFilter('${s}')">
      <div class="quick-icon" style="background:${s==='All'?'#f0f0f0':STATUS_BG[s]};color:${s==='All'?'#333':STATUS_COLORS[s]}">${icons[s]||''}</div>
      <div class="quick-count">${n}</div>
      <div class="quick-label">${s==='All'?'Total Events':s}</div>
    </div>`).join('');

  // pipeline chart
  const pc = document.getElementById('pipelineChart');
  pc.innerHTML = STATUSES.map(s=>`
    <div class="bar-row">
      <div class="bar-label">${s}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${total?((counts[s]/total)*100).toFixed(1):0}%;background:${STATUS_COLORS[s]}"></div>
      </div>
      <div class="bar-num">${counts[s]}</div>
    </div>`).join('');

  // recent
  const recent = [...events].sort((a,b)=>(b.registeredDate||'').localeCompare(a.registeredDate||'')).slice(0,6);
  document.getElementById('recentBody').innerHTML = recent.map(e=>{
    const st=computeStatus(e); const sla=computeSLA(e);
    return `<tr onclick="editEvent('${e.id}')">
      <td><span class="evt-id">${e.id}</span></td>
      <td>${e.name}</td>
      <td>${e.speaker||'—'}</td>
      <td><span class="pill ${pillClass(st)}">${st}</span></td>
      <td>${sla===null?'<span class="sla sla-na">—</span>':sla>cfg.sla?`<span class="sla sla-warn">⚠ ${sla}d</span>`:`<span class="sla sla-ok">${sla}d</span>`}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-xs);padding:24px">No events yet</td></tr>`;

  // FUP list
  const fups = events.filter(e=>computeStatus(e)==='F-UP Needed');
  document.getElementById('fupBadge').textContent = fups.length;
  document.getElementById('fupList').innerHTML = fups.length
    ? fups.map(e=>`<div class="att-item" onclick="editEvent('${e.id}')">
        <div class="att-dot" style="background:#e65100"></div>
        <div><div class="att-name">${e.name}</div><div class="att-meta">${e.id} · SLA: ${computeSLA(e)} days</div></div>
      </div>`).join('')
    : '<div style="padding:12px 0;font-size:12px;color:var(--text-xs)">No events need attention 🎉</div>';

  // Scheduled upcoming
  const scheds = events.filter(e=>computeStatus(e)==='Scheduled')
    .sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate)).slice(0,5);
  document.getElementById('schedBadge').textContent = scheds.length;
  document.getElementById('schedList').innerHTML = scheds.length
    ? scheds.map(e=>`<div class="att-item" onclick="editEvent('${e.id}')">
        <div class="att-dot" style="background:#6a1b9a"></div>
        <div><div class="att-name">${e.name}</div><div class="att-meta">${e.id} · ${fmtDateShort(e.scheduledDate)}</div></div>
      </div>`).join('')
    : '<div style="padding:12px 0;font-size:12px;color:var(--text-xs)">No upcoming events</div>';
}

function goFilter(s) { activeFilter=s; setPage('events'); }

// ── Events ─────────────────────────────────────────────────────
function renderStatusChips() {
  document.getElementById('statusChips').innerHTML =
    ['All',...STATUSES].map(s=>`<button class="chip${activeFilter===s?' on':''}" data-s="${s}" onclick="setFilter('${s}')">${s}</button>`).join('');
}
function setFilter(s) { activeFilter=s; renderEvents(); }

function renderEvents() {
  renderStatusChips();
  const q = (document.getElementById('evtSearch')?.value||'').toLowerCase();
  const filtered = events.filter(e=>{
    if (activeFilter!=='All' && computeStatus(e)!==activeFilter) return false;
    if (q && !e.name.toLowerCase().includes(q) && !(e.speaker||'').toLowerCase().includes(q)) return false;
    return true;
  });
  const tbody = document.getElementById('evtBody');
  const empty = document.getElementById('evtEmpty');
  if (!filtered.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  tbody.innerHTML = filtered.map(e=>{
    const st=computeStatus(e); const sla=computeSLA(e);
    const slaHtml = sla===null ? '<span class="sla sla-na">—</span>'
      : sla>cfg.sla ? `<span class="sla sla-warn">⚠ ${sla}d</span>`
      : `<span class="sla sla-ok">${sla}d</span>`;
    return `<tr class="${st==='Canceled'?'canceled':''}">
      <td><span class="evt-id">${e.id}</span></td>
      <td><strong>${e.name}</strong></td>
      <td>${e.speaker||'—'}</td>
      <td>${e.sector||'—'}</td>
      <td><span class="pill ${pillClass(st)}">${st}</span></td>
      <td>${fmtDate(e.registeredDate)}</td>
      <td>${fmtDate(e.requestedDate)}</td>
      <td>${fmtDate(e.fupDate)}</td>
      <td>${fmtDate(e.scheduledDate)}</td>
      <td>${slaHtml}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.obs||''}">${e.obs||'—'}</td>
      <td><div class="row-act">
        <button class="btn-ico" onclick="editEvent('${e.id}')" title="Edit">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-ico del" onclick="deleteEvent('${e.id}')" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');
}

function pillClass(st) {
  return {Registered:'p-Registered',Requested:'p-Requested','F-UP Needed':'p-FUP',Scheduled:'p-Scheduled',Concluded:'p-Concluded',Canceled:'p-Canceled'}[st]||'';
}

function openNewEvent() {
  editEvtId=null;
  document.getElementById('evtModalTitle').textContent='New Event';
  ['ef-id','ef-name','ef-speaker','ef-req','ef-fup','ef-sch','ef-obs'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('ef-sector').value='';
  document.getElementById('ef-canceled').checked=false;
  populateSpkDatalist();
  openModal('evtModal');
}
function editEvent(id) {
  const e=events.find(ev=>ev.id===id); if(!e) return;
  editEvtId=id;
  document.getElementById('evtModalTitle').textContent='Edit Event';
  document.getElementById('ef-id').value=e.id;
  document.getElementById('ef-name').value=e.name;
  document.getElementById('ef-speaker').value=e.speaker||'';
  document.getElementById('ef-sector').value=e.sector||'';
  document.getElementById('ef-req').value=e.requestedDate||'';
  document.getElementById('ef-fup').value=e.fupDate||'';
  document.getElementById('ef-sch').value=e.scheduledDate||'';
  document.getElementById('ef-obs').value=e.obs||'';
  document.getElementById('ef-canceled').checked=!!e.canceled;
  populateSpkDatalist();
  openModal('evtModal');
}
function saveEvent() {
  const name=document.getElementById('ef-name').value.trim();
  if(!name){toast('Event name is required.','err');return;}
  const data={
    name,
    speaker:       document.getElementById('ef-speaker').value.trim(),
    sector:        document.getElementById('ef-sector').value,
    requestedDate: document.getElementById('ef-req').value||null,
    fupDate:       document.getElementById('ef-fup').value||null,
    scheduledDate: document.getElementById('ef-sch').value||null,
    obs:           document.getElementById('ef-obs').value.trim(),
    canceled:      document.getElementById('ef-canceled').checked,
  };
  if(editEvtId){
    const idx=events.findIndex(e=>e.id===editEvtId);
    events[idx]={...events[idx],...data};
    toast('Event updated.','ok');
  } else {
    events.push({id:nextEvtId(),registeredDate:isoToday(),...data});
    toast('Event created.','ok');
  }
  save(); closeModal('evtModal'); renderEvents(); renderDashboard();
}
function deleteEvent(id){
  if(!confirm('Delete this event?')) return;
  events=events.filter(e=>e.id!==id);
  save(); renderEvents(); renderDashboard();
  toast('Event deleted.','ok');
}

// ── Speakers ───────────────────────────────────────────────────
function renderSpeakers() {
  const q=(document.getElementById('spkSearch')?.value||'').toLowerCase();
  const f=speakers.filter(s=>!q||s.name.toLowerCase().includes(q)||(s.company||'').toLowerCase().includes(q));
  const grid=document.getElementById('spkGrid');
  const empty=document.getElementById('spkEmpty');
  if(!f.length){grid.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  grid.innerHTML=f.map(s=>`
    <div class="spk-card">
      <div class="spk-top">
        <div class="spk-av">${s.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
        <div><div class="spk-name">${s.name}</div><div class="spk-id">${s.id}</div></div>
      </div>
      <div class="spk-meta">${[s.company,s.sector,s.email].filter(Boolean).join(' · ')||'—'}</div>
      <div class="spk-acts">
        <button class="btn btn-ghost btn-sm" onclick="editSpeaker('${s.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSpeaker('${s.id}')">Delete</button>
      </div>
    </div>`).join('');
}
function populateSpkDatalist(){
  document.getElementById('spkDatalist').innerHTML=speakers.map(s=>`<option value="${s.name}">`).join('');
}
function openNewSpeaker(){
  editSpkId=null;
  document.getElementById('spkModalTitle').textContent='New Speaker';
  ['sf-id','sf-name','sf-company','sf-email'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('sf-sector').value='';
  openModal('spkModal');
}
function editSpeaker(id){
  const s=speakers.find(sp=>sp.id===id); if(!s) return;
  editSpkId=id;
  document.getElementById('spkModalTitle').textContent='Edit Speaker';
  document.getElementById('sf-id').value=s.id;
  document.getElementById('sf-name').value=s.name;
  document.getElementById('sf-company').value=s.company||'';
  document.getElementById('sf-sector').value=s.sector||'';
  document.getElementById('sf-email').value=s.email||'';
  openModal('spkModal');
}
function saveSpeaker(){
  const name=document.getElementById('sf-name').value.trim();
  if(!name){toast('Name is required.','err');return;}
  const data={name,company:document.getElementById('sf-company').value.trim(),sector:document.getElementById('sf-sector').value,email:document.getElementById('sf-email').value.trim()};
  if(editSpkId){
    const idx=speakers.findIndex(s=>s.id===editSpkId);
    speakers[idx]={...speakers[idx],...data};
    toast('Speaker updated.','ok');
  } else {
    speakers.push({id:nextSpkId(),...data});
    toast('Speaker created.','ok');
  }
  save(); closeModal('spkModal'); renderSpeakers();
}
function deleteSpeaker(id){
  if(!confirm('Delete this speaker?')) return;
  speakers=speakers.filter(s=>s.id!==id);
  save(); renderSpeakers(); toast('Speaker deleted.','ok');
}

// ── Email page ─────────────────────────────────────────────────
function renderEmailPage(){
  // prefill recipients from cfg
  document.getElementById('emailTo').value = cfg.to||'';
  document.getElementById('emailCc').value = cfg.cc||'';
  // status checkboxes — default statuses from cfg
  const wrap = document.getElementById('emailStatusFilter');
  wrap.innerHTML = STATUSES.map(s=>`
    <label class="chk-label">
      <input type="checkbox" name="eStat" value="${s}" ${cfg.defaultStatuses.includes(s)?'checked':''}>
      <span>${s}</span>
    </label>`).join('');
}

function generateEmail(){
  const to = document.getElementById('emailTo').value.trim();
  const selected = [...document.querySelectorAll('input[name=eStat]:checked')].map(c=>c.value);
  if(!selected.length){toast('Select at least one status.','err');return;}

  const matched = events.filter(e=>selected.includes(computeStatus(e)));
  if(!matched.length){toast('No events match selected statuses.','err');return;}

  const todayIso = isoToday();
  const todayFmt = fmtDate(todayIso);

  // Apply resets
  const doFUP = document.getElementById('resetFUP').checked;
  const doReg = document.getElementById('resetReg').checked;
  events.forEach(e=>{
    const st=computeStatus(e);
    if(doFUP && st==='F-UP Needed') { e.fupDate=todayIso; }
    if(doReg && st==='Registered')  { e.requestedDate=todayIso; }
  });
  if(doFUP||doReg) save();

  // Build subject
  const subject = cfg.subject.replace('{date}',todayFmt);

  // Build opening paragraph (replace {date})
  const openingLines = cfg.opening.replace('{date}',`<b>${todayFmt}</b>`).split('\n').filter(Boolean);
  const openingHtml  = openingLines.map(l=>`<p style="margin:0 0 8px">${l}</p>`).join('');

  // Build rows
  const rows = matched.map(e=>{
    const st=computeStatus(e);
    const sla=e.requestedDate ? daysDiff(new Date(e.requestedDate),new Date(todayIso+'T00:00:00')) : null;
    const rowBg=STATUS_BG[st]||'#fff';
    return `<tr style="background:${rowBg}">
      <td style="padding:8px 12px;border:1px solid #ddd"><b>${e.id}</b></td>
      <td style="padding:8px 12px;border:1px solid #ddd">${e.name}</td>
      <td style="padding:8px 12px;border:1px solid #ddd">${e.speaker||'—'}</td>
      <td style="padding:8px 12px;border:1px solid #ddd">${e.sector||'—'}</td>
      <td style="padding:8px 12px;border:1px solid #ddd"><b>${st}</b></td>
      <td style="padding:8px 12px;border:1px solid #ddd">${sla!==null?sla+' days':'—'}</td>
    </tr>`;
  }).join('');

  // Closing + signature
  const closingHtml   = cfg.closing.split('\n').filter(Boolean).map(l=>`<p style="margin:0 0 6px">${l}</p>`).join('');
  const signatureHtml = cfg.signature.split('\n').filter(Boolean).map((l,i)=>i===0?`<p style="margin:0 0 2px">${l}</p>`:`<p style="margin:0;font-style:italic;color:#555">${l}</p>`).join('');

  const html=`<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;max-width:700px">
${openingHtml}
<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%;border-color:#ddd;margin:12px 0">
<tr style="background:#1a1a1a;color:#fff;font-weight:bold">
  <td style="padding:9px 12px;border:1px solid #ddd">Event ID</td>
  <td style="padding:9px 12px;border:1px solid #ddd">Event Name</td>
  <td style="padding:9px 12px;border:1px solid #ddd">Speaker</td>
  <td style="padding:9px 12px;border:1px solid #ddd">Sector</td>
  <td style="padding:9px 12px;border:1px solid #ddd">Status</td>
  <td style="padding:9px 12px;border:1px solid #ddd">SLA Since Request</td>
</tr>
${rows}
</table>
${closingHtml}
<br>${signatureHtml}
</body></html>`;

  window._emailHTML    = html;
  window._emailTo      = to;
  window._emailSubject = subject;

  // Show preview
  const wrap = document.getElementById('emailPreviewWrap');
  wrap.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--text-s)">To: <b>${to||'(no recipient)'}</b></span>
      <span style="font-size:12px;color:var(--text-xs)">· ${matched.length} event(s)</span>
    </div>
    <iframe id="prevFrame" style="width:100%;height:480px;border:1px solid var(--border);border-radius:4px"></iframe>`;
  setTimeout(()=>{
    const fr=document.getElementById('prevFrame');
    fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  },80);
  toast(`Preview ready — ${matched.length} event(s)`,'ok');
}

function copyEmailHTML(){
  if(!window._emailHTML){toast('Generate a preview first.','err');return;}
  navigator.clipboard.writeText(window._emailHTML)
    .then(()=>toast('HTML copied to clipboard.','ok'))
    .catch(()=>toast('Copy failed.','err'));
}
function openMailto(){
  if(!window._emailHTML){toast('Generate a preview first.','err');return;}
  navigator.clipboard.writeText(window._emailHTML).catch(()=>{});
  const sub=encodeURIComponent(window._emailSubject||'Corporate Access Update');
  const body=encodeURIComponent('(Paste the copied HTML into Outlook for rich formatting)');
  window.location.href=`mailto:${window._emailTo||''}?subject=${sub}&body=${body}`;
}

// ── Settings ───────────────────────────────────────────────────
function renderSettings(){
  document.getElementById('cfg-name').value     = cfg.name;
  document.getElementById('cfg-initials').value = cfg.initials;
  document.getElementById('cfg-sla').value      = cfg.sla;
  document.getElementById('cfg-to').value       = cfg.to||'';
  document.getElementById('cfg-cc').value       = cfg.cc||'';
  document.getElementById('cfg-subject').value  = cfg.subject;
  document.getElementById('cfg-opening').value  = cfg.opening;
  document.getElementById('cfg-closing').value  = cfg.closing;
  document.getElementById('cfg-signature').value= cfg.signature;
  // default statuses checkboxes
  document.getElementById('cfg-defaultStatuses').innerHTML = STATUSES.map(s=>`
    <label class="chk-label">
      <input type="checkbox" name="cfgStat" value="${s}" ${cfg.defaultStatuses.includes(s)?'checked':''}>
      <span>${s}</span>
    </label>`).join('');
}
function saveSettings(){
  cfg.name      = document.getElementById('cfg-name').value.trim()||'User';
  cfg.initials  = document.getElementById('cfg-initials').value.trim().toUpperCase().slice(0,2)||'ER';
  cfg.sla       = parseInt(document.getElementById('cfg-sla').value)||7;
  cfg.to        = document.getElementById('cfg-to').value.trim();
  cfg.cc        = document.getElementById('cfg-cc').value.trim();
  cfg.subject   = document.getElementById('cfg-subject').value.trim()||CFG_DEFAULTS.subject;
  cfg.opening   = document.getElementById('cfg-opening').value.trim()||CFG_DEFAULTS.opening;
  cfg.closing   = document.getElementById('cfg-closing').value.trim()||CFG_DEFAULTS.closing;
  cfg.signature = document.getElementById('cfg-signature').value.trim()||CFG_DEFAULTS.signature;
  cfg.defaultStatuses = [...document.querySelectorAll('input[name=cfgStat]:checked')].map(c=>c.value);
  save();
  document.getElementById('userAvatarBtn').textContent = cfg.initials;
  toast('Settings saved.','ok');
}
function resetEmailTemplate(){
  document.getElementById('cfg-subject').value  = CFG_DEFAULTS.subject;
  document.getElementById('cfg-opening').value  = CFG_DEFAULTS.opening;
  document.getElementById('cfg-closing').value  = CFG_DEFAULTS.closing;
  document.getElementById('cfg-signature').value= CFG_DEFAULTS.signature;
  toast('Template reset to default.','ok');
}

// ── Import / Export ────────────────────────────────────────────
function exportData(){
  const blob=new Blob([JSON.stringify({events,speakers,cfg,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`event-tracker-${isoToday()}.json`; a.click();
  toast('Data exported.','ok');
}
function importData(){
  const input=document.createElement('input'); input.type='file'; input.accept='.json';
  input.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const r=new FileReader();
    r.onload=ev=>{
      try{
        const d=JSON.parse(ev.target.result);
        if(d.events)   events=d.events;
        if(d.speakers) speakers=d.speakers;
        if(d.cfg)      cfg={...CFG_DEFAULTS,...d.cfg};
        save(); renderDashboard();
        toast(`Imported ${events.length} events, ${speakers.length} speakers.`,'ok');
      } catch{ toast('Invalid JSON file.','err'); }
    };
    r.readAsText(file);
  };
  input.click();
}

// ── Global search ──────────────────────────────────────────────
function handleGlobalSearch(q){
  if(!q) return;
  activeFilter='All';
  setPage('events');
  document.getElementById('evtSearch').value=q;
  renderEvents();
}

// ── Modal helpers ──────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e=>{
  if(e.target.classList.contains('overlay')) e.target.classList.remove('open');
});

// ── Toast ──────────────────────────────────────────────────────
let _tt;
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='toast show '+(type==='ok'?'ok':'err');
  clearTimeout(_tt); _tt=setTimeout(()=>el.classList.remove('show'),3000);
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  load();
  renderDashboard();
  setPage('dashboard');
});
