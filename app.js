/* ═══════════════════════════════════════════════════════════════
   Event Tracker CRM — app.js v5
   Supabase real-time · cloud users · ratings · sort/filter
═══════════════════════════════════════════════════════════════ */

// ── Supabase client ─────────────────────────────────────────────
let _supabase = null;

function getSupabaseCfg() {
  try { return JSON.parse(localStorage.getItem('crm_supabase')) || {}; } catch { return {}; }
}
function saveSupabaseCfg(url, key) {
  localStorage.setItem('crm_supabase', JSON.stringify({ url, key }));
}
function initSupabase() {
  const { url, key } = getSupabaseCfg();
  if (!url || !key) return false;
  try {
    _supabase = window.supabase.createClient(url, key);
    return true;
  } catch (e) { console.error('Supabase init error:', e); return false; }
}
function isOnline() { return !!_supabase; }

// ── Auth ────────────────────────────────────────────────────────
let currentUser = null;

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── User helpers: Supabase first, localStorage fallback ──────────
function getLocalUsers() {
  try { return JSON.parse(localStorage.getItem('crm_users')) || []; } catch { return []; }
}
function saveLocalUsers(u) { localStorage.setItem('crm_users', JSON.stringify(u)); }

async function getAllUsers() {
  // Always try Supabase first so users are shared across browsers
  if (isOnline()) {
    const { data, error } = await _supabase.from('users').select('*');
    if (!error && data?.length) {
      // Cache locally as fallback
      const mapped = data.map(r => ({
        username: r.username, displayName: r.display_name,
        initials: r.initials, role: r.role, passwordHash: r.password_hash
      }));
      saveLocalUsers(mapped);
      return mapped;
    }
  }
  return getLocalUsers();
}

async function saveUserToDb(user) {
  // Always save locally
  const locals = getLocalUsers();
  const idx = locals.findIndex(u => u.username === user.username);
  if (idx >= 0) locals[idx] = user; else locals.push(user);
  saveLocalUsers(locals);
  // Also save to Supabase if online
  if (isOnline()) {
    const row = { username: user.username, display_name: user.displayName, initials: user.initials, role: user.role, password_hash: user.passwordHash };
    const { error } = await _supabase.from('users').upsert(row, { onConflict: 'username' });
    if (error) console.error('Save user error:', error);
  }
}

async function deleteUserFromDb(username) {
  saveLocalUsers(getLocalUsers().filter(u => u.username !== username));
  if (isOnline()) {
    const { error } = await _supabase.from('users').delete().eq('username', username);
    if (error) console.error('Delete user error:', error);
  }
}

async function seedAdminIfNeeded() {
  // Only seed if no users exist anywhere
  const users = await getAllUsers();
  if (!users.length) {
    const admin = { username:'admin', displayName:'Bruno Tomazetto', initials:'BT', role:'admin', passwordHash: await sha256('admin123') };
    await saveUserToDb(admin);
  }
}

async function tryLogin(username, password) {
  const users = await getAllUsers();
  const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || await sha256(password) !== user.passwordHash) return false;
  currentUser = user;
  sessionStorage.setItem('crm_session', JSON.stringify(user));
  return true;
}

function logout() { currentUser = null; sessionStorage.removeItem('crm_session'); showLoginScreen(); }

function restoreSession() {
  try { const s = sessionStorage.getItem('crm_session'); if (s) { currentUser = JSON.parse(s); return true; } } catch {}
  return false;
}

// ── State ───────────────────────────────────────────────────────
let events = [], speakers = [], cfg = {};
let activeFilter = 'All';
let sortField = 'registeredDate', sortDir = 'desc';
let editEvtId = null, editSpkId = null;
let realtimeSub = null;

const STATUSES = ['Registered','Requested','F-UP Needed','Scheduled','Concluded','Canceled'];
const STATUS_COLORS = { 'Registered':'#2e7d32','Requested':'#1565c0','F-UP Needed':'#e65100','Scheduled':'#6a1b9a','Concluded':'#37474f','Canceled':'#b71c1c' };
const STATUS_BG     = { 'Registered':'#e8f5e9','Requested':'#e3f2fd','F-UP Needed':'#fff3e0','Scheduled':'#f3e5f5','Concluded':'#eceff1','Canceled':'#ffebee' };
const CFG_DEFAULTS  = {
  name:'Bruno Tomazetto', initials:'BT', sla:7, to:'', cc:'',
  defaultStatuses:['Requested','F-UP Needed'],
  subject:'[Equity Research] Corporate Access Update — {date}',
  opening:'Dear Corporate Access Team,\n\nPlease find below the pending events requiring your attention as of {date}:',
  closing:'Please confirm availability and coordinate scheduling at your earliest convenience.',
  signature:'Thank you,\nEquity Research — Event Tracker',
};

// ── Local persistence (fallback) ────────────────────────────────
function saveLocal() {
  localStorage.setItem('crm_events',   JSON.stringify(events));
  localStorage.setItem('crm_speakers', JSON.stringify(speakers));
  localStorage.setItem('crm_cfg',      JSON.stringify(cfg));
}
function loadLocal() {
  try { events   = JSON.parse(localStorage.getItem('crm_events'))   || []; } catch { events   = []; }
  try { speakers = JSON.parse(localStorage.getItem('crm_speakers')) || []; } catch { speakers = []; }
  try { cfg      = JSON.parse(localStorage.getItem('crm_cfg'))      || {}; } catch { cfg      = {}; }
  cfg = { ...CFG_DEFAULTS, ...cfg };
}

