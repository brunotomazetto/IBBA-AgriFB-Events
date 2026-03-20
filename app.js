/* ═══════════════════════════════════════════════════════════════
   Event Tracker CRM — app.js v5
   Supabase · cloud users · ratings · sort/filter · admin nav
═══════════════════════════════════════════════════════════════ */

// ── Supabase ────────────────────────────────────────────────────
let _supabase = null;
const SUPABASE_URL = 'https://adzincwymsigigibspyl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemluY3d5bXNpZ2lnaWJzcHlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTkyODgsImV4cCI6MjA4OTUzNTI4OH0.Ii26AIWaTh1MvYABuqacmrFDYFTg0I_FqpdoTcdIRfo';

function getSupabaseCfg() {
  try {
    const s = JSON.parse(localStorage.getItem('crm_supabase')) || {};
    return { url: s.url || SUPABASE_URL, key: s.key || SUPABASE_KEY };
  } catch { return { url: SUPABASE_URL, key: SUPABASE_KEY }; }
}
function saveSupabaseCfg(url, key) { localStorage.setItem('crm_supabase', JSON.stringify({ url, key })); }
function initSupabase() {
  const { url, key } = getSupabaseCfg();
  if (!url || !key) return false;
  try { _supabase = window.supabase.createClient(url, key); return true; }
  catch (e) { console.error('Supabase init error:', e); return false; }
}
function isOnline() { return !!_supabase; }

// ── Auth ────────────────────────────────────────────────────────
let currentUser = null;

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getLocalUsers() {
  try { return JSON.parse(localStorage.getItem('crm_users')) || []; } catch { return []; }
}
function saveLocalUsers(u) { localStorage.setItem('crm_users', JSON.stringify(u)); }

async function getAllUsers() {
  if (isOnline()) {
    const { data, error } = await _supabase.from('users').select('*');
    if (!error && data && data.length) {
      const mapped = data.map(r => ({ username:r.username, displayName:r.display_name, initials:r.initials, role:r.role, passwordHash:r.password_hash }));
      saveLocalUsers(mapped);
      return mapped;
    }
  }
  return getLocalUsers();
}
async function saveUserToDb(user) {
  const locals = getLocalUsers();
  const idx = locals.findIndex(u => u.username === user.username);
  if (idx >= 0) locals[idx] = user; else locals.push(user);
  saveLocalUsers(locals);
  if (isOnline()) {
    await _supabase.from('users').upsert({ username:user.username, display_name:user.displayName, initials:user.initials, role:user.role, password_hash:user.passwordHash }, { onConflict:'username' });
  }
}
async function deleteUserFromDb(username) {
  saveLocalUsers(getLocalUsers().filter(u => u.username !== username));
  if (isOnline()) await _supabase.from('users').delete().eq('username', username);
}
async function seedAdminIfNeeded() {
  const users = await getAllUsers();
  if (!users.length) {
    await saveUserToDb({ username:'admin', displayName:'Bruno Tomazetto', initials:'BT', role:'admin', passwordHash: await sha256('admin123') });
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
  try {
    const s = sessionStorage.getItem('crm_session');
    if (s) {
      currentUser = JSON.parse(s);
      // Merge emailPrefs from local users cache in case they were updated
      const locals = getLocalUsers();
      const cached = locals.find(u=>u.username===currentUser.username);
      if(cached && cached.emailPrefs) currentUser.emailPrefs = cached.emailPrefs;
      return true;
    }
  } catch {}
  return false;
}

// ── State ───────────────────────────────────────────────────────
let events = [], speakers = [], cfg = {};
let activeFilter = 'All', sortField = 'registeredDate', sortDir = 'desc';
let editEvtId = null, realtimeSub = null;

const STATUSES = ['Registered','Requested','F-UP Needed','Scheduled','Concluded','Canceled'];
const STATUS_COLORS = { 'Registered':'#2e7d32','Requested':'#b35000','F-UP Needed':'#e65100','Scheduled':'#444444','Concluded':'#37474f','Canceled':'#b71c1c' };
const STATUS_BG = { 'Registered':'#e8f5e9','Requested':'#fef3e2','F-UP Needed':'#fff0e6','Scheduled':'#f0f0f0','Concluded':'#eceff1','Canceled':'#ffebee' };
const CFG_DEFAULTS = {
  name:'Bruno Tomazetto', initials:'BT', sla:7, to:'', cc:'',
  defaultStatuses:['Requested','F-UP Needed'],
  subject:'[Equity Research] Corporate Access Update — {date}',
  opening:'Dear Corporate Access Team,\n\nPlease find below the pending events as of {date}:',
  closing:'Please confirm availability at your earliest convenience.',
  signature:'Thank you,\nEquity Research — Event Tracker',
};

// ── Persistence ─────────────────────────────────────────────────
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

// Save cfg (shared settings) to Supabase so all users get same email prefs
async function saveCfgToDb() {
  saveLocal();
  if (!isOnline()) return;
  await _supabase.from('settings').upsert({ id: 'global', data: cfg }, { onConflict: 'id' });
}

// Load cfg from Supabase on login
async function loadCfgFromDb() {
  if (!isOnline()) return;
  const { data, error } = await _supabase.from('settings').select('data').eq('id','global').single();
  if (!error && data?.data) {
    cfg = { ...CFG_DEFAULTS, ...data.data };
    saveLocal();
  }
}

// ── Supabase CRUD ────────────────────────────────────────────────
async function dbLoadAll() {
  if (!isOnline()) { loadLocal(); return; }
  try {
    const [er, sr] = await Promise.all([
      _supabase.from('events').select('*').order('registered_date', { ascending:false }),
      _supabase.from('speakers').select('*').order('name')
    ]);
    if (er.error) throw er.error;
    events   = (er.data || []).map(dbToEv);
    speakers = (sr.data || []).map(r => ({ id:r.id, name:r.name, company:r.company, sector:r.sector, email:r.email }));
    await loadCfgFromDb(); // load shared settings (email prefs etc)
    saveLocal();
  } catch (e) { console.error('DB load:', e); loadLocal(); toast('Using local data.','err'); }
}
async function dbSaveEvent(ev) {
  saveLocal();
  if (!isOnline()) return;
  const { error } = await _supabase.from('events').upsert(evToDb(ev), { onConflict:'id' });
  if (error) { console.error('Save event:', error); toast('Sync error: '+error.message,'err'); }
}
async function dbDeleteEvent(id) {
  saveLocal();
  if (!isOnline()) return;
  await _supabase.from('events').delete().eq('id', id);
}
function evToDb(ev) {
  return { id:ev.id, name:ev.name, sector:ev.sector||null,
    registered_date:ev.registeredDate||null, requested_date:ev.requestedDate||null,
    fup_date:ev.fupDate||null, scheduled_date:ev.scheduledDate||null,
    obs:ev.obs||null, canceled:!!ev.canceled,
    rating_pre_call:ev.ratingPreCall||0, rating_call:ev.ratingCall||0 };
}
function dbToEv(r) {
  return { id:r.id, name:r.name, sector:r.sector,
    registeredDate:r.registered_date, requestedDate:r.requested_date,
    fupDate:r.fup_date, scheduledDate:r.scheduled_date,
    obs:r.obs, canceled:r.canceled,
    ratingPreCall:r.rating_pre_call||0, ratingCall:r.rating_call||0 };
}

// ── Real-time ────────────────────────────────────────────────────
function subscribeRealtime() {
  if (!isOnline() || realtimeSub) return;
  realtimeSub = _supabase.channel('crm')
    .on('postgres_changes', { event:'*', schema:'public', table:'events' }, p => {
      if (p.eventType === 'DELETE') {
        events = events.filter(e => e.id !== p.old.id);
      } else {
        const ev = dbToEv(p.new);
        const i  = events.findIndex(e => e.id === ev.id);
        if (i >= 0) events[i] = ev; else events.unshift(ev);
      }
      saveLocal(); renderDashboard();
      if (document.getElementById('page-events').classList.contains('active')) renderEvents();
      showSyncPulse();
    }).subscribe();
}
function showSyncPulse() {
  const el = document.getElementById('syncDot');
  if (el) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 1200); }
}

