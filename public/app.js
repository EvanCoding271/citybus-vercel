/* =======================================================
   CityBus — Frontend JavaScript
   Talks to FastAPI on Vercel (/api/*)
   ======================================================= */

// On Vercel, API lives on the same origin. Locally, point to localhost:8000
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000'
  : '';

/* ── HTTP helper ───────────────────────────────────────── */
async function api(method, path, body = null, useAuth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (useAuth) {
    const t = localStorage.getItem('cb_token');
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(API_BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

/* ── App state ─────────────────────────────────────────── */
const App = {
  theme: localStorage.getItem('cbTheme') || 'dark',
  currentUser: null,
  booking: {},        // in-progress booking (client-side flow)
  schedules: [],      // cached for booking page
  routes: [],         // cached for selects
};

/* =======================================================  THEME  */
function applyTheme(t) {
  App.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('cbTheme', t);
  document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = t === 'dark' ? '☀️' : '🌙');
}
function toggleTheme() { applyTheme(App.theme === 'dark' ? 'light' : 'dark'); }
applyTheme(App.theme);

/* =======================================================  NAVIGATION  */
function goto(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + pageId);
  if (el) { el.classList.add('active'); window.scrollTo(0, 0); }
  const init = {
    'booking':            initBookingPage,
    'payment':            initPaymentPage,
    'confirmation':       initConfirmationPage,
    'history':            loadHistory,
    'user-dashboard':     refreshDashboard,
    'admin-users':        loadUsersTable,
    'admin-routes':       loadRoutesTable,
    'admin-schedules':    loadSchedulesTable,
    'admin-reports':      loadReports,
    'admin-dashboard':    () => setTimeout(initAdminCharts, 80),
    'finance-dashboard':  () => { loadFinanceStats(); setTimeout(initFinanceCharts, 80); },
  };
  if (init[pageId]) init[pageId]();
}

/* =======================================================  TOAST  */
function showToast(msg, type = 'info', dur = 3400) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toastWrap').appendChild(t);
  setTimeout(() => t.remove(), dur);
}

/* =======================================================  MODAL  */
function showModal(title, body, footer = '') {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML   = body;
  document.getElementById('modalFooter').innerHTML = footer;
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

/* =======================================================  AUTH  */
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  if (!email || !pass) { showToast('Please fill all fields', 'error'); return; }
  setBtnLoading('#page-user-login .btn-primary', true);
  try {
    const d = await api('POST', '/api/auth/login', { email, password: pass }, false);
    localStorage.setItem('cb_token', d.access_token);
    App.currentUser = d.user;
    populateUserUI(d.user);
    showToast(`Welcome back, ${firstName(d.user.full_name)}! 👋`, 'success');
    goto('user-dashboard');
  } catch (e) { showToast(e.message, 'error'); }
  finally { setBtnLoading('#page-user-login .btn-primary', false); }
}