// ── Supabase CRUD ────────────────────────────────────────────────
async function dbLoadAll() {
  if (!isOnline()) { loadLocal(); return; }
  try {
    const [evtRes, spkRes] = await Promise.all([
      _supabase.from('events').select('*').order('registered_date', { ascending: false }),
      _supabase.from('speakers').select('*').order('name')
    ]);
    if (evtRes.error) throw evtRes.error;
    if (spkRes.error) throw spkRes.error;
    events   = (evtRes.data  || []).map(dbRowToEvent);
    speakers = (spkRes.data  || []).map(dbRowToSpeaker);
    saveLocal();
  } catch (e) {
    console.error('DB load error:', e);
    loadLocal();
    toast('Using local data — check Supabase connection.','err');
  }
}

async function dbSaveEvent(ev) {
  saveLocal();
  if (!isOnline()) return;
  const row = eventToDbRow(ev);
  const { error } = await _supabase.from('events').upsert(row, { onConflict: 'id' });
  if (error) { console.error('Save event error:', error); toast('Sync error: '+error.message,'err'); }
}

async function dbDeleteEvent(id) {
  saveLocal();
  if (!isOnline()) return;
  const { error } = await _supabase.from('events').delete().eq('id', id);
  if (error) { console.error('Delete event error:', error); toast('Sync error: '+error.message,'err'); }
}

async function dbSaveSpeaker(sp) {
  saveLocal();
  if (!isOnline()) return;
  const row = speakerToDbRow(sp);
  const { error } = await _supabase.from('speakers').upsert(row, { onConflict: 'id' });
  if (error) { console.error('Save speaker error:', error); toast('Sync error: '+error.message,'err'); }
}

async function dbDeleteSpeaker(id) {
  saveLocal();
  if (!isOnline()) return;
  const { error } = await _supabase.from('speakers').delete().eq('id', id);
  if (error) { console.error('Delete speaker error:', error); toast('Sync error: '+error.message,'err'); }
}

// ── Row mappers ──────────────────────────────────────────────────
function eventToDbRow(ev) {
  return {
    id: ev.id, name: ev.name, speaker: ev.speaker||null, sector: ev.sector||null,
    registered_date: ev.registeredDate||null, requested_date: ev.requestedDate||null,
    fup_date: ev.fupDate||null, scheduled_date: ev.scheduledDate||null,
    obs: ev.obs||null, canceled: !!ev.canceled,
    rating_pre_call: ev.ratingPreCall||0, rating_call: ev.ratingCall||0,
  };
}
function dbRowToEvent(r) {
  return {
    id: r.id, name: r.name, speaker: r.speaker, sector: r.sector,
    registeredDate: r.registered_date, requestedDate: r.requested_date,
    fupDate: r.fup_date, scheduledDate: r.scheduled_date,
    obs: r.obs, canceled: r.canceled,
    ratingPreCall: r.rating_pre_call||0, ratingCall: r.rating_call||0,
  };
}
function speakerToDbRow(s) {
  return { id: s.id, name: s.name, company: s.company||null, sector: s.sector||null, email: s.email||null };
}
function dbRowToSpeaker(r) {
  return { id: r.id, name: r.name, company: r.company, sector: r.sector, email: r.email };
}

// ── Real-time subscription ───────────────────────────────────────
function subscribeRealtime() {
  if (!isOnline() || realtimeSub) return;
  realtimeSub = _supabase
    .channel('crm-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, payload => {
      handleRealtimeEvent(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'speakers' }, payload => {
      handleRealtimeSpeaker(payload);
    })
    .subscribe();
}

function handleRealtimeEvent(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;
  if (eventType === 'INSERT' || eventType === 'UPDATE') {
    const ev = dbRowToEvent(newRow);
    const idx = events.findIndex(e => e.id === ev.id);
    if (idx >= 0) events[idx] = ev; else events.unshift(ev);
  } else if (eventType === 'DELETE') {
    events = events.filter(e => e.id !== oldRow.id);
  }
  saveLocal();
  renderDashboard();
  if (document.getElementById('page-events').classList.contains('active')) renderEvents();
  showSyncPulse();
}

function handleRealtimeSpeaker(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;
  if (eventType === 'INSERT' || eventType === 'UPDATE') {
    const sp = dbRowToSpeaker(newRow);
    const idx = speakers.findIndex(s => s.id === sp.id);
    if (idx >= 0) speakers[idx] = sp; else speakers.push(sp);
  } else if (eventType === 'DELETE') {
    speakers = speakers.filter(s => s.id !== oldRow.id);
  }
  saveLocal();
  if (document.getElementById('page-speakers').classList.contains('active')) renderSpeakers();
}

function showSyncPulse() {
  const el = document.getElementById('syncDot');
  if (!el) return;
  el.classList.add('pulse');
  setTimeout(() => el.classList.remove('pulse'), 1200);
}

// ── ID generators ────────────────────────────────────────────────
function nextEvtId() {
  const nums = events.map(e => parseInt(e.id?.replace('EVT',''))||0);
  return 'EVT' + String((nums.length ? Math.max(...nums) : 0)+1).padStart(4,'0');
}
function nextSpkId() {
  const nums = speakers.map(s => parseInt(s.id?.replace('SPK',''))||0);
  return 'SPK' + String((nums.length ? Math.max(...nums) : 0)+1).padStart(3,'0');
}