// ── ID generators ────────────────────────────────────────────────
function nextEvtId() {
  const nums = events.map(e => parseInt(e.id?.replace('EVT',''))||0);
  return 'EVT' + String((nums.length ? Math.max(...nums) : 0)+1).padStart(4,'0');
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

// ── Stars ────────────────────────────────────────────────────────
function starHTML(value, field, id) {
  let h = '<div class="stars">';
  for (let i=1;i<=5;i++) {
    h += '<span class="star'+(i<=(value||0)?' on':'')+'" '
       + 'onclick="setRating(\''+id+'\',\''+field+'\','+i+')" '
       + 'onmouseover="hoverStars(this,'+i+')" '
       + 'onmouseout="resetStars(this)">★</span>';
  }
  return h+'</div>';
}
async function setRating(id, field, val) {
  const ev=events.find(e=>e.id===id); if(!ev) return;
  ev[field]=ev[field]===val?0:val;
  await dbSaveEvent(ev); renderEvents(); renderDashboard();
}
function hoverStars(el,n){ el.closest('.stars').querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('hover',i<n)); }
function resetStars(el)  { el.closest('.stars').querySelectorAll('.star').forEach(s=>s.classList.remove('hover')); }
function ratingBadge(val) {
  if (!val) return '<span style="color:var(--text-xs);font-size:11px">—</span>';
  return '<span style="color:#F15A22;font-size:12px">'+'★'.repeat(val)+'☆'.repeat(5-val)+'</span>';
}
function updateModalStars(fid) {
  const val=parseInt(document.getElementById(fid).value)||0;
  const el=document.getElementById(fid+'-stars');
  if (!el) return;
  el.querySelectorAll('.star-btn').forEach((s,i)=>{s.classList.toggle('on',i<val);s.textContent=i<val?'★':'☆';});
}
function setModalStar(fid,val) {
  const cur=parseInt(document.getElementById(fid).value)||0;
  document.getElementById(fid).value=cur===val?0:val;
  updateModalStars(fid);
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
  const isAdmin = currentUser.role === 'admin';
  ['tl-connect','tl-users','tl-settings'].forEach(id => {
    const el=document.getElementById(id); if(el) el.style.display=isAdmin?'':'none';
  });
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
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.getElementById('loginScreen')?.style.display!=='none') handleLogin();
});

function updateSyncStatus() {
  const el=document.getElementById('syncStatus');
  if(!el) return;
  el.innerHTML=isOnline()
    ?'<span id="syncDot" class="sync-dot online"></span><span>Live sync</span>'
    :'<span class="sync-dot offline"></span><span>Local</span>';
}