async function doRegister() {
  const full_name = document.getElementById('regName').value.trim();
  const email     = document.getElementById('regEmail').value.trim();
  const phone     = document.getElementById('regPhone').value.trim();
  const password  = document.getElementById('regPassword').value;
  if (!full_name || !email || !phone || !password) { showToast('Please fill all fields', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
  setBtnLoading('#page-register .btn-primary', true);
  try {
    const d = await api('POST', '/api/auth/register', { full_name, email, phone, password }, false);
    localStorage.setItem('cb_token', d.access_token);
    App.currentUser = d.user;
    populateUserUI(d.user);
    showToast(`Account created! Welcome, ${firstName(d.user.full_name)}! 🎉`, 'success');
    goto('user-dashboard');
  } catch (e) { showToast(e.message, 'error'); }
  finally { setBtnLoading('#page-register .btn-primary', false); }
}

async function doEmpLogin() {
  const email    = document.getElementById('empEmail').value.trim();
  const password = document.getElementById('empPassword').value;
  if (!email || !password) { showToast('Please fill all fields', 'error'); return; }
  setBtnLoading('#page-employee-login .btn-accent', true);
  try {
    const d = await api('POST', '/api/auth/employee/login', { email, password }, false);
    localStorage.setItem('cb_token', d.access_token);
    App.currentUser = d.user;
    showToast('Welcome to the employee portal!', 'success');
    const r = d.user.role;
    if (r === 'admin')   goto('admin-dashboard');
    else if (r === 'finance')  goto('finance-dashboard');
    else                       goto('operator-dashboard');
  } catch (e) { showToast(e.message, 'error'); }
  finally { setBtnLoading('#page-employee-login .btn-accent', false); }
}

function doLogout() {
  localStorage.removeItem('cb_token');
  App.currentUser = null;
  showToast('You have been logged out.', 'info');
  goto('landing');
}

function populateUserUI(user) {
  const name = user.full_name || user.name || '';
  setTxt('dashUserName',    firstName(name));
  setTxt('dashProfileName', name);
  setTxt('dashProfileEmail', user.email);
  setVal('profName',  name);
  setVal('profEmail', user.email);
  setVal('profPhone', user.phone || '');
}

/* =======================================================  BOOKING PAGE  */
let seatSelection = new Set();
let passengerCount = 1;

async function initBookingPage() {
  const today = new Date().toISOString().split('T')[0];
  setVal('tripDate', today);
  if (App.currentUser) setVal('passengerName', App.currentUser.full_name || App.currentUser.name || '');
  seatSelection.clear();
  setTxt('selectedCount', '0');
  document.getElementById('selectedSeatInfo').style.display = 'none';
  passengerCount = 1;
  document.getElementById('extraPassengers').innerHTML = '';

  // Load schedules and build select
  try {
    App.schedules = await api('GET', '/api/schedules');
    buildScheduleSelect();
  } catch (e) {
    showToast('Could not load schedules: ' + e.message, 'error');
  }
}

function buildScheduleSelect() {
  const sel = document.getElementById('routeSelect');
  sel.innerHTML = '';
  App.schedules.forEach(s => {
    const dep  = new Date(s.departure_time).toLocaleString('en-PH', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const opt  = document.createElement('option');
    opt.value  = s.id;
    opt.dataset.from  = s.origin;
    opt.dataset.to    = s.destination;
    opt.dataset.price = s.base_fare;
    opt.dataset.dep   = dep;
    opt.textContent   = `${s.route} — ${s.origin} → ${s.destination}  ·  ${dep}  (₱${s.base_fare})`;
    sel.appendChild(opt);
  });
  updateRouteInfo();
  loadSeatMap();
}

async function loadSeatMap() {
  const sel = document.getElementById('routeSelect');
  if (!sel || !sel.value) return;
  const scheduleId = parseInt(sel.value);
  try {
    const data = await api('GET', `/api/seats?schedule_id=${scheduleId}`);
    renderSeatMap(data.booked || []);
  } catch (e) {
    renderSeatMap([]);
  }
}

function renderSeatMap(booked = []) {
  const map = document.getElementById('seatMap');
  map.innerHTML = '';
  const rows = ['A','B','C','D','E'];
  for (const row of rows) {
    for (let col = 1; col <= 5; col++) {
      const id  = row + col;
      const btn = document.createElement('button');
      btn.type  = 'button';
      btn.title = 'Seat ' + id;
      const isBooked   = booked.includes(id);
      const isSelected = seatSelection.has(id);
      btn.className = 'seat ' + (isBooked ? 'booked' : isSelected ? 'selected' : 'available');
      btn.innerHTML = `<span style="font-size:.75rem;font-weight:700;">${id}</span>`;
      if (!isBooked) btn.onclick = () => toggleSeat(id, btn);
      map.appendChild(btn);
    }
  }
}

function toggleSeat(id, btn) {
  if (seatSelection.has(id)) {
    seatSelection.delete(id); btn.classList.replace('selected', 'available');
  } else {
    if (seatSelection.size >= passengerCount) { showToast('Max seats selected', 'info'); return; }
    seatSelection.add(id); btn.classList.replace('available', 'selected');
  }
  setTxt('selectedCount', seatSelection.size);
  const sel = [...seatSelection];
  document.getElementById('selectedSeatInfo').style.display = sel.length ? 'block' : 'none';
  if (sel.length) setTxt('selectedSeatLabel', sel.join(', '));
}

function addPassenger() {
  passengerCount++;
  const div = document.createElement('div');
  div.className = 'form-group';
  div.innerHTML = `<label class="form-label">Passenger ${passengerCount}</label>
    <input class="form-input" type="text" placeholder="Passenger ${passengerCount} name"/>`;
  document.getElementById('extraPassengers').appendChild(div);
}

function updateRouteInfo() {
  const sel = document.getElementById('routeSelect');
  if (!sel || !sel.options.length) return;
  const opt = sel.options[sel.selectedIndex];
  setTxt('tripFrom',  opt.dataset.from  || '—');
  setTxt('tripTo',    opt.dataset.to    || '—');
  setTxt('tripPrice', '₱' + (opt.dataset.price || '0'));
  setTxt('tripTime2', opt.dataset.dep   || '');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('routeSelect')?.addEventListener('change', () => { updateRouteInfo(); loadSeatMap(); });
});

function proceedToPayment() {
  const sel  = document.getElementById('routeSelect');
  if (!sel || !sel.options.length) { showToast('No schedules loaded', 'error'); return; }
  const opt  = sel.options[sel.selectedIndex];
  const pass = document.getElementById('passengerName').value.trim();
  const seat = [...seatSelection][0];
  if (!pass) { showToast('Please enter passenger name', 'error'); return; }
  if (!seat) { showToast('Please select a seat', 'error'); return; }
  App.booking = {
    schedule_id: parseInt(sel.value),
    route:  `${opt.dataset.from} → ${opt.dataset.to}`,
    price:  opt.dataset.price,
    dep:    opt.dataset.dep,
    passenger: pass,
    seats: [...seatSelection],
  };
  goto('payment');
}

/* =======================================================  PAYMENT PAGE  */
function initPaymentPage() {
  const b = App.booking;
  setTxt('payRoute',     b.route     || '—');
  setTxt('payDate',      b.dep       || '—');
  setTxt('payTime',      b.dep       || '—');
  setTxt('paySeat',      (b.seats || []).join(', ') || '—');
  setTxt('payPassenger', b.passenger || '—');
  setTxt('payTotal',     '₱' + (b.price || '0'));
}

function selectPM(btn, method) {
  document.querySelectorAll('.pm-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('cardForm').style.display  = method === 'card'  ? 'block' : 'none';
  document.getElementById('gcashForm').style.display = method === 'gcash' ? 'block' : 'none';
  document.getElementById('mayaForm').style.display  = method === 'maya'  ? 'block' : 'none';
}

function formatCard(input) {
  input.value = input.value.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();
}

async function doPayment() {
  const btn    = document.querySelector('#page-payment .btn-success');
  const pmText = (document.querySelector('.pm-btn.selected')?.textContent || 'Card').trim().replace(/^[^\w]*/,'');
  btn.innerHTML = '<span class="spinner"></span> Processing…';
  btn.disabled  = true;
  try {
    const result = await api('POST', '/api/bookings', {
      schedule_id:    App.booking.schedule_id,
      seat_labels:    App.booking.seats,
      passenger_name: App.booking.passenger,
      payment_method: pmText,
    });
    App.booking.qr_code    = result.qr_code;
    App.booking.booking_id = result.booking_id;
    App.booking.total      = result.total_amount;
    showToast('Payment successful! 🎉', 'success');
    goto('confirmation');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.innerHTML = '🔒 Pay Now';
    btn.disabled  = false;
  }
}

/* =======================================================  CONFIRMATION / QR  */
function initConfirmationPage() {
  const b = App.booking;
  setTxt('confTicketNum', b.qr_code    || '—');
  setTxt('confRoute',     b.route      || '—');
  setTxt('confDate',      b.dep        || '—');
  setTxt('confTime',      b.dep        || '—');
  setTxt('confPassenger', b.passenger  || '—');
  setTxt('confSeat',      (b.seats||[]).join(', ') || '—');
  setTxt('confAmount',    '₱' + (b.total || b.price || '0'));

  const qrDiv = document.getElementById('qrCode');
  qrDiv.innerHTML = '';

  // QR code data — use just the ticket number as text for cleaner QR
  const qrText = b.qr_code
    ? `CB-TICKET:${b.qr_code}|ROUTE:${b.route}|SEATS:${(b.seats||[]).join(',')}|PAX:${b.passenger}`
    : 'CB-TICKET:DEMO|ROUTE:Manila→Makati|SEATS:B3|PAX:Passenger';

  try {
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrDiv, {
        text: qrText,
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      // Fallback: generate QR via Google Charts API
      const encoded = encodeURIComponent(qrText);
      qrDiv.innerHTML = `<img src="https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encoded}&choe=UTF-8"
        width="200" height="200" style="border-radius:8px;" alt="QR Code"/>`;
    }
  } catch (err) {
    // Final fallback: show the ticket code in a styled box
    qrDiv.innerHTML = `<div style="width:200px;height:200px;background:#f5f5f5;display:flex;flex-direction:column;
      align-items:center;justify-content:center;border-radius:12px;padding:16px;text-align:center;">
      <div style="font-size:2rem;margin-bottom:8px;">🎫</div>
      <div style="font-size:.75rem;color:#333;word-break:break-all;font-family:monospace;">${b.qr_code || 'CB-DEMO'}</div>
    </div>`;
  }
}

/* =======================================================  CHARTS  */
let _adminBarChart = null;
let _adminLineChart = null;
let _finRouteChart = null;
let _finPaymentChart = null;

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    text: isDark ? '#B0BBCF' : '#3A4560',
    grid: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)',
    bar:  '#1B3ED4',
    line: '#1B3ED4',
  };
}