// ── Date helpers ─────────────────────────────────────────────────
function today()    { const d=new Date(); d.setHours(0,0,0,0); return d; }
function isoToday() { return today().toISOString().slice(0,10); }
function daysDiff(a,b) { return Math.floor((b-a)/86400000); }
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}

// ── Status engine ────────────────────────────────────────────────
function computeStatus(ev) {
  if (ev.canceled) return 'Canceled';
  if (ev.scheduledDate) return new Date(ev.scheduledDate) <= today() ? 'Concluded' : 'Scheduled';
  if (!ev.requestedDate) return 'Registered';
  const ref = ev.fupDate ? new Date(ev.fupDate) : new Date(ev.requestedDate);
  return daysDiff(ref, today()) > cfg.sla ? 'F-UP Needed' : 'Requested';
}
function computeSLA(ev) {
  if (!ev.requestedDate) return null;
  if (['Concluded','Canceled','Scheduled'].includes(computeStatus(ev))) return null;
  return daysDiff(new Date(ev.requestedDate), today());
}

// ── Sort & Filter ────────────────────────────────────────────────
function getFilteredSorted() {
  const q = (document.getElementById('evtSearch')?.value||'').toLowerCase();
  let filtered = events.filter(e => {
    if (activeFilter !== 'All' && computeStatus(e) !== activeFilter) return false;
    if (q && !e.name.toLowerCase().includes(q) && !(e.speaker||'').toLowerCase().includes(q) && !(e.sector||'').toLowerCase().includes(q)) return false;
    return true;
  });
  filtered.sort((a, b) => {
    let va, vb;
    switch (sortField) {
      case 'status':         va = computeStatus(a);   vb = computeStatus(b);   break;
      case 'name':           va = a.name||'';          vb = b.name||'';         break;
      case 'speaker':        va = a.speaker||'';       vb = b.speaker||'';      break;
      case 'sector':         va = a.sector||'';        vb = b.sector||'';       break;
      case 'requestedDate':  va = a.requestedDate||''; vb = b.requestedDate||'';break;
      case 'scheduledDate':  va = a.scheduledDate||''; vb = b.scheduledDate||'';break;
      case 'sla':            va = computeSLA(a)??-1;   vb = computeSLA(b)??-1;  break;
      case 'ratingPreCall':  va = a.ratingPreCall||0;  vb = b.ratingPreCall||0; break;
      case 'ratingCall':     va = a.ratingCall||0;     vb = b.ratingCall||0;    break;
      default:               va = a.registeredDate||'';vb = b.registeredDate||'';
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
  return filtered;
}

function setSort(field) {
  if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortField = field; sortDir = 'asc'; }
  renderEvents();
}

function sortArrow(field) {
  if (sortField !== field) return '<span style="opacity:.25;margin-left:3px">⇅</span>';
  return sortDir === 'asc'
    ? '<span style="color:var(--orange);margin-left:3px">↑</span>'
    : '<span style="color:var(--orange);margin-left:3px">↓</span>';
}

// ── Stars ────────────────────────────────────────────────────────
function starHTML(value, fieldName, evtId) {
  let h = `<div class="stars" data-field="${fieldName}" data-id="${evtId}">`;
  for (let i=1;i<=5;i++) h+=`<span class="star${i<=(value||0)?' on':''}" onclick="setRating('${evtId}','${fieldName}',${i})" onmouseover="hoverStars(this,${i})" onmouseout="resetStars(this)">★</span>`;
  return h+'</div>';
}
async function setRating(id, field, val) {
  const ev = events.find(e=>e.id===id); if(!ev) return;
  ev[field] = ev[field]===val ? 0 : val;
  await dbSaveEvent(ev);
  renderEvents(); renderDashboard();
}
function hoverStars(el,n){ el.closest('.stars').querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('hover',i<n)); }
function resetStars(el)  { el.closest('.stars').querySelectorAll('.star').forEach(s=>s.classList.remove('hover')); }
function ratingBadge(val) {
  if (!val) return '<span style="color:var(--text-xs);font-size:12px">—</span>';
  return `<span style="color:#F15A22;font-size:13px">${'★'.repeat(val)}${'☆'.repeat(5-val)}</span>`;
}
function updateModalStars(fieldId) {
  const val=parseInt(document.getElementById(fieldId).value)||0;
  document.getElementById(fieldId+'-stars')?.querySelectorAll('.star-btn').forEach((s,i)=>{s.classList.toggle('on',i<val);s.textContent=i<val?'★':'☆';});
}
function setModalStar(fieldId,val) {
  const cur=parseInt(document.getElementById(fieldId).value)||0;
  document.getElementById(fieldId).value=cur===val?0:val;
  updateModalStars(fieldId);
}

// ── Login ────────────────────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('app').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('loginUser').value='';
  document.getElementById('loginPass').value='';
  document.getElementById('loginErr').textContent='';
  setTimeout(()=>document.getElementById('loginUser').focus(),80);
}
function showApp() {
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('userAvatarBtn').textContent=currentUser.initials||'ER';
  document.getElementById('snav-users').style.display=currentUser.role==='admin'?'':'none';
  updateSyncStatus();
  renderDashboard();
  setPage('dashboard');
}
async function handleLogin() {
  const username=document.getElementById('loginUser').value.trim();
  const password=document.getElementById('loginPass').value;
  const errEl=document.getElementById('loginErr');
  const btn=document.getElementById('loginBtn');
  if(!username||!password){errEl.textContent='Enter username and password.';return;}
  btn.textContent='Signing in…';btn.disabled=true;
  const ok=await tryLogin(username,password);
  btn.textContent='Sign In';btn.disabled=false;
  if(ok){showApp();}else{errEl.textContent='Invalid username or password.';document.getElementById('loginPass').value='';}
}
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.getElementById('loginScreen')?.style.display!=='none')handleLogin();});