// ── Navigation ───────────────────────────────────────────────────
function setPage(p) {
  document.querySelectorAll('.page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.sub-btn').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.top-link').forEach(el=>el.classList.remove('active'));
  document.getElementById('page-'+p)?.classList.add('active');
  document.getElementById('snav-'+p)?.classList.add('active');
  const adminPages=['connect','users','settings'];
  if(adminPages.includes(p)){
    document.getElementById('tl-'+p)?.classList.add('active');
  } else {
    document.querySelector('.top-link[data-page="dashboard"]')?.classList.add('active');
  }
  if(p==='dashboard') renderDashboard();
  if(p==='events')    renderEvents();
  if(p==='email')     renderEmailPage();
  if(p==='settings')  renderSettings();
  if(p==='users')     renderUsers();
  if(p==='connect')   renderConnect();
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.top-link[data-page]').forEach(btn => {
    btn.addEventListener('click', ()=>setPage(btn.dataset.page));
  });
});

// ── Dashboard ────────────────────────────────────────────────────
function getDashFiltered() {
  const sector=document.getElementById('df-sector')?.value||'';
  const month =document.getElementById('df-month')?.value||'';
  const status=document.getElementById('df-status')?.value||'';
  return events.filter(e=>{
    if(sector && e.sector!==sector) return false;
    if(status && computeStatus(e)!==status) return false;
    if(month){
      const d=e.registeredDate?new Date(e.registeredDate+'T00:00:00'):null;
      if(!d||String(d.getMonth()+1)!==month) return false;
    }
    return true;
  });
}
function renderDashboard() {
  const h=new Date().getHours();
  document.getElementById('greetingText').textContent=(h<12?'Good morning':h<18?'Good afternoon':'Good evening')+', '+(currentUser?.displayName||cfg.name);
  document.getElementById('greetingDate').textContent=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('userAvatarBtn').textContent=currentUser?.initials||'BT';

  const filtered=getDashFiltered();
  const counts={}; STATUSES.forEach(s=>counts[s]=0);
  filtered.forEach(e=>counts[computeStatus(e)]++);
  const total=filtered.length;

  const icons={
    'All':         '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    'Registered':  '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    'Requested':   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    'F-UP Needed': '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'Scheduled':   '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    'Concluded':   '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    'Canceled':    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };
  document.getElementById('quickGrid').innerHTML=[['All',total],...STATUSES.map(s=>[s,counts[s]])].map(function(pair){
    var s=pair[0], n=pair[1];
    var cls='qcard'+(activeFilter===s?' active-card':'');
    var bg=s==='All'?'#f0f0f0':STATUS_BG[s];
    var col=s==='All'?'#333':STATUS_COLORS[s];
    var lbl=s==='All'?'Total':s;
    return '<div class="'+cls+'" onclick="goFilter(&apos;'+s+'&apos;)">'
      +'<div class="qicon" style="background:'+bg+';color:'+col+'">'+(icons[s]||'')+'</div>'
      +'<div class="qcount">'+n+'</div>'
      +'<div class="qlabel">'+lbl+'</div>'
      +'</div>';
  }).join('');

  document.getElementById('pipelineChart').innerHTML=STATUSES.map(s=>
    '<div class="bar-row"><div class="bar-label">'+s+'</div>'
    +'<div class="bar-track"><div class="bar-fill" style="width:'+(total?((counts[s]/total)*100).toFixed(1):0)+'%;background:'+STATUS_COLORS[s]+'"></div></div>'
    +'<div class="bar-num">'+counts[s]+'</div></div>'
  ).join('');

  const recent=[...filtered].sort((a,b)=>(b.registeredDate||'').localeCompare(a.registeredDate||'')).slice(0,6);
  document.getElementById('recentBody').innerHTML=recent.map(e=>{
    const st=computeStatus(e); const sla=computeSLA(e);
    return '<tr onclick="editEvent(' + "'" + e.id + "'" + ')">'
      +'<td><span class="evt-id">'+e.id+'</span></td>'
      +'<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+e.name+'</td>'
      +'<td><span class="pill '+pillClass(st)+'">'+st+'</span></td>'
      +'<td>'+(sla===null?'<span class="sla sla-na">—</span>':sla>cfg.sla?'<span class="sla sla-warn">⚠'+sla+'d</span>':'<span class="sla sla-ok">'+sla+'d</span>')+'</td>'
      +'<td>'+ratingBadge(e.ratingPreCall)+'</td>'
      +'<td>'+ratingBadge(e.ratingCall)+'</td>'
      +'</tr>';
  }).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text-xs);padding:20px">No events</td></tr>';

  const fups=filtered.filter(e=>computeStatus(e)==='F-UP Needed');
  document.getElementById('fupBadge').textContent=fups.length;
  document.getElementById('fupList').innerHTML=fups.length
    ?fups.map(e=>'<div class="att-item" onclick="editEvent(' + "'" + e.id + "'" + ')">'
        +'<div class="att-dot" style="background:#e65100"></div>'
        +'<div><div class="att-name">'+e.name+'</div>'
        +'<div class="att-meta">'+e.id+' · '+computeSLA(e)+' days</div></div></div>').join('')
    :'<div style="padding:10px 0;font-size:11px;color:var(--text-xs)">No events need attention 🎉</div>';

  const scheds=filtered.filter(e=>computeStatus(e)==='Scheduled').sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate)).slice(0,5);
  document.getElementById('schedBadge').textContent=scheds.length;
  document.getElementById('schedList').innerHTML=scheds.length
    ?scheds.map(e=>'<div class="att-item" onclick="editEvent(' + "'" + e.id + "'" + ')">'
        +'<div class="att-dot" style="background:#6a1b9a"></div>'
        +'<div><div class="att-name">'+e.name+'</div>'
        +'<div class="att-meta">'+e.id+' · '+fmtDateShort(e.scheduledDate)+'</div></div></div>').join('')
    :'<div style="padding:10px 0;font-size:11px;color:var(--text-xs)">No upcoming events</div>';
}
function goFilter(s){activeFilter=s;setPage('events');}