function initAdminCharts() {
  const c = getChartColors();
  const barCtx = document.getElementById('adminBarChart');
  if (!barCtx) return;
  if (_adminBarChart) { _adminBarChart.destroy(); }
  _adminBarChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
      datasets:[{ data:[120,150,180,160,200,90,75], backgroundColor: c.bar, borderRadius:5, borderSkipped:false }]
    },
    options: {
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ grid:{ color:c.grid }, ticks:{ color:c.text } },
        y:{ grid:{ color:c.grid }, ticks:{ color:c.text }, beginAtZero:true, max:220 }
      }
    }
  });

  const lineCtx = document.getElementById('adminLineChart');
  if (!lineCtx) return;
  if (_adminLineChart) { _adminLineChart.destroy(); }
  _adminLineChart = new Chart(lineCtx, {
    type: 'line',
    data: {
      labels: ['Jan','Feb','Mar','Apr','May'],
      datasets:[{
        data:[120000,130000,142000,162000,158000],
        borderColor: c.line,
        backgroundColor: 'rgba(27,62,212,0.08)',
        pointBackgroundColor: c.line,
        tension:0.4, fill:true, pointRadius:5
      }]
    },
    options: {
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ grid:{ color:c.grid }, ticks:{ color:c.text } },
        y:{ grid:{ color:c.grid }, ticks:{ color:c.text, callback: v => '₱'+Math.round(v/1000)+'K' }, beginAtZero:true }
      }
    }
  });
}