// ── Sync status indicator ────────────────────────────────────────
function updateSyncStatus() {
  const el=document.getElementById('syncStatus');
  if (!el) return;
  if (isOnline()) {
    el.innerHTML=`<span id="syncDot" class="sync-dot online"></span><span>Live sync</span>`;
  } else {
    el.innerHTML=`<span class="sync-dot offline"></span><span>Local only</span>`;
  }
}

// ── Navigation ───────────────────────────────────────────────────
function setPage(p) {
  document.querySelectorAll('.page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.subnav-btn').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(el=>el.classList.remove('active'));
  document.getElementById('page-'+p)?.classList.add('active');
  document.getElementById('snav-'+p)?.classList.add('active');
  if(p==='dashboard'){document.querySelector('.nav-link')?.classList.add('active');renderDashboard();}
  if(p==='events')   renderEvents();
  if(p==='speakers') renderSpeakers();
  if(p==='email')    renderEmailPage();
  if(p==='settings') renderSettings();
  if(p==='users')    renderUsers();
  if(p==='connect')  renderConnect();
}

// ── Dashboard ────────────────────────────────────────────────────
function renderDashboard() {
  const h=new Date().getHours();
  document.getElementById('greetingText').textContent=`${h<12?'Good morning':h<18?'Good afternoon':'Good evening'}, ${currentUser?.displayName||cfg.name}`;
  document.getElementById('greetingDate').textContent=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('userAvatarBtn').textContent=currentUser?.initials||'BT';

  const counts={};STATUSES.forEach(s=>counts[s]=0);
  events.forEach(e=>counts[computeStatus(e)]++);
  const total=events.length;

  const icons={
    'All':         '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    'Registered':  '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    'Requested':   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    'F-UP Needed': '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'Scheduled':   '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    'Concluded':   '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    'Canceled':    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };
  document.getElementById('quickGrid').innerHTML=[['All',total],...STATUSES.map(s=>[s,counts[s]])].map(([s,n])=>`
    <div class="quick-card${activeFilter===s?' active-card':''}" onclick="goFilter('${s}')">
      <div class="quick-icon" style="background:${s==='All'?'#f0f0f0':STATUS_BG[s]};color:${s==='All'?'#333':STATUS_COLORS[s]}">${icons[s]||''}</div>
      <div class="quick-count">${n}</div>
      <div class="quick-label">${s==='All'?'Total':s}</div>
    </div>`).join('');

  document.getElementById('pipelineChart').innerHTML=STATUSES.map(s=>`
    <div class="bar-row">
      <div class="bar-label">${s}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${total?((counts[s]/total)*100).toFixed(1):0}%;background:${STATUS_COLORS[s]}"></div></div>
      <div class="bar-num">${counts[s]}</div>
    </div>`).join('');

  const recent=[...events].sort((a,b)=>(b.registeredDate||'').localeCompare(a.registeredDate||'')).slice(0,6);
  document.getElementById('recentBody').innerHTML=recent.map(e=>{
    const st=computeStatus(e);const sla=computeSLA(e);
    return `<tr onclick="editEvent('${e.id}')">
      <td><span class="evt-id">${e.id}</span></td><td>${e.name}</td><td>${e.speaker||'—'}</td>
      <td><span class="pill ${pillClass(st)}">${st}</span></td>
      <td>${sla===null?'<span class="sla sla-na">—</span>':sla>cfg.sla?`<span class="sla sla-warn">⚠${sla}d</span>`:`<span class="sla sla-ok">${sla}d</span>`}</td>
      <td style="text-align:center">${ratingBadge(e.ratingPreCall)}</td>
      <td style="text-align:center">${ratingBadge(e.ratingCall)}</td>
    </tr>`;
  }).join('')||`<tr><td colspan="7" style="text-align:center;color:var(--text-xs);padding:24px">No events yet</td></tr>`;

  const fups=events.filter(e=>computeStatus(e)==='F-UP Needed');
  document.getElementById('fupBadge').textContent=fups.length;
  document.getElementById('fupList').innerHTML=fups.length
    ?fups.map(e=>`<div class="att-item" onclick="editEvent('${e.id}')"><div class="att-dot" style="background:#e65100"></div><div><div class="att-name">${e.name}</div><div class="att-meta">${e.id} · SLA: ${computeSLA(e)} days</div></div></div>`).join('')
    :'<div style="padding:12px 0;font-size:12px;color:var(--text-xs)">No events need attention 🎉</div>';

  const scheds=events.filter(e=>computeStatus(e)==='Scheduled').sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate)).slice(0,5);
  document.getElementById('schedBadge').textContent=scheds.length;
  document.getElementById('schedList').innerHTML=scheds.length
    ?scheds.map(e=>`<div class="att-item" onclick="editEvent('${e.id}')"><div class="att-dot" style="background:#6a1b9a"></div><div><div class="att-name">${e.name}</div><div class="att-meta">${e.id} · ${fmtDateShort(e.scheduledDate)}</div></div></div>`).join('')
    :'<div style="padding:12px 0;font-size:12px;color:var(--text-xs)">No upcoming events</div>';
}
function goFilter(s){activeFilter=s;setPage('events');}