// ── Events ───────────────────────────────────────────────────────
function pillClass(st){
  return {Registered:'p-Registered',Requested:'p-Requested','F-UP Needed':'p-FUP',Scheduled:'p-Scheduled',Concluded:'p-Concluded',Canceled:'p-Canceled'}[st]||'';
}
function getFilteredSorted() {
  const q=(document.getElementById('evtSearch')?.value||'').toLowerCase();
  let f=events.filter(e=>{
    if(activeFilter!=='All'&&computeStatus(e)!==activeFilter) return false;
    if(q&&!e.name.toLowerCase().includes(q)&&!(e.sector||'').toLowerCase().includes(q)) return false;
    return true;
  });
  f.sort((a,b)=>{
    let va,vb;
    switch(sortField){
      case 'status':        va=computeStatus(a);   vb=computeStatus(b);   break;
      case 'name':          va=a.name||'';          vb=b.name||'';         break;
      case 'sector':        va=a.sector||'';        vb=b.sector||'';       break;
      case 'requestedDate': va=a.requestedDate||''; vb=b.requestedDate||'';break;
      case 'scheduledDate': va=a.scheduledDate||''; vb=b.scheduledDate||'';break;
      case 'sla':           va=computeSLA(a)??-1;   vb=computeSLA(b)??-1;  break;
      case 'ratingPreCall': va=a.ratingPreCall||0;  vb=b.ratingPreCall||0; break;
      case 'ratingCall':    va=a.ratingCall||0;     vb=b.ratingCall||0;    break;
      default:              va=a.registeredDate||'';vb=b.registeredDate||'';
    }
    if(va<vb) return sortDir==='asc'?-1:1;
    if(va>vb) return sortDir==='asc'?1:-1;
    return 0;
  });
  return f;
}
function setSort(field){
  if(sortField===field) sortDir=sortDir==='asc'?'desc':'asc';
  else { sortField=field; sortDir='asc'; }
  renderEvents();
}
function sortArrow(field){
  if(sortField!==field) return '<span style="opacity:.25;margin-left:2px">⇅</span>';
  return sortDir==='asc'
    ?'<span style="color:var(--orange);margin-left:2px">↑</span>'
    :'<span style="color:var(--orange);margin-left:2px">↓</span>';
}
function renderStatusChips(){
  document.getElementById('statusChips').innerHTML=['All',...STATUSES].map(s=>
    '<button class="chip'+(activeFilter===s?' on':'')+'" data-s="'+s+'" onclick="setFilter(\''+s+'\')">'+s+'</button>'
  ).join('');
}
function setFilter(s){ activeFilter=s; renderEvents(); }