function initFinanceCharts() {
  const c = getChartColors();
  const routeCtx = document.getElementById('finRouteChart');
  if (!routeCtx) return;
  if (_finRouteChart) { _finRouteChart.destroy(); }
  _finRouteChart = new Chart(routeCtx, {
    type: 'bar',
    data: {
      labels: ['Route 1','Route 2','Route 3','Route 4','Route 5'],
      datasets:[{ data:[130000,107000,95000,82000,72000], backgroundColor: c.bar, borderRadius:5, borderSkipped:false }]
    },
    options: {
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ grid:{ color:c.grid }, ticks:{ color:c.text } },
        y:{ grid:{ color:c.grid }, ticks:{ color:c.text, callback: v => '₱'+Math.round(v/1000)+'K' }, beginAtZero:true }
      }
    }
  });

  const payCtx = document.getElementById('finPaymentChart');
  if (!payCtx) return;
  if (_finPaymentChart) { _finPaymentChart.destroy(); }
  _finPaymentChart = new Chart(payCtx, {
    type: 'pie',
    data: {
      labels: ['Credit/Debit Card: 45%','Maya: 20%','GCash: 35%'],
      datasets:[{
        data:[45,35,20],
        backgroundColor:['#1B3ED4','#E04444','#F5A623'],
        borderWidth: 2,
        borderColor: c.grid,
      }]
    },
    options: {
      plugins:{
        legend:{ position:'right', labels:{ color:c.text, font:{ size:11 }, padding:14 } }
      }
    }
  });
}

/* =======================================================  OPERATOR MODALS  */
function showAddBusModal() {
  showModal('Add New Bus', `
    <div class="form-group"><label class="form-label">Bus Number</label><input class="form-input" id="newBusNum" placeholder="e.g. Bus #6"/></div>
    <div class="form-group"><label class="form-label">Route</label><input class="form-input" id="newBusRoute" placeholder="e.g. Route 3: Pasay → Ortigas"/></div>
    <div class="form-group"><label class="form-label">Driver Name</label><input class="form-input" id="newBusDriver" placeholder="e.g. Maria Santos"/></div>
    <div class="form-group"><label class="form-label">Capacity</label><input class="form-input" id="newBusCap" type="number" value="44"/></div>`,
    `<button class="btn btn-primary" onclick="closeModal();showToast('Bus added successfully!','success')">Add Bus</button>`
  );
}