// ── Events ───────────────────────────────────────────────────────
function renderStatusChips(){
  document.getElementById('statusChips').innerHTML=['All',...STATUSES].map(s=>`<button class="chip${activeFilter===s?' on':''}" data-s="${s}" onclick="setFilter('${s}')">${s}</button>`).join('');
}
function setFilter(s){activeFilter=s;renderEvents();}
function pillClass(st){return{Registered:'p-Registered',Requested:'p-Requested','F-UP Needed':'p-FUP',Scheduled:'p-Scheduled',Concluded:'p-Concluded',Canceled:'p-Canceled'}[st]||'';}

function renderEvents() {
  renderStatusChips();
  const filtered=getFilteredSorted();
  const tbody=document.getElementById('evtBody');
  const empty=document.getElementById('evtEmpty');
  if(!filtered.length){tbody.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';

  // Update sort headers
  document.querySelectorAll('.sortable').forEach(th=>{
    const f=th.dataset.sort;
    th.querySelector('.sort-arrow').innerHTML=sortArrow(f);
  });

  tbody.innerHTML=filtered.map(e=>{
    const st=computeStatus(e);const sla=computeSLA(e);
    const slaHtml=sla===null?'<span class="sla sla-na">—</span>':sla>cfg.sla?`<span class="sla sla-warn">⚠ ${sla}d</span>`:`<span class="sla sla-ok">${sla}d</span>`;
    return `<tr class="${st==='Canceled'?'canceled':''}">
      <td><span class="evt-id">${e.id}</span></td>
      <td><strong>${e.name}</strong></td>
      <td>${e.speaker||'—'}</td><td>${e.sector||'—'}</td>
      <td><span class="pill ${pillClass(st)}">${st}</span></td>
      <td>${fmtDate(e.registeredDate)}</td><td>${fmtDate(e.requestedDate)}</td>
      <td>${fmtDate(e.fupDate)}</td><td>${fmtDate(e.scheduledDate)}</td>
      <td>${slaHtml}</td>
      <td>${starHTML(e.ratingPreCall,'ratingPreCall',e.id)}</td>
      <td>${starHTML(e.ratingCall,'ratingCall',e.id)}</td>
      <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.obs||''}">${e.obs||'—'}</td>
      <td><div class="row-act">
        <button class="btn-ico" onclick="editEvent('${e.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-ico del" onclick="deleteEvent('${e.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');
}

function openNewEvent(){
  editEvtId=null;
  document.getElementById('evtModalTitle').textContent='New Event';
  ['ef-id','ef-name','ef-speaker','ef-req','ef-fup','ef-sch','ef-obs'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('ef-sector').value='';document.getElementById('ef-canceled').checked=false;
  document.getElementById('ef-rating-pre').value='0';document.getElementById('ef-rating-call').value='0';
  updateModalStars('ef-rating-pre');updateModalStars('ef-rating-call');
  populateSpkDatalist();openModal('evtModal');
}
function editEvent(id){
  const e=events.find(ev=>ev.id===id);if(!e)return;
  editEvtId=id;
  document.getElementById('evtModalTitle').textContent='Edit Event';
  document.getElementById('ef-id').value=e.id;document.getElementById('ef-name').value=e.name;
  document.getElementById('ef-speaker').value=e.speaker||'';document.getElementById('ef-sector').value=e.sector||'';
  document.getElementById('ef-req').value=e.requestedDate||'';document.getElementById('ef-fup').value=e.fupDate||'';
  document.getElementById('ef-sch').value=e.scheduledDate||'';document.getElementById('ef-obs').value=e.obs||'';
  document.getElementById('ef-canceled').checked=!!e.canceled;
  document.getElementById('ef-rating-pre').value=e.ratingPreCall||0;document.getElementById('ef-rating-call').value=e.ratingCall||0;
  updateModalStars('ef-rating-pre');updateModalStars('ef-rating-call');
  populateSpkDatalist();openModal('evtModal');
}
async function saveEvent(){
  const name=document.getElementById('ef-name').value.trim();
  if(!name){toast('Event name is required.','err');return;}
  const data={name,speaker:document.getElementById('ef-speaker').value.trim(),sector:document.getElementById('ef-sector').value,requestedDate:document.getElementById('ef-req').value||null,fupDate:document.getElementById('ef-fup').value||null,scheduledDate:document.getElementById('ef-sch').value||null,obs:document.getElementById('ef-obs').value.trim(),canceled:document.getElementById('ef-canceled').checked,ratingPreCall:parseInt(document.getElementById('ef-rating-pre').value)||0,ratingCall:parseInt(document.getElementById('ef-rating-call').value)||0};
  if(editEvtId){const idx=events.findIndex(e=>e.id===editEvtId);events[idx]={...events[idx],...data};await dbSaveEvent(events[idx]);toast('Event updated.','ok');}
  else{const ev={id:nextEvtId(),registeredDate:isoToday(),...data};events.unshift(ev);await dbSaveEvent(ev);toast('Event created.','ok');}
  closeModal('evtModal');renderEvents();renderDashboard();
}
async function deleteEvent(id){
  if(!confirm('Delete this event?'))return;
  events=events.filter(e=>e.id!==id);
  await dbDeleteEvent(id);
  renderEvents();renderDashboard();toast('Event deleted.','ok');
}

// ── Speakers ─────────────────────────────────────────────────────
function renderSpeakers(){
  const q=(document.getElementById('spkSearch')?.value||'').toLowerCase();
  const f=speakers.filter(s=>!q||s.name.toLowerCase().includes(q)||(s.company||'').toLowerCase().includes(q));
  const grid=document.getElementById('spkGrid');const empty=document.getElementById('spkEmpty');
  if(!f.length){grid.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  grid.innerHTML=f.map(s=>`<div class="spk-card"><div class="spk-top"><div class="spk-av">${s.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div><div><div class="spk-name">${s.name}</div><div class="spk-id">${s.id}</div></div></div><div class="spk-meta">${[s.company,s.sector,s.email].filter(Boolean).join(' · ')||'—'}</div><div class="spk-acts"><button class="btn btn-ghost btn-sm" onclick="editSpeaker('${s.id}')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteSpeaker('${s.id}')">Delete</button></div></div>`).join('');
}
function populateSpkDatalist(){document.getElementById('spkDatalist').innerHTML=speakers.map(s=>`<option value="${s.name}">`).join('');}
function openNewSpeaker(){editSpkId=null;document.getElementById('spkModalTitle').textContent='New Speaker';['sf-id','sf-name','sf-company','sf-email'].forEach(id=>document.getElementById(id).value='');document.getElementById('sf-sector').value='';openModal('spkModal');}
function editSpeaker(id){const s=speakers.find(sp=>sp.id===id);if(!s)return;editSpkId=id;document.getElementById('spkModalTitle').textContent='Edit Speaker';document.getElementById('sf-id').value=s.id;document.getElementById('sf-name').value=s.name;document.getElementById('sf-company').value=s.company||'';document.getElementById('sf-sector').value=s.sector||'';document.getElementById('sf-email').value=s.email||'';openModal('spkModal');}
async function saveSpeaker(){const name=document.getElementById('sf-name').value.trim();if(!name){toast('Name is required.','err');return;}const data={name,company:document.getElementById('sf-company').value.trim(),sector:document.getElementById('sf-sector').value,email:document.getElementById('sf-email').value.trim()};if(editSpkId){const idx=speakers.findIndex(s=>s.id===editSpkId);speakers[idx]={...speakers[idx],...data};await dbSaveSpeaker(speakers[idx]);toast('Speaker updated.','ok');}else{const sp={id:nextSpkId(),...data};speakers.push(sp);await dbSaveSpeaker(sp);toast('Speaker created.','ok');}closeModal('spkModal');renderSpeakers();}
async function deleteSpeaker(id){if(!confirm('Delete this speaker?'))return;speakers=speakers.filter(s=>s.id!==id);await dbDeleteSpeaker(id);renderSpeakers();toast('Speaker deleted.','ok');}

// ── Email ────────────────────────────────────────────────────────
function renderEmailPage(){
  document.getElementById('emailTo').value=cfg.to||'';document.getElementById('emailCc').value=cfg.cc||'';
  document.getElementById('emailStatusFilter').innerHTML=STATUSES.map(s=>`<label class="chk-label"><input type="checkbox" name="eStat" value="${s}" ${cfg.defaultStatuses.includes(s)?'checked':''}><span>${s}</span></label>`).join('');
}
async function generateEmail(){
  const to=document.getElementById('emailTo').value.trim();
  const selected=[...document.querySelectorAll('input[name=eStat]:checked')].map(c=>c.value);
  if(!selected.length){toast('Select at least one status.','err');return;}
  const matched=events.filter(e=>selected.includes(computeStatus(e)));
  if(!matched.length){toast('No events match.','err');return;}
  const todayIso=isoToday();const todayFmt=fmtDate(todayIso);
  const doFUP=document.getElementById('resetFUP').checked;const doReg=document.getElementById('resetReg').checked;
  const toUpdate=[];
  events.forEach(e=>{const st=computeStatus(e);if(doFUP&&st==='F-UP Needed'){e.fupDate=todayIso;toUpdate.push(e);}if(doReg&&st==='Registered'){e.requestedDate=todayIso;toUpdate.push(e);}});
  for(const e of toUpdate) await dbSaveEvent(e);
  const subject=cfg.subject.replace('{date}',todayFmt);
  const openingHtml=cfg.opening.replace('{date}',`<b>${todayFmt}</b>`).split('\n').filter(Boolean).map(l=>`<p style="margin:0 0 8px">${l}</p>`).join('');
  const rows=matched.map(e=>{const st=computeStatus(e);const sla=e.requestedDate?daysDiff(new Date(e.requestedDate),new Date(todayIso+'T00:00:00')):null;const preS=e.ratingPreCall?'★'.repeat(e.ratingPreCall)+'☆'.repeat(5-e.ratingPreCall):'—';const callS=e.ratingCall?'★'.repeat(e.ratingCall)+'☆'.repeat(5-e.ratingCall):'—';return `<tr style="background:${STATUS_BG[st]||'#fff'}"><td style="padding:8px 12px;border:1px solid #ddd"><b>${e.id}</b></td><td style="padding:8px 12px;border:1px solid #ddd">${e.name}</td><td style="padding:8px 12px;border:1px solid #ddd">${e.speaker||'—'}</td><td style="padding:8px 12px;border:1px solid #ddd">${e.sector||'—'}</td><td style="padding:8px 12px;border:1px solid #ddd"><b>${st}</b></td><td style="padding:8px 12px;border:1px solid #ddd">${sla!==null?sla+' days':'—'}</td><td style="padding:8px 12px;border:1px solid #ddd;color:#F15A22">${preS}</td><td style="padding:8px 12px;border:1px solid #ddd;color:#F15A22">${callS}</td></tr>`;}).join('');
  const closingHtml=cfg.closing.split('\n').filter(Boolean).map(l=>`<p style="margin:0 0 6px">${l}</p>`).join('');
  const sigHtml=cfg.signature.split('\n').filter(Boolean).map((l,i)=>i===0?`<p style="margin:0 0 2px">${l}</p>`:`<p style="margin:0;font-style:italic;color:#555">${l}</p>`).join('');
  const html=`<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;max-width:750px">${openingHtml}<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%;border-color:#ddd;margin:12px 0"><tr style="background:#1a1a1a;color:#fff;font-weight:bold"><td style="padding:9px 12px;border:1px solid #ddd">Event ID</td><td style="padding:9px 12px;border:1px solid #ddd">Event Name</td><td style="padding:9px 12px;border:1px solid #ddd">Speaker</td><td style="padding:9px 12px;border:1px solid #ddd">Sector</td><td style="padding:9px 12px;border:1px solid #ddd">Status</td><td style="padding:9px 12px;border:1px solid #ddd">SLA</td><td style="padding:9px 12px;border:1px solid #ddd">Pre-Call ★</td><td style="padding:9px 12px;border:1px solid #ddd">Call ★</td></tr>${rows}</table>${closingHtml}<br>${sigHtml}</body></html>`;
  window._emailHTML=html;window._emailTo=to;window._emailSubject=subject;
  document.getElementById('emailPreviewWrap').innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:12px;color:var(--text-s)">To: <b>${to||'(no recipient)'}</b></span><span style="font-size:12px;color:var(--text-xs)">· ${matched.length} event(s)</span></div><iframe id="prevFrame" style="width:100%;height:480px;border:1px solid var(--border);border-radius:4px"></iframe>`;
  setTimeout(()=>{const fr=document.getElementById('prevFrame');fr.contentDocument.open();fr.contentDocument.write(html);fr.contentDocument.close();},80);
  toast(`Preview ready — ${matched.length} event(s)`,'ok');
}
function copyEmailHTML(){if(!window._emailHTML){toast('Generate first.','err');return;}navigator.clipboard.writeText(window._emailHTML).then(()=>toast('HTML copied.','ok')).catch(()=>toast('Copy failed.','err'));}
function openMailto(){if(!window._emailHTML){toast('Generate first.','err');return;}navigator.clipboard.writeText(window._emailHTML).catch(()=>{});window.location.href=`mailto:${window._emailTo||''}?subject=${encodeURIComponent(window._emailSubject||'')}`;}

// ── Settings ─────────────────────────────────────────────────────
function renderSettings(){
  document.getElementById('cfg-name').value=currentUser.displayName||cfg.name;document.getElementById('cfg-initials').value=currentUser.initials||cfg.initials;document.getElementById('cfg-sla').value=cfg.sla;document.getElementById('cfg-to').value=cfg.to||'';document.getElementById('cfg-cc').value=cfg.cc||'';document.getElementById('cfg-subject').value=cfg.subject;document.getElementById('cfg-opening').value=cfg.opening;document.getElementById('cfg-closing').value=cfg.closing;document.getElementById('cfg-signature').value=cfg.signature;
  document.getElementById('cfg-defaultStatuses').innerHTML=STATUSES.map(s=>`<label class="chk-label"><input type="checkbox" name="cfgStat" value="${s}" ${cfg.defaultStatuses.includes(s)?'checked':''}><span>${s}</span></label>`).join('');
}
async function saveSettings(){
  cfg.sla=parseInt(document.getElementById('cfg-sla').value)||7;cfg.to=document.getElementById('cfg-to').value.trim();cfg.cc=document.getElementById('cfg-cc').value.trim();cfg.subject=document.getElementById('cfg-subject').value.trim()||CFG_DEFAULTS.subject;cfg.opening=document.getElementById('cfg-opening').value.trim()||CFG_DEFAULTS.opening;cfg.closing=document.getElementById('cfg-closing').value.trim()||CFG_DEFAULTS.closing;cfg.signature=document.getElementById('cfg-signature').value.trim()||CFG_DEFAULTS.signature;cfg.defaultStatuses=[...document.querySelectorAll('input[name=cfgStat]:checked')].map(c=>c.value);
  const users=await getAllUsers();const idx=users.findIndex(u=>u.username===currentUser.username);
  if(idx>=0){users[idx].displayName=document.getElementById('cfg-name').value.trim()||users[idx].displayName;users[idx].initials=document.getElementById('cfg-initials').value.trim().toUpperCase().slice(0,2)||users[idx].initials;currentUser=users[idx];await saveUserToDb(currentUser);sessionStorage.setItem('crm_session',JSON.stringify(currentUser));}
  saveLocal();document.getElementById('userAvatarBtn').textContent=currentUser.initials;toast('Settings saved.','ok');
}
function resetEmailTemplate(){document.getElementById('cfg-subject').value=CFG_DEFAULTS.subject;document.getElementById('cfg-opening').value=CFG_DEFAULTS.opening;document.getElementById('cfg-closing').value=CFG_DEFAULTS.closing;document.getElementById('cfg-signature').value=CFG_DEFAULTS.signature;toast('Template reset.','ok');}
async function changePassword(){
  const cur=document.getElementById('pw-current').value;const neu=document.getElementById('pw-new').value;const conf=document.getElementById('pw-confirm').value;
  if(!cur||!neu){toast('Fill current and new password.','err');return;}
  if(neu!==conf){toast('Passwords do not match.','err');return;}
  if(neu.length<6){toast('Min 6 characters.','err');return;}
  const users=await getAllUsers();const idx=users.findIndex(u=>u.username===currentUser.username);
  if(await sha256(cur)!==users[idx].passwordHash){toast('Current password is incorrect.','err');return;}
  users[idx].passwordHash=await sha256(neu);
  await saveUserToDb(users[idx]);
  ['pw-current','pw-new','pw-confirm'].forEach(id=>document.getElementById(id).value='');
  toast('Password changed.','ok');
}

// ── Supabase Connect page ────────────────────────────────────────
function renderConnect(){
  const {url,key}=getSupabaseCfg();
  document.getElementById('sb-url').value=url||'';
  document.getElementById('sb-key').value=key||'';
  document.getElementById('sb-status').textContent=isOnline()?'✅ Connected — real-time sync active':'⚠️ Not connected — using local storage';
  document.getElementById('sb-status').style.color=isOnline()?'#2e7d32':'#e65100';
}
async function saveSupabase(){
  const url=document.getElementById('sb-url').value.trim();
  const key=document.getElementById('sb-key').value.trim();
  if(!url||!key){toast('Enter both URL and Key.','err');return;}
  saveSupabaseCfg(url,key);
  const ok=initSupabase();
  if(ok){
    await dbLoadAll();
    subscribeRealtime();
    updateSyncStatus();
    renderConnect();
    toast('Connected to Supabase! Data synced.','ok');
  } else {
    toast('Connection failed. Check URL and Key.','err');
  }
}
function disconnectSupabase(){
  localStorage.removeItem('crm_supabase');
  _supabase=null;
  if(realtimeSub){realtimeSub.unsubscribe();realtimeSub=null;}
  updateSyncStatus();renderConnect();
  toast('Disconnected. Using local storage.','ok');
}

// ── Users ────────────────────────────────────────────────────────
async function renderUsers(){
  const users = await getAllUsers();
  document.getElementById('userTableBody').innerHTML=users.map(u=>`<tr><td>${u.username}</td><td>${u.displayName}</td><td>${u.initials}</td><td><span class="pill ${u.role==='admin'?'p-Requested':'p-Registered'}">${u.role}</span></td><td><div class="row-act">${u.username!==currentUser.username?`<button class="btn-ico del" onclick="deleteUser('${u.username}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>`:'<span style="color:var(--text-xs);font-size:11px">you</span>'}</div></td></tr>`).join('');
}
async function addUser(){
  const uname=document.getElementById('new-username').value.trim();
  const dname=document.getElementById('new-displayname').value.trim();
  const init=document.getElementById('new-initials').value.trim().toUpperCase().slice(0,2);
  const pass=document.getElementById('new-password').value;
  const role=document.getElementById('new-role').value;
  if(!uname||!pass||!dname){toast('Fill all required fields.','err');return;}
  const users=await getAllUsers();
  if(users.find(u=>u.username.toLowerCase()===uname.toLowerCase())){toast('Username already exists.','err');return;}
  const newUser={username:uname,displayName:dname,initials:init||uname.slice(0,2).toUpperCase(),role,passwordHash:await sha256(pass)};
  await saveUserToDb(newUser);
  ['new-username','new-displayname','new-initials','new-password'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('new-role').value='user';
  renderUsers();toast(`User "${uname}" created.`,'ok');
}
async function deleteUser(username){
  if(!confirm(`Delete user "${username}"?`))return;
  await deleteUserFromDb(username);
  renderUsers();toast(`User deleted.`,'ok');
}

// ── Import / Export ──────────────────────────────────────────────
function exportData(){const blob=new Blob([JSON.stringify({events,speakers,cfg,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`event-tracker-${isoToday()}.json`;a.click();toast('Exported.','ok');}
function importData(){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=async ev=>{try{const d=JSON.parse(ev.target.result);if(d.events)events=d.events;if(d.speakers)speakers=d.speakers;if(d.cfg)cfg={...CFG_DEFAULTS,...d.cfg};if(isOnline()){for(const ev of events)await dbSaveEvent(ev);for(const sp of speakers)await dbSaveSpeaker(sp);}saveLocal();renderDashboard();toast(`Imported ${events.length} events.`,'ok');}catch{toast('Invalid JSON.','err');}};r.readAsText(file);};input.click();}
function handleGlobalSearch(q){if(!q)return;activeFilter='All';setPage('events');document.getElementById('evtSearch').value=q;renderEvents();}

// ── Modals & Toast ───────────────────────────────────────────────
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.addEventListener('click',e=>{if(e.target.classList.contains('overlay'))e.target.classList.remove('open');});
function toggleUserMenu(){document.getElementById('userDropdown').classList.toggle('open');}
function closeUserMenu(){document.getElementById('userDropdown').classList.remove('open');}
document.addEventListener('click',e=>{if(!e.target.closest('.user-menu'))closeUserMenu();});
let _tt;
function toast(msg,type=''){const el=document.getElementById('toast');el.textContent=msg;el.className='toast show '+(type==='ok'?'ok':'err');clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),3000);}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await seedAdminIfNeeded();
  loadLocal();
  const ok = initSupabase();
  if (ok) {
    await dbLoadAll();
    subscribeRealtime();
  }
  if (restoreSession()) { showApp(); } else { showLoginScreen(); }
});
