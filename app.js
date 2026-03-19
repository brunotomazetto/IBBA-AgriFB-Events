/* ═══════════════════════════════════════════════════════════════
   Event Tracker CRM — app.js
   All data stored in localStorage. No backend required.
═══════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────
let events   = [];
let speakers = [];
let activeFilter = 'All';
let editingEventId = null;
let editingSpeakerId = null;

const SECTORS = ['Agribusiness','Food','Beverage','F&B','Agri F&B'];
const STATUSES = ['Registered','Requested','F-UP Needed','Scheduled','Concluded','Canceled'];
const SLA_DAYS = 7;

// ── Persistence ────────────────────────────────────────────────
function save() {
  localStorage.setItem('crm_events',   JSON.stringify(events));
  localStorage.setItem('crm_speakers', JSON.stringify(speakers));
}
function load() {
  try { events   = JSON.parse(localStorage.getItem('crm_events'))   || []; } catch { events = []; }
  try { speakers = JSON.parse(localStorage.getItem('crm_speakers')) || []; } catch { speakers = []; }
}

// ── ID Generators ──────────────────────────────────────────────
function nextEvtId() {
  const nums = events.map(e => parseInt(e.id?.replace('EVT','') || 0));
  const max  = nums.length ? Math.max(...nums) : 0;
  return 'EVT' + String(max + 1).padStart(4,'0');
}
function nextSpkId() {
  const nums = speakers.map(s => parseInt(s.id?.replace('SPK','') || 0));
  const max  = nums.length ? Math.max(...nums) : 0;
  return 'SPK' + String(max + 1).padStart(3,'0');
}

// ── Status Engine ──────────────────────────────────────────────
function computeStatus(ev) {
  if (ev.canceled) return 'Canceled';
  if (ev.scheduledDate) {
    return new Date(ev.scheduledDate) <= today() ? 'Concluded' : 'Scheduled';
  }
  if (!ev.requestedDate) return 'Registered';
  // pick reference date: last f-up if available, else requested
  const ref = ev.fupDate ? new Date(ev.fupDate) : new Date(ev.requestedDate);
  const diff = daysDiff(ref, today());
  return diff > SLA_DAYS ? 'F-UP Needed' : 'Requested';
}

function computeSLA(ev) {
  if (!ev.requestedDate) return null;
  if (['Concluded','Canceled','Scheduled'].includes(computeStatus(ev))) return null;
  return daysDiff(new Date(ev.requestedDate), today());
}

function today() {
  const d = new Date(); d.setHours(0,0,0,0); return d;
}
function daysDiff(a, b) {
  return Math.floor((b - a) / 86400000);
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
function isoToday() {
  return today().toISOString().slice(0,10);
}

// ── Navigation ─────────────────────────────────────────────────
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  document.getElementById('pageTitle').textContent =
    { dashboard:'Dashboard', events:'Events', speakers:'Speakers', email:'Send Email' }[view];
  const btn = document.getElementById('topbarAction');
  if (view === 'events')        { btn.textContent = '+ New Event';   btn.onclick = openNewEventModal; btn.style.display=''; }
  else if (view === 'speakers') { btn.textContent = '+ New Speaker'; btn.onclick = openNewSpeakerModal; btn.style.display=''; }
  else btn.style.display = 'none';
  if (view === 'dashboard') renderDashboard();
  if (view === 'events')    renderEvents();
  if (view === 'speakers')  renderSpeakers();
  if (view === 'email')     renderEmailView();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const mn = document.getElementById('main');
  if (window.innerWidth <= 640) {
    sb.classList.toggle('mobile-open');
  } else {
    sb.classList.toggle('collapsed');
    mn.classList.toggle('expanded');
  }
}

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard() {
  // KPIs
  const counts = {};
  STATUSES.forEach(s => counts[s] = 0);
  events.forEach(e => counts[computeStatus(e)]++);

  const statusColors = {
    'Registered':'#2e7d32','Requested':'#1565c0','F-UP Needed':'#e65100',
    'Scheduled':'#6a1b9a','Concluded':'#455a64','Canceled':'#b71c1c'
  };

  const kpiGrid = document.getElementById('kpiGrid');
  kpiGrid.innerHTML = '';

  // Total
  const totalCard = document.createElement('div');
  totalCard.className = 'kpi-card';
  totalCard.style.setProperty('--accent', '#0f1e35');
  totalCard.innerHTML = `<div class="kpi-label">Total Events</div><div class="kpi-value">${events.length}</div><div class="kpi-sub">all time</div>`;
  totalCard.onclick = () => { switchView('events'); setFilter('All'); };
  kpiGrid.appendChild(totalCard);

  STATUSES.forEach(s => {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.style.setProperty('--accent', statusColors[s]);
    card.innerHTML = `<div class="kpi-label">${s}</div><div class="kpi-value">${counts[s]}</div>`;
    card.onclick = () => { switchView('events'); setFilter(s); };
    kpiGrid.appendChild(card);
  });

  // Bar chart
  const total = events.length || 1;
  const chartEl = document.getElementById('chartStatus');
  chartEl.innerHTML = STATUSES.map(s => `
    <div class="chart-bar-row">
      <div class="chart-label">${s}</div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width:${(counts[s]/total*100).toFixed(1)}%;background:${statusColors[s]}"></div>
      </div>
      <div class="chart-count">${counts[s]}</div>
    </div>`).join('');

  // Attention list
  const urgent = events.filter(e => computeStatus(e) === 'F-UP Needed');
  document.getElementById('urgentCount').textContent = urgent.length;
  const attEl = document.getElementById('attentionList');
  if (!urgent.length) {
    attEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">No events need attention 🎉</div>';
  } else {
    attEl.innerHTML = urgent.map(e => {
      const sla = computeSLA(e);
      return `<div class="attention-item" onclick="editEvent('${e.id}')">
        <div class="attention-dot" style="background:#e65100"></div>
        <div>
          <div class="attention-name">${e.name}</div>
          <div class="attention-meta">${e.id} · SLA: ${sla} days · ${e.speaker || '—'}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Recent activity (last 8 events by registration)
  const recent = [...events].sort((a,b) => (b.registeredDate||'').localeCompare(a.registeredDate||'')).slice(0,8);
  const actEl = document.getElementById('activityList');
  actEl.innerHTML = recent.length ? recent.map(e => `
    <div class="activity-item" onclick="editEvent('${e.id}')" style="cursor:pointer">
      <div class="activity-id">${e.id}</div>
      <div class="activity-name">${e.name}</div>
      <span class="status-pill st-${computeStatus(e).replace(/ /g,'_').replace('-','_')}">${computeStatus(e)}</span>
      <div class="activity-date">${fmtDate(e.registeredDate)}</div>
    </div>`).join('')
    : '<div style="color:var(--muted);font-size:13px;padding:16px 0">No events registered yet.</div>';
}

// ── Events View ────────────────────────────────────────────────
function renderFilterChips() {
  const el = document.getElementById('filterChips');
  el.innerHTML = ['All', ...STATUSES].map(s => `
    <button class="filter-chip${activeFilter===s?' active':''}" data-s="${s}" onclick="setFilter('${s}')">${s}</button>
  `).join('');
}

function setFilter(s) {
  activeFilter = s;
  renderFilterChips();
  renderEvents();
}

function renderEvents() {
  renderFilterChips();
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  let filtered = events.filter(e => {
    const st = computeStatus(e);
    if (activeFilter !== 'All' && st !== activeFilter) return false;
    if (q && !e.name.toLowerCase().includes(q) && !(e.speaker||'').toLowerCase().includes(q)) return false;
    return true;
  });

  const tbody = document.getElementById('eventsBody');
  const empty = document.getElementById('emptyEvents');

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = filtered.map(e => {
    const st  = computeStatus(e);
    const sla = computeSLA(e);
    const stClass = 'st-' + st.replace(/ /g,'_').replace(/-/g,'_');
    const slaHtml = sla === null ? '<span class="sla-chip">—</span>'
      : sla > SLA_DAYS ? `<span class="sla-chip sla-warn">⚠ ${sla}d</span>`
      : `<span class="sla-chip sla-ok">${sla}d</span>`;
    return `<tr class="${st==='Canceled'?'row-canceled':''}">
      <td><span class="evt-id">${e.id}</span></td>
      <td><span class="evt-name">${e.name}</span></td>
      <td>${e.speaker||'—'}</td>
      <td>${e.sector||'—'}</td>
      <td><span class="status-pill ${stClass}">${st}</span></td>
      <td>${fmtDate(e.registeredDate)}</td>
      <td>${fmtDate(e.requestedDate)}</td>
      <td>${fmtDate(e.fupDate)}</td>
      <td>${fmtDate(e.scheduledDate)}</td>
      <td>${slaHtml}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.obs||''}">${e.obs||'—'}</td>
      <td>
        <div class="row-actions">
          <button class="btn-icon" onclick="editEvent('${e.id}')" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon del" onclick="deleteEvent('${e.id}')" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Event Modal ────────────────────────────────────────────────
function openNewEventModal() {
  editingEventId = null;
  document.getElementById('modalTitle').textContent = 'New Event';
  document.getElementById('eventId').value = '';
  document.getElementById('eventName').value = '';
  document.getElementById('eventSpeaker').value = '';
  document.getElementById('eventSector').value = '';
  document.getElementById('eventRequestedDate').value = '';
  document.getElementById('eventFupDate').value = '';
  document.getElementById('eventScheduledDate').value = '';
  document.getElementById('eventObs').value = '';
  document.getElementById('eventCanceled').checked = false;
  populateSpeakerDatalist();
  openModal('eventModal');
}

function editEvent(id) {
  const e = events.find(ev => ev.id === id);
  if (!e) return;
  editingEventId = id;
  document.getElementById('modalTitle').textContent = 'Edit Event';
  document.getElementById('eventId').value = e.id;
  document.getElementById('eventName').value = e.name;
  document.getElementById('eventSpeaker').value = e.speaker || '';
  document.getElementById('eventSector').value = e.sector || '';
  document.getElementById('eventRequestedDate').value = e.requestedDate || '';
  document.getElementById('eventFupDate').value = e.fupDate || '';
  document.getElementById('eventScheduledDate').value = e.scheduledDate || '';
  document.getElementById('eventObs').value = e.obs || '';
  document.getElementById('eventCanceled').checked = !!e.canceled;
  populateSpeakerDatalist();
  openModal('eventModal');
}

function saveEvent() {
  const name = document.getElementById('eventName').value.trim();
  if (!name) { toast('Event name is required.', 'error'); return; }

  if (editingEventId) {
    const idx = events.findIndex(e => e.id === editingEventId);
    events[idx] = {
      ...events[idx],
      name,
      speaker:       document.getElementById('eventSpeaker').value.trim(),
      sector:        document.getElementById('eventSector').value,
      requestedDate: document.getElementById('eventRequestedDate').value || null,
      fupDate:       document.getElementById('eventFupDate').value || null,
      scheduledDate: document.getElementById('eventScheduledDate').value || null,
      obs:           document.getElementById('eventObs').value.trim(),
      canceled:      document.getElementById('eventCanceled').checked,
    };
    toast('Event updated.', 'success');
  } else {
    events.push({
      id:            nextEvtId(),
      name,
      speaker:       document.getElementById('eventSpeaker').value.trim(),
      sector:        document.getElementById('eventSector').value,
      registeredDate: isoToday(),
      requestedDate: document.getElementById('eventRequestedDate').value || null,
      fupDate:       document.getElementById('eventFupDate').value || null,
      scheduledDate: document.getElementById('eventScheduledDate').value || null,
      obs:           document.getElementById('eventObs').value.trim(),
      canceled:      document.getElementById('eventCanceled').checked,
    });
    toast('Event created.', 'success');
  }
  save(); closeModal('eventModal'); renderEvents(); renderDashboard();
}

function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  events = events.filter(e => e.id !== id);
  save(); renderEvents(); renderDashboard();
  toast('Event deleted.', 'success');
}

// ── Speakers ───────────────────────────────────────────────────
function renderSpeakers() {
  const q = (document.getElementById('searchSpeakers')?.value || '').toLowerCase();
  const filtered = speakers.filter(s =>
    !q || s.name.toLowerCase().includes(q) || (s.company||'').toLowerCase().includes(q)
  );
  const grid  = document.getElementById('speakersGrid');
  const empty = document.getElementById('emptySpeakers');
  if (!filtered.length) { grid.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = filtered.map(s => `
    <div class="speaker-card">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="speaker-avatar">${s.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
        <div>
          <div class="speaker-name">${s.name}</div>
          <div class="speaker-meta">${s.id}</div>
        </div>
      </div>
      <div class="speaker-meta">${[s.company, s.sector, s.email].filter(Boolean).join(' · ') || '—'}</div>
      <div class="speaker-actions">
        <button class="btn-ghost" style="font-size:12px;padding:5px 10px" onclick="editSpeaker('${s.id}')">Edit</button>
        <button class="btn-icon del" onclick="deleteSpeaker('${s.id}')">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`).join('');
}

function openNewSpeakerModal() {
  editingSpeakerId = null;
  document.getElementById('speakerModalTitle').textContent = 'New Speaker';
  ['speakerId','speakerName','speakerCompany','speakerEmail'].forEach(id => document.getElementById(id).value='');
  document.getElementById('speakerSector').value='';
  openModal('speakerModal');
}

function editSpeaker(id) {
  const s = speakers.find(sp => sp.id === id);
  if (!s) return;
  editingSpeakerId = id;
  document.getElementById('speakerModalTitle').textContent = 'Edit Speaker';
  document.getElementById('speakerId').value    = s.id;
  document.getElementById('speakerName').value  = s.name;
  document.getElementById('speakerCompany').value = s.company || '';
  document.getElementById('speakerSector').value  = s.sector  || '';
  document.getElementById('speakerEmail').value   = s.email   || '';
  openModal('speakerModal');
}

function saveSpeaker() {
  const name = document.getElementById('speakerName').value.trim();
  if (!name) { toast('Name is required.', 'error'); return; }
  if (editingSpeakerId) {
    const idx = speakers.findIndex(s => s.id === editingSpeakerId);
    speakers[idx] = { ...speakers[idx], name,
      company: document.getElementById('speakerCompany').value.trim(),
      sector:  document.getElementById('speakerSector').value,
      email:   document.getElementById('speakerEmail').value.trim(),
    };
    toast('Speaker updated.', 'success');
  } else {
    speakers.push({ id: nextSpkId(), name,
      company: document.getElementById('speakerCompany').value.trim(),
      sector:  document.getElementById('speakerSector').value,
      email:   document.getElementById('speakerEmail').value.trim(),
    });
    toast('Speaker created.', 'success');
  }
  save(); closeModal('speakerModal'); renderSpeakers();
}

function deleteSpeaker(id) {
  if (!confirm('Delete this speaker?')) return;
  speakers = speakers.filter(s => s.id !== id);
  save(); renderSpeakers();
  toast('Speaker deleted.', 'success');
}

function populateSpeakerDatalist() {
  document.getElementById('speakersList').innerHTML =
    speakers.map(s => `<option value="${s.name}">`).join('');
}

// ── Email View ─────────────────────────────────────────────────
function renderEmailView() {
  const saved = localStorage.getItem('crm_caEmail') || '';
  document.getElementById('caEmail').value = saved;
  const filt = document.getElementById('emailStatusFilter');
  filt.innerHTML = STATUSES.map(s => `
    <label class="checkbox-label">
      <input type="checkbox" name="emailStatus" value="${s}" ${['Requested','F-UP Needed'].includes(s)?'checked':''}>
      <span>${s}</span>
    </label>`).join('');
}

function generateEmail() {
  const caEmail = document.getElementById('caEmail').value.trim();
  localStorage.setItem('crm_caEmail', caEmail);

  const selected = [...document.querySelectorAll('input[name=emailStatus]:checked')].map(c=>c.value);
  if (!selected.length) { toast('Select at least one status.','error'); return; }

  const doResetFUP = document.getElementById('resetFUP').checked;
  const doResetReg = document.getElementById('resetRegistered').checked;

  const matched = events.filter(e => selected.includes(computeStatus(e)));
  if (!matched.length) { toast('No events match selected statuses.','error'); return; }

  const today = isoToday();

  // Reset statuses
  if (doResetFUP || doResetReg) {
    events.forEach(e => {
      const st = computeStatus(e);
      if (doResetFUP && st === 'F-UP Needed') { e.fupDate = today; }
      if (doResetReg && st === 'Registered')  { e.requestedDate = today; }
    });
    save();
    toast(`Statuses updated for ${doResetFUP?'F-UP Needed ':''}${doResetReg?'+ Registered':''}`, 'success');
  }

  const todayFmt = fmtDate(today);
  const rows = matched.map(e => {
    const st  = computeStatus(e);
    const sla = e.requestedDate ? daysDiff(new Date(e.requestedDate), new Date(today+' 00:00')) : null;
    const slaTxt = sla !== null ? `${sla} days` : '—';
    const rowBg = {'F-UP Needed':'#FFF3E0','Requested':'#E3F2FD','Registered':'#E8F5E9'}[st] || '#f5f7fa';
    return `<tr style="background:${rowBg}">
      <td style="padding:8px 12px;border:1px solid #ddd"><b>${e.id}</b></td>
      <td style="padding:8px 12px;border:1px solid #ddd">${e.name}</td>
      <td style="padding:8px 12px;border:1px solid #ddd">${e.speaker||'—'}</td>
      <td style="padding:8px 12px;border:1px solid #ddd"><b>${st}</b></td>
      <td style="padding:8px 12px;border:1px solid #ddd">${slaTxt}</td>
    </tr>`;
  }).join('');

  const html = `<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#1a2b4a">
<p>Dear Corporate Access Team,</p>
<p>Please find below the pending events requiring your attention as of <b>${todayFmt}</b>:</p>
<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;min-width:600px;border-color:#ddd">
<tr style="background:#1a2b4a;color:#fff;font-weight:bold">
  <td style="padding:9px 12px;border:1px solid #ddd">Event ID</td>
  <td style="padding:9px 12px;border:1px solid #ddd">Event Name</td>
  <td style="padding:9px 12px;border:1px solid #ddd">Speaker</td>
  <td style="padding:9px 12px;border:1px solid #ddd">Status</td>
  <td style="padding:9px 12px;border:1px solid #ddd">SLA Since Request</td>
</tr>
${rows}
</table>
<p>Please confirm availability and coordinate scheduling at your earliest convenience.</p>
<p>Thank you,<br><i>Equity Research — Event Tracker</i></p>
</body></html>`;

  const preview = document.getElementById('emailPreview');
  preview.innerHTML = `
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
      <span style="font-size:12px;color:var(--muted)">To: <b>${caEmail||'(no email set)'}</b></span>
      <span style="font-size:12px;color:var(--muted)">· ${matched.length} event(s)</span>
      <button class="btn-primary" style="margin-left:auto;font-size:12px;padding:6px 14px"
        onclick="openOutlookEmail()">Open in Outlook (mailto)</button>
    </div>
    <iframe id="emailIframe" style="width:100%;height:480px;border:1px solid var(--border);border-radius:6px"></iframe>`;

  // Write HTML to iframe
  const iframe = document.getElementById('emailIframe');
  iframe.onload = () => {
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
  };
  iframe.src = 'about:blank';
  setTimeout(() => {
    try {
      iframe.contentDocument.open();
      iframe.contentDocument.write(html);
      iframe.contentDocument.close();
    } catch(e) {}
  }, 100);

  // Store for copy
  window._lastEmailHTML = html;
  window._lastEmailTo   = caEmail;

  toast(`Email preview ready — ${matched.length} event(s)`, 'success');
}

function copyEmailHTML() {
  if (!window._lastEmailHTML) { toast('Generate a preview first.','error'); return; }
  navigator.clipboard.writeText(window._lastEmailHTML)
    .then(() => toast('HTML copied to clipboard.','success'))
    .catch(() => toast('Copy failed — try manually.','error'));
}

function openOutlookEmail() {
  if (!window._lastEmailHTML) { toast('Generate a preview first.','error'); return; }
  const subject = encodeURIComponent('[Equity Research] Corporate Access Update — ' + fmtDate(isoToday()));
  const body    = encodeURIComponent('Please see the HTML email body copied to your clipboard.\n\n(Paste the HTML version into Outlook for rich formatting.)');
  navigator.clipboard.writeText(window._lastEmailHTML).catch(()=>{});
  window.location.href = `mailto:${window._lastEmailTo||''}?subject=${subject}&body=${body}`;
}

// ── Import / Export ────────────────────────────────────────────
function exportData() {
  const data = { events, speakers, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `event-tracker-${isoToday()}.json`;
  a.click();
  toast('Data exported.', 'success');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.events)   events   = data.events;
        if (data.speakers) speakers = data.speakers;
        save();
        renderDashboard();
        toast(`Imported ${events.length} events, ${speakers.length} speakers.`, 'success');
      } catch { toast('Invalid JSON file.', 'error'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Modal Helpers ──────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ── Toast ──────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3000);
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  load();

  // Today badge
  document.getElementById('todayBadge').textContent =
    new Date().toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });

  // Nav links
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchView(item.dataset.view);
    });
  });

  // Hide topbar button initially on non-events views
  document.getElementById('topbarAction').style.display = 'none';

  renderDashboard();
  switchView('dashboard');
});