function showAssignDriverModal() {
  showModal('Assign Driver', `
    <div class="form-group"><label class="form-label">Bus</label>
      <select class="form-input">
        <option>Bus #1</option><option>Bus #2</option><option>Bus #3</option><option>Bus #4</option><option>Bus #5</option>
      </select></div>
    <div class="form-group"><label class="form-label">Driver Name</label><input class="form-input" placeholder="Driver full name"/></div>
    <div class="form-group"><label class="form-label">Shift</label>
      <select class="form-input"><option>Morning (6AM–2PM)</option><option>Afternoon (2PM–10PM)</option><option>Night (10PM–6AM)</option></select></div>`,
    `<button class="btn btn-primary" onclick="closeModal();showToast('Driver assigned!','success')">Assign</button>`
  );
}

function showEmergencyAlert() {
  showModal('🚨 Emergency Alert', `
    <div class="form-group"><label class="form-label">Alert Type</label>
      <select class="form-input"><option>Breakdown</option><option>Accident</option><option>Medical Emergency</option><option>Security Threat</option></select></div>
    <div class="form-group"><label class="form-label">Bus / Location</label><input class="form-input" placeholder="Bus #3, EDSA near Ortigas"/></div>
    <div class="form-group"><label class="form-label">Details</label><textarea class="form-input" rows="3" placeholder="Describe the situation…"></textarea></div>`,
    `<button class="btn btn-danger" onclick="closeModal();showToast('🚨 Emergency alert dispatched!','error',5000)">Send Alert</button>`
  );
}


/* =======================================================  USER DASHBOARD  */
async function refreshDashboard() {
  if (!App.currentUser) return;
  populateUserUI(App.currentUser);
  try {
    const bookings = await api('GET', '/api/bookings');
    const upcoming  = bookings.filter(b => b.booking_status === 'confirmed');
    const completed = bookings.filter(b => b.booking_status === 'cancelled');
    const spent     = bookings.reduce((a, b) => a + parseFloat(b.total_amount || 0), 0);
    setTxt('statUpcoming',  upcoming.length);
    setTxt('statCompleted', bookings.length - upcoming.length);
    setTxt('statSpent',     '₱' + spent.toFixed(0));
    const listEl = document.getElementById('myBookingsList');
    listEl.innerHTML = upcoming.slice(0, 3).map(b => `
      <div class="list-item">
        <div><strong>${b.origin} → ${b.destination}</strong>
        <small>QR: ${b.qr_code || '—'} · Seats: ${(b.seats||[]).join(', ')}</small></div>
        <span class="badge badge-blue">Confirmed</span>
      </div>`).join('') || '<div class="list-item"><small class="text-muted">No upcoming trips.</small></div>';
  } catch (e) { /* silent */ }
}