function renderEvents(){
  renderStatusChips();
  const filtered=getFilteredSorted();
  const tbody=document.getElementById('evtBody');
  const empty=document.getElementById('evtEmpty');
  if(!filtered.length){tbody.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  document.querySelectorAll('.dtbl th.sortable').forEach(th=>{
    const f=th.getAttribute('data-sort');
    const sa=th.querySelector('.sa');
    if(sa&&f) sa.innerHTML=sortArrow(f);
  });
  tbody.innerHTML=filtered.map(e=>{
    const st=computeStatus(e); const sla=computeSLA(e);
    const slaH=sla===null?'<span class="sla sla-na">—</span>'
      :sla>cfg.sla?'<span class="sla sla-warn">⚠ '+sla+'d</span>'
      :'<span class="sla sla-ok">'+sla+'d</span>';
    return '<tr class="'+(st==='Canceled'?'canceled':'')+'">'
      +'<td><span class="evt-id">'+e.id+'</span></td>'
      +'<td title="'+e.name+'"><strong>'+e.name+'</strong></td>'
      +'<td>'+(e.sector||'—')+'</td>'
      +'<td><span class="pill '+pillClass(st)+'">'+st+'</span></td>'
      +'<td>'+fmtDate(e.registeredDate)+'</td>'
      +'<td>'+fmtDate(e.requestedDate)+'</td>'
      +'<td>'+fmtDate(e.fupDate)+'</td>'
      +'<td>'+fmtDate(e.scheduledDate)+'</td>'
      +'<td>'+slaH+'</td>'
      +'<td>'+starHTML(e.ratingPreCall,'ratingPreCall',e.id)+'</td>'
      +'<td>'+starHTML(e.ratingCall,'ratingCall',e.id)+'</td>'
      +'<td title="'+(e.obs||'')+'">'+(e.obs||'—')+'</td>'
      +'<td><div class="row-act">'
      +'<button class="bico" onclick="editEvent(\''+e.id+'\')" title="Edit">'
      +'<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
      +'<button class="bico del" onclick="deleteEvent(\''+e.id+'\')" title="Delete">'
      +'<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>'
      +'</div></td></tr>';
  }).join('');
}

function openNewEvent(){
  editEvtId=null;
  document.getElementById('evtModalTitle').textContent='New Event';
  ['ef-id','ef-name','ef-speaker','ef-reg','ef-req','ef-fup','ef-sch','ef-obs'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('ef-sector').value='';
  document.getElementById('ef-canceled').checked=false;
  document.getElementById('ef-rating-pre').value='0';
  document.getElementById('ef-rating-call').value='0';
  updateModalStars('ef-rating-pre'); updateModalStars('ef-rating-call');
  populateSpkDatalist(); openModal('evtModal');
}
function editEvent(id){
  const e=events.find(ev=>ev.id===id); if(!e) return;
  editEvtId=id;
  document.getElementById('evtModalTitle').textContent='Edit Event';
  document.getElementById('ef-id').value=e.id;
  document.getElementById('ef-name').value=e.name;
  document.getElementById('ef-speaker').value=e.speaker||'';
  document.getElementById('ef-sector').value=e.sector||'';
  document.getElementById('ef-reg').value=e.registeredDate||'';
  document.getElementById('ef-req').value=e.requestedDate||'';
  document.getElementById('ef-fup').value=e.fupDate||'';
  document.getElementById('ef-sch').value=e.scheduledDate||'';
  document.getElementById('ef-obs').value=e.obs||'';
  document.getElementById('ef-canceled').checked=!!e.canceled;
  document.getElementById('ef-rating-pre').value=e.ratingPreCall||0;
  document.getElementById('ef-rating-call').value=e.ratingCall||0;
  updateModalStars('ef-rating-pre'); updateModalStars('ef-rating-call');
  populateSpkDatalist(); openModal('evtModal');
}
async function saveEvent(){
  const name=document.getElementById('ef-name').value.trim();
  if(!name){toast('Event name is required.','err');return;}
  const data={
    name,
    speaker:       document.getElementById('ef-speaker').value.trim(),
    sector:        document.getElementById('ef-sector').value,
    registeredDate:document.getElementById('ef-reg').value||null,
    requestedDate: document.getElementById('ef-req').value||null,
    fupDate:       document.getElementById('ef-fup').value||null,
    scheduledDate: document.getElementById('ef-sch').value||null,
    obs:           document.getElementById('ef-obs').value.trim(),
    canceled:      document.getElementById('ef-canceled').checked,
    ratingPreCall: parseInt(document.getElementById('ef-rating-pre').value)||0,
    ratingCall:    parseInt(document.getElementById('ef-rating-call').value)||0,
  };
  if(editEvtId){
    const idx=events.findIndex(e=>e.id===editEvtId);
    events[idx]={...events[idx],...data};
    await dbSaveEvent(events[idx]); toast('Event updated.','ok');
  } else {
    if(!data.registeredDate) data.registeredDate=isoToday();
    const ev={id:nextEvtId(),...data};
    events.unshift(ev); await dbSaveEvent(ev); toast('Event created.','ok');
  }
  closeModal('evtModal'); renderEvents(); renderDashboard();
}
async function deleteEvent(id){
  if(!confirm('Delete this event?')) return;
  events=events.filter(e=>e.id!==id);
  await dbDeleteEvent(id); renderEvents(); renderDashboard(); toast('Event deleted.','ok');
}
function populateSpkDatalist(){
  document.getElementById('spkDatalist').innerHTML=speakers.map(s=>'<option value="'+s.name+'">').join('');
}

// ── Email ────────────────────────────────────────────────────────
function renderEmailPage(){
  // Shared email prefs stored in cfg (same for all users)
  document.getElementById('emailTo').value = cfg.to||'';
  document.getElementById('emailCc').value = cfg.cc||'';
  document.getElementById('emailStatusFilter').innerHTML=STATUSES.map(s=>
    '<label class="chk-label"><input type="checkbox" name="eStat" value="'+s+'" '+(cfg.defaultStatuses.includes(s)?'checked':'')+'>'+
    '<span>'+s+'</span></label>'
  ).join('');
}

async function saveEmailPrefs(){
  // Save To, CC and statuses to shared cfg (synced via Supabase for all users)
  cfg.to = document.getElementById('emailTo').value.trim();
  cfg.cc = document.getElementById('emailCc').value.trim();
  cfg.defaultStatuses = [...document.querySelectorAll('input[name=eStat]:checked')].map(c=>c.value);
  await saveCfgToDb(); // sync email prefs for all users
}

async function generateEmail(){
  await saveEmailPrefs(); // persist per-user prefs
  const to=document.getElementById('emailTo').value.trim();
  const selected=[...document.querySelectorAll('input[name=eStat]:checked')].map(c=>c.value);
  if(!selected.length){toast('Select at least one status.','err');return;}
  const matched=events.filter(e=>selected.includes(computeStatus(e)));
  if(!matched.length){toast('No events match.','err');return;}

  const todayIso=isoToday(); const todayFmt=fmtDate(todayIso);
  const doFUP=document.getElementById('resetFUP').checked;
  const doReg=document.getElementById('resetReg').checked;

  // Update statuses — never touch registeredDate
  const toUpdate=[];
  events.forEach(e=>{
    const st=computeStatus(e);
    if(doFUP && st==='F-UP Needed'){ e.fupDate=todayIso; toUpdate.push(e); }
    if(doReg && st==='Registered') { e.requestedDate=todayIso; toUpdate.push(e); }
  });
  for(const e of toUpdate) await dbSaveEvent(e);

  const subject=cfg.subject.replace('{date}',todayFmt);

  const para = function(txt,bold){
    return '<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a">'
      +(bold?'<b>'+txt+'</b>':txt)+'</p>';
  };
  const openingHtml=cfg.opening.replace('{date}','__DATE__').split('\n').filter(Boolean)
    .map(l=>para(l.replace('__DATE__','<b>'+todayFmt+'</b>'))).join('');
  const closingHtml=cfg.closing.split('\n').filter(Boolean).map(l=>para(l)).join('');
  const sigHtml=cfg.signature.split('\n').filter(Boolean).map((l,i)=>
    '<p style="margin:0 0 2px;font-family:Arial,sans-serif;font-size:'+(i===0?'13':'12')+'px;'
    +(i===0?'font-weight:600;':'font-style:italic;')+'color:'+(i===0?'#1a1a1a':'#666')+'">'+l+'</p>'
  ).join('');

  const TH='padding:9px 12px;border:1px solid #333;font-family:Arial,sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em';
  const TD='padding:8px 12px;border:1px solid #ddd;font-family:Arial,sans-serif;font-size:12px';

  const headerRow='<tr style="background:#1a1a1a;color:#fff">'
    +'<td style="'+TH+'">Event ID</td>'
    +'<td style="'+TH+'">Event Name</td>'
    +'<td style="'+TH+'">Speaker</td>'
    +'<td style="'+TH+'">Sector</td>'
    +'<td style="'+TH+'">Status</td>'
    +'<td style="'+TH+'">SLA Since Request</td>'
    +'<td style="'+TH+'">Observations</td>'
    +'</tr>';

  const dataRows=matched.map(e=>{
    const st=computeStatus(e);
    const sla=e.requestedDate?daysDiff(new Date(e.requestedDate),new Date(todayIso+'T00:00:00')):null;
    const rowBg=STATUS_BG[st]||'#fff';
    const stColor=STATUS_COLORS[st]||'#333';
    return '<tr style="background:'+rowBg+'">'
      +'<td style="'+TD+'"><b>'+e.id+'</b></td>'
      +'<td style="'+TD+'">'+e.name+'</td>'
      +'<td style="'+TD+'">'+(e.speaker||'—')+'</td>'
      +'<td style="'+TD+'">'+(e.sector||'—')+'</td>'
      +'<td style="'+TD+';font-weight:700;color:'+stColor+'">'+st+'</td>'
      +'<td style="'+TD+'">'+(sla!==null?sla+' days':'—')+'</td>'
      +'<td style="'+TD+'">'+(e.obs||'—')+'</td>'
      +'</tr>';
  }).join('');

  const html='<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;max-width:720px;margin:0 auto;padding:20px">'
    +'<div style="background:#1a1a1a;padding:16px 20px;margin-bottom:20px">'
    +'<span style="color:#F15A22;font-weight:700;font-size:16px">itaú</span>'
    +'<span style="color:#fff;font-weight:700;font-size:16px"> BBA</span>'
    +'<span style="color:#888;font-size:12px;margin-left:12px">Equity Research — Event Tracker</span>'
    +'</div>'
    +openingHtml
    +'<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%;border-color:#ddd;margin:14px 0">'
    +headerRow+dataRows
    +'</table>'
    +'<div style="border-top:2px solid #F15A22;margin-top:20px;padding-top:14px">'
    +closingHtml+'<br>'+sigHtml
    +'</div></body></html>';

  window._emailHTML=html;
  window._emailTo=to;
  window._emailSubject=subject;

  const blob=new Blob([html],{type:'text/html'});
  const blobUrl=URL.createObjectURL(blob);
  document.getElementById('emailPreviewWrap').innerHTML=
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
    +'<span style="font-size:12px;color:var(--text-s)">To: <b>'+(to||'(no recipient)')+'</b> · '+matched.length+' event(s)</span></div>'
    +'<div style="background:#fff3e0;border:1px solid #ffe0b2;border-radius:5px;padding:10px 14px;margin-bottom:10px;font-size:12px;color:#7a3e00">'
    +'<b>To send via Outlook:</b> Click <strong>Open Email Window</strong> → press <strong>Ctrl+A</strong> then <strong>Ctrl+C</strong> → open Outlook → New Email → click body → <strong>Ctrl+V</strong> → Send.'
    +'</div>'
    +'<iframe src="'+blobUrl+'" style="width:100%;height:400px;border:1px solid var(--border);border-radius:4px"></iframe>';
  toast('Preview ready — '+matched.length+' event(s)','ok');
}

function copyEmailHTML(){
  if(!window._emailHTML){toast('Generate first.','err');return;}
  navigator.clipboard.writeText(window._emailHTML).then(()=>toast('HTML copied.','ok')).catch(()=>toast('Copy failed.','err'));
}

function openMailto(){
  if(!window._emailHTML){toast('Generate first.','err');return;}
  const win=window.open('','_blank','width=860,height=680,resizable=yes');
  if(!win){toast('Allow popups for this site, then try again.','err');return;}
  const to = window._emailTo||'';
  const cc = document.getElementById('emailCc')?.value.trim()||'';
  const subj = encodeURIComponent(window._emailSubject||'');
  const mailtoLink = 'mailto:'+encodeURIComponent(to)
    +(cc?'?cc='+encodeURIComponent(cc)+'&':'?')
    +'subject='+subj;
  const body=window._emailHTML.replace(/<html>|<\/html>|<body[^>]*>|<\/body>/gi,'');
  const page='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Send via Outlook</title>'
    +'<style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f4f4f4}'
    +'.topbar{background:#1a1a1a;color:#fff;padding:0 18px;display:flex;align-items:center;height:52px;gap:14px;position:sticky;top:0;z-index:10}'
    +'.topbar-logo{color:#F15A22;font-weight:700;font-size:15px;margin-right:6px}'
    +'.step{font-size:12px;display:flex;align-items:center;gap:5px;white-space:nowrap}'
    +'.num{width:20px;height:20px;border-radius:50%;background:#F15A22;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px;flex-shrink:0}'
    +'.btn-sel{background:#F15A22;color:#fff;border:none;border-radius:4px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;margin-left:auto;white-space:nowrap}'
    +'.btn-sel:hover{background:#d94e1a}'
    +'.meta-bar{background:#fff;border-bottom:1px solid #e0e0e0;padding:10px 20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}'
    +'.meta-field{display:flex;align-items:center;gap:6px;font-size:12px;color:#555}'
    +'.meta-label{font-weight:600;color:#1a1a1a;min-width:30px}'
    +'.meta-val{color:#b35000;font-weight:500}'
    +'.btn-open-ol{background:#1a1a1a;color:#fff;border:none;border-radius:4px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;margin-left:auto}'
    +'.btn-open-ol:hover{background:#333}'
    +'.content{padding:20px;max-width:760px;margin:0 auto}'
    +'</style></head><body>'
    +'<div class="topbar">'
    +'<span class="topbar-logo">itaú BBA</span>'
    +'<div class="step"><div class="num">1</div><span>Click <b>Open in Outlook</b> to create a new email</span></div>'
    +'<div class="step"><div class="num">2</div><span>Click <b>Select All</b> then <b>Ctrl+C</b></span></div>'
    +'<div class="step"><div class="num">3</div><span>Paste into Outlook body → Send</span></div>'
    +'<button class="btn-sel" onclick="selAll()">Select All Content</button>'
    +'</div>'
    +'<div class="meta-bar">'
    +'<div class="meta-field"><span class="meta-label">To:</span><span class="meta-val">'+to+'</span></div>'
    +(cc?'<div class="meta-field"><span class="meta-label">CC:</span><span class="meta-val">'+cc+'</span></div>':' ')
    +'<div class="meta-field" style="flex:1"><span class="meta-label">Subject:</span><span style="font-size:12px;color:#333">'+( window._emailSubject||'')+'</span></div>'
    +'<a class="btn-open-ol" href="'+mailtoLink+'" target="_blank">Open in Outlook ↗</a>'
    +'</div>'
    +'<div class="content" id="ec">'+body+'</div>'
    +'<script>function selAll(){'
    +'var r=document.createRange();'
    +'r.selectNode(document.getElementById("ec"));'
    +'window.getSelection().removeAllRanges();'
    +'window.getSelection().addRange(r);'
    +'try{document.execCommand("copy");alert("Copied! Now paste into Outlook.");}catch(e){}'
    +'}<\/script>'
    +'</body></html>';
  win.document.write(page);
  win.document.close();
}

// ── Settings ─────────────────────────────────────────────────────
function renderSettings(){
  document.getElementById('cfg-name').value=currentUser.displayName||cfg.name;
  document.getElementById('cfg-initials').value=currentUser.initials||cfg.initials;
  document.getElementById('cfg-sla').value=cfg.sla;
  document.getElementById('cfg-to').value=cfg.to||'';
  document.getElementById('cfg-cc').value=cfg.cc||'';
  document.getElementById('cfg-subject').value=cfg.subject;
  document.getElementById('cfg-opening').value=cfg.opening;
  document.getElementById('cfg-closing').value=cfg.closing;
  document.getElementById('cfg-signature').value=cfg.signature;
  document.getElementById('cfg-defaultStatuses').innerHTML=STATUSES.map(s=>
    '<label class="chk-label"><input type="checkbox" name="cfgStat" value="'+s+'" '+(cfg.defaultStatuses.includes(s)?'checked':'')+'>'+
    '<span>'+s+'</span></label>'
  ).join('');
}
async function saveSettings(){
  cfg.sla=parseInt(document.getElementById('cfg-sla').value)||7;
  cfg.to=document.getElementById('cfg-to').value.trim();
  cfg.cc=document.getElementById('cfg-cc').value.trim();
  cfg.subject=document.getElementById('cfg-subject').value.trim()||CFG_DEFAULTS.subject;
  cfg.opening=document.getElementById('cfg-opening').value.trim()||CFG_DEFAULTS.opening;
  cfg.closing=document.getElementById('cfg-closing').value.trim()||CFG_DEFAULTS.closing;
  cfg.signature=document.getElementById('cfg-signature').value.trim()||CFG_DEFAULTS.signature;
  cfg.defaultStatuses=[...document.querySelectorAll('input[name=cfgStat]:checked')].map(c=>c.value);
  const users=await getAllUsers();
  const idx=users.findIndex(u=>u.username===currentUser.username);
  if(idx>=0){
    users[idx].displayName=document.getElementById('cfg-name').value.trim()||users[idx].displayName;
    users[idx].initials=document.getElementById('cfg-initials').value.trim().toUpperCase().slice(0,2)||users[idx].initials;
    currentUser=users[idx];
    await saveUserToDb(currentUser);
    sessionStorage.setItem('crm_session',JSON.stringify(currentUser));
  }
  await saveCfgToDb();
  document.getElementById('userAvatarBtn').textContent=currentUser.initials;
  toast('Settings saved.','ok');
}
function resetEmailTemplate(){
  document.getElementById('cfg-subject').value=CFG_DEFAULTS.subject;
  document.getElementById('cfg-opening').value=CFG_DEFAULTS.opening;
  document.getElementById('cfg-closing').value=CFG_DEFAULTS.closing;
  document.getElementById('cfg-signature').value=CFG_DEFAULTS.signature;
  toast('Template reset.','ok');
}
async function changePassword(){
  const cur=document.getElementById('pw-current').value;
  const neu=document.getElementById('pw-new').value;
  const conf=document.getElementById('pw-confirm').value;
  if(!cur||!neu){toast('Fill current and new password.','err');return;}
  if(neu!==conf){toast('Passwords do not match.','err');return;}
  if(neu.length<6){toast('Min 6 characters.','err');return;}
  const users=await getAllUsers();
  const idx=users.findIndex(u=>u.username===currentUser.username);
  if(await sha256(cur)!==users[idx].passwordHash){toast('Current password is incorrect.','err');return;}
  users[idx].passwordHash=await sha256(neu);
  await saveUserToDb(users[idx]);
  ['pw-current','pw-new','pw-confirm'].forEach(id=>document.getElementById(id).value='');
  toast('Password changed.','ok');
}

// ── Connect ──────────────────────────────────────────────────────
function renderConnect(){
  const {url,key}=getSupabaseCfg();
  document.getElementById('sb-url').value=url===SUPABASE_URL?'':url;
  document.getElementById('sb-key').value=key===SUPABASE_KEY?'':key;
  document.getElementById('sb-status').innerHTML=isOnline()
    ?'<span style="color:#2e7d32;font-weight:600">✅ Connected — real-time sync active</span>'
    :'<span style="color:#e65100;font-weight:600">⚠️ Not connected — using local storage</span>';
}
async function saveSupabase(){
  const url=document.getElementById('sb-url').value.trim()||SUPABASE_URL;
  const key=document.getElementById('sb-key').value.trim()||SUPABASE_KEY;
  saveSupabaseCfg(url,key);
  if(initSupabase()){
    await dbLoadAll(); subscribeRealtime(); updateSyncStatus(); renderConnect();
    toast('Connected!','ok');
  } else {
    toast('Connection failed.','err');
  }
}
function disconnectSupabase(){
  localStorage.removeItem('crm_supabase'); _supabase=null;
  if(realtimeSub){realtimeSub.unsubscribe();realtimeSub=null;}
  updateSyncStatus(); renderConnect(); toast('Disconnected.','ok');
}

// ── Users ────────────────────────────────────────────────────────
async function renderUsers(){
  const users=await getAllUsers();
  document.getElementById('userTableBody').innerHTML=users.map(u=>
    '<tr>'
    +'<td>'+u.username+'</td><td>'+u.displayName+'</td><td>'+u.initials+'</td>'
    +'<td><span class="pill '+(u.role==='admin'?'p-Requested':'p-Registered')+'">'+u.role+'</span></td>'
    +'<td><div class="row-act">'+(u.username!==currentUser.username
      ?'<button class="bico del" onclick="deleteUser(\''+u.username+'\')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>'
      :'<span style="font-size:10px;color:var(--text-xs)">you</span>')
    +'</div></td></tr>'
  ).join('');
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
  await saveUserToDb({username:uname,displayName:dname,initials:init||uname.slice(0,2).toUpperCase(),role,passwordHash:await sha256(pass)});
  ['new-username','new-displayname','new-initials','new-password'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('new-role').value='user';
  renderUsers(); toast('User "'+uname+'" created.','ok');
}
async function deleteUser(username){
  if(!confirm('Delete user "'+username+'"?')) return;
  await deleteUserFromDb(username); renderUsers(); toast('User deleted.','ok');
}

// ── Import/Export ────────────────────────────────────────────────
function exportData(){
  const blob=new Blob([JSON.stringify({events,speakers,cfg,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='event-tracker-'+isoToday()+'.json'; a.click(); toast('Exported.','ok');
}
function importData(){
  const input=document.createElement('input'); input.type='file'; input.accept='.json';
  input.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const r=new FileReader();
    r.onload=async ev=>{
      try{
        const d=JSON.parse(ev.target.result);
        if(d.events)   events=d.events;
        if(d.speakers) speakers=d.speakers;
        if(d.cfg)      cfg={...CFG_DEFAULTS,...d.cfg};
        if(isOnline()) for(const ev of events) await dbSaveEvent(ev);
        saveLocal(); renderDashboard(); toast('Imported '+events.length+' events.','ok');
      } catch { toast('Invalid JSON.','err'); }
    };
    r.readAsText(file);
  };
  input.click();
}
function handleGlobalSearch(q){
  if(!q) return;
  activeFilter='All'; setPage('events');
  document.getElementById('evtSearch').value=q; renderEvents();
}

// ── Modals & Toast ───────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e=>{ if(e.target.classList.contains('overlay')) e.target.classList.remove('open'); });
let _tt;
function toast(msg,type){
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='toast show '+(type==='ok'?'ok':'err');
  clearTimeout(_tt); _tt=setTimeout(()=>el.classList.remove('show'),3000);
}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async ()=>{
  await seedAdminIfNeeded();
  loadLocal();
  const ok=initSupabase();
  if(ok){ await dbLoadAll(); subscribeRealtime(); }
  if(restoreSession()){ showApp(); } else { showLoginScreen(); }
});