/* =======================================================  HISTORY  */
async function loadHistory() {
  const body = document.getElementById('historyBody');
  body.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Loading…</td></tr>`;
  try {
    const rows = await api('GET', '/api/bookings');
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No bookings found.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(h => {
      const dep = h.departure_time ? new Date(h.departure_time).toLocaleDateString('en-PH') : '—';
      const statusBadge = h.booking_status === 'confirmed' ? 'badge-blue' : h.booking_status === 'cancelled' ? 'badge-red' : 'badge-gray';
      return `<tr>
        <td><strong>${h.qr_code || '—'}</strong></td>
        <td>${h.origin || ''} → ${h.destination || ''}</td>
        <td>${(h.seats||[]).join(', ')}</td>
        <td><strong>₱${h.total_amount}</strong></td>
        <td>${dep}</td>
        <td><span class="badge ${statusBadge}">${h.booking_status}</span></td>
      </tr>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="7" class="text-center">${e.message}</td></tr>`;
  }
}

/* =======================================================  PROFILE  */
async function saveProfile() {
  const full_name = document.getElementById('profName').value.trim();
  const phone     = document.getElementById('profPhone').value.trim();
  const password  = document.getElementById('profPassword')?.value || '';
  if (!full_name) { showToast('Name is required', 'error'); return; }
  setBtnLoading('#page-profile .btn-primary', true);
  try {
    const body = { full_name, phone };
    if (password) body.password = password;
    const user = await api('PUT', '/api/profile', body);
    App.currentUser = { ...App.currentUser, ...user };
    populateUserUI(App.currentUser);
    showToast('Profile updated!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
  finally { setBtnLoading('#page-profile .btn-primary', false); }
}

/* =======================================================  ADMIN — USERS  */
async function loadUsersTable(filter = '') {
  const body = document.getElementById('usersTableBody');
  if (!body) return;
  body.innerHTML = `<tr><td colspan="6" class="text-muted text-center">Loading…</td></tr>`;
  try {
    const url   = filter ? `/api/users?q=${encodeURIComponent(filter)}` : '/api/users';
    const users = await api('GET', url);
    body.innerHTML = users.map(u => `
      <tr>
        <td><strong>${u.full_name}</strong></td>
        <td>${u.email}</td>
        <td>${u.phone || '—'}</td>
        <td>${u.role}</td>
        <td><span class="badge badge-green">Active</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="editUserModal(${u.id},'${esc(u.full_name)}','${esc(u.role)}')">Edit</button>
          <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteUser(${u.id})">Del</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="6" class="text-muted text-center">No users found.</td></tr>`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="text-center">${e.message}</td></tr>`;
  }
}
function filterUsers() { loadUsersTable(document.getElementById('userSearch').value); }

function editUserModal(id, name, role) {
  showModal('Edit User', `
    <div class="form-group"><label class="form-label">Full Name</label>
      <input class="form-input" id="editUserName" value="${name}"/></div>
    <div class="form-group"><label class="form-label">Role</label>
      <select class="form-input" id="editUserRole">
        ${['passenger','admin','finance','operator'].map(r =>
          `<option ${r===role?'selected':''}>${r}</option>`).join('')}
      </select></div>`,
    `<button class="btn btn-primary" onclick="saveUser(${id})">Save</button>`
  );
}

async function saveUser(id) {
  try {
    await api('PUT', `/api/users/${id}`, {
      full_name: document.getElementById('editUserName').value,
      role:      document.getElementById('editUserRole').value,
    });
    closeModal(); loadUsersTable(); showToast('User updated', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  try { await api('DELETE', `/api/users/${id}`); loadUsersTable(); showToast('Deleted', 'info'); }
  catch (e) { showToast(e.message, 'error'); }
}

function showAddUserModal() {
  showModal('Add New User', `
    <div class="form-group"><label class="form-label">Full Name</label><input class="form-input" id="newUserName" placeholder="Juan Dela Cruz"/></div>
    <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="newUserEmail" placeholder="email@example.com"/></div>
    <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="newUserPhone" placeholder="09XX XXX XXXX"/></div>
    <div class="form-group"><label class="form-label">Role</label>
      <select class="form-input" id="newUserRole">
        ${['passenger','admin','finance','operator'].map(r => `<option>${r}</option>`).join('')}
      </select></div>
    <div class="form-group"><label class="form-label">Password</label><input class="form-input" id="newUserPass" type="password" placeholder="min 6 chars"/></div>`,
    `<button class="btn btn-primary" onclick="addUser()">Add User</button>`
  );
}

async function addUser() {
  const full_name = document.getElementById('newUserName').value.trim();
  const email     = document.getElementById('newUserEmail').value.trim();
  const phone     = document.getElementById('newUserPhone').value.trim();
  const role      = document.getElementById('newUserRole').value;
  const password  = document.getElementById('newUserPass').value || 'changeme123';
  if (!full_name || !email) { showToast('Name and email required', 'error'); return; }
  try {
    await api('POST', '/api/users', { full_name, email, phone, role, password });
    closeModal(); loadUsersTable(); showToast('User added', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

/* =======================================================  ADMIN — ROUTES  */
async function loadRoutesTable() {
  const body = document.getElementById('routesTableBody');
  if (!body) return;
  try {
    const routes = await api('GET', '/api/routes');
    body.innerHTML = routes.map(r => `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td>${r.origin}</td>
        <td>${r.destination}</td>
        <td>₱${r.base_fare}</td>
        <td><span class="badge ${r.status==='active'?'badge-green':'badge-red'}">${r.status}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="editRouteModal(${r.id},${r.base_fare},'${esc(r.status)}','${esc(r.name)}')">Edit</button>
          <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteRoute(${r.id})">Del</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="text-muted text-center">No routes.</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

function editRouteModal(id, fare, status, name) {
  showModal('Edit Route', `
    <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="editRouteName" value="${name}"/></div>
    <div class="form-group"><label class="form-label">Fare (₱)</label><input class="form-input" id="editRouteFare" type="number" value="${fare}"/></div>
    <div class="form-group"><label class="form-label">Status</label>
      <select class="form-input" id="editRouteStatus">
        ${['active','inactive','maintenance'].map(s => `<option ${s===status?'selected':''}>${s}</option>`).join('')}
      </select></div>`,
    `<button class="btn btn-primary" onclick="saveRoute(${id})">Save</button>`
  );
}
async function saveRoute(id) {
  try {
    await api('PUT', `/api/routes/${id}`, {
      name:      document.getElementById('editRouteName').value,
      base_fare: parseFloat(document.getElementById('editRouteFare').value),
      status:    document.getElementById('editRouteStatus').value,
    });
    closeModal(); loadRoutesTable(); showToast('Route updated', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}
async function deleteRoute(id) {
  if (!confirm('Delete this route?')) return;
  try { await api('DELETE', `/api/routes/${id}`); loadRoutesTable(); showToast('Deleted', 'info'); }
  catch (e) { showToast(e.message, 'error'); }
}

function showAddRouteModal() {
  showModal('Add New Route', `
    <div class="form-group"><label class="form-label">Route Name</label><input class="form-input" id="newRouteName" placeholder="Route 5"/></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Origin</label><input class="form-input" id="newRouteOrigin" placeholder="Manila"/></div>
      <div class="form-group"><label class="form-label">Destination</label><input class="form-input" id="newRouteDest" placeholder="Makati"/></div>
    </div>
    <div class="form-group"><label class="form-label">Fare (₱)</label><input class="form-input" id="newRouteFare" type="number" placeholder="65"/></div>`,
    `<button class="btn btn-primary" onclick="addRoute()">Add Route</button>`
  );
}
async function addRoute() {
  const name = document.getElementById('newRouteName').value.trim();
  const origin = document.getElementById('newRouteOrigin').value.trim();
  const destination = document.getElementById('newRouteDest').value.trim();
  const base_fare = parseFloat(document.getElementById('newRouteFare').value) || 0;
  if (!name || !origin || !destination) { showToast('Fill all fields', 'error'); return; }
  try {
    await api('POST', '/api/routes', { name, origin, destination, base_fare });
    closeModal(); loadRoutesTable(); showToast('Route added', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

/* =======================================================  ADMIN — SCHEDULES  */
async function loadSchedulesTable() {
  const body = document.getElementById('schedulesTableBody');
  if (!body) return;
  try {
    const scheds = await api('GET', '/api/schedules');
    body.innerHTML = scheds.map(s => {
      const dep = new Date(s.departure_time).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'});
      const arr = new Date(s.arrival_time).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'});
      return `<tr>
        <td><strong>${s.bus}</strong></td>
        <td>${s.route} — ${s.origin} → ${s.destination}</td>
        <td>${dep}</td>
        <td>${arr}</td>
        <td><span class="badge ${s.status==='active'?'badge-green':'badge-red'}">${s.status}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="toggleSchedule(${s.id},'${esc(s.status)}')">Toggle</button>
          <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteSchedule(${s.id})">Del</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-muted text-center">No schedules.</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

async function toggleSchedule(id, cur) {
  const next = cur === 'active' ? 'maintenance' : 'active';
  try { await api('PUT', `/api/schedules/${id}`, { status: next }); loadSchedulesTable(); showToast('Updated', 'info'); }
  catch (e) { showToast(e.message, 'error'); }
}
async function deleteSchedule(id) {
  if (!confirm('Delete this schedule?')) return;
  try { await api('DELETE', `/api/schedules/${id}`); loadSchedulesTable(); showToast('Deleted', 'info'); }
  catch (e) { showToast(e.message, 'error'); }
}

function showAddScheduleModal() {
  // Build bus/route options from cached data
  showModal('Add Schedule', `
    <div class="form-group"><label class="form-label">Bus ID</label><input class="form-input" id="newSchedBus" type="number" placeholder="1"/></div>
    <div class="form-group"><label class="form-label">Route ID</label><input class="form-input" id="newSchedRoute" type="number" placeholder="1"/></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Departure (ISO)</label><input class="form-input" id="newSchedDep" type="datetime-local"/></div>
      <div class="form-group"><label class="form-label">Arrival (ISO)</label><input class="form-input" id="newSchedArr" type="datetime-local"/></div>
    </div>`,
    `<button class="btn btn-primary" onclick="addSchedule()">Add</button>`
  );
}
async function addSchedule() {
  const bus_id = parseInt(document.getElementById('newSchedBus').value);
  const route_id = parseInt(document.getElementById('newSchedRoute').value);
  const dep = document.getElementById('newSchedDep').value;
  const arr = document.getElementById('newSchedArr').value;
  if (!bus_id || !route_id || !dep || !arr) { showToast('Fill all fields', 'error'); return; }
  try {
    await api('POST', '/api/schedules', { bus_id, route_id, departure_time: dep, arrival_time: arr });
    closeModal(); loadSchedulesTable(); showToast('Schedule added', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

/* =======================================================  REPORTS  */
async function loadReports() {
  try {
    const s = await api('GET', '/api/reports/stats');
    setTxt('reportDailySales',   '₱' + (s.today_revenue || 0).toFixed(0));
    setTxt('reportTransactions', s.total_bookings || 0);
  } catch { /* not always on screen */ }
}

async function loadFinanceStats() {
  try {
    const s = await api('GET', '/api/reports/stats');
    setTxt('finTodayRev',     '₱' + (s.today_revenue || 0).toFixed(0));
    setTxt('finMonthRev',     '₱' + (s.total_revenue || 0).toFixed(0));
    setTxt('finPending',      s.pending_bookings || 0);
    setTxt('finTransactions', s.total_bookings   || 0);
  } catch { /* silent */ }
}

async function exportCSV() {
  try {
    const rows = await api('GET', '/api/bookings');
    const header = ['QR Code','Route','Seats','Amount','Date','Status'];
    const lines  = rows.map(h => [
      h.qr_code, `${h.origin} → ${h.destination}`,
      (h.seats||[]).join(' '), h.total_amount, h.departure_time, h.booking_status
    ].join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'citybus_report_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    showToast('CSV exported!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

/* =======================================================  OPERATOR  */
function showQRScanner() {
  showModal('QR Scanner', '<p>In production this activates the device camera. Use the manual field below to look up a QR code.</p>',
    '<button class="btn btn-ghost" onclick="closeModal()">Close</button>');
}
function showManualCheck() {
  const a = document.getElementById('manualCheckArea');
  a.style.display = a.style.display === 'none' ? 'block' : 'none';
}
async function verifyTicket() {
  const qr = document.getElementById('checkTicketNum').value.trim();
  if (!qr) { showToast('Enter a QR code', 'error'); return; }
  try {
    const r = await api('POST', '/api/bookings/verify', { qr_code: qr });
    if (r.valid) {
      const t = r.ticket;
      showToast(`✅ Valid — ${t.origin} → ${t.destination} · Seats: ${(t.seats||[]).join(',')} · ${t.passenger_name}`, 'success', 6000);
    } else {
      showToast('❌ ' + r.message, 'error', 5000);
    }
  } catch (e) { showToast(e.message, 'error'); }
}

/* =======================================================  UTILS  */
function setTxt(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function esc(s) { return String(s).replace(/'/g, "\\'"); }
function firstName(name) { return (name || 'User').split(' ')[0]; }

function setBtnLoading(sel, loading) {
  const btn = document.querySelector(sel);
  if (!btn) return;
  if (loading) { btn._t = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> Please wait…'; btn.disabled = true; }
  else         { btn.innerHTML = btn._t || btn.innerHTML; btn.disabled = false; }
}

/* =======================================================  INIT  */
(async () => {
  const token = localStorage.getItem('cb_token');
  if (token) {
    try {
      const user = await api('GET', '/api/auth/me');
      App.currentUser = user;
      populateUserUI(user);
    } catch {
      localStorage.removeItem('cb_token');
    }
  }
  applyTheme(App.theme);
})();

/* =======================================================  PORTAL GATE  */
// Admin portal is hidden — only accessible via ?portal=staff
// Share this URL only with staff: citybus.vercel.app/?portal=staff
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('portal') === 'staff') {
    goto('employee-login');
  }
}());