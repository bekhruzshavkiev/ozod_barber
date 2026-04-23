const WEEKDAYS = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba'];
const MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentyabr','Oktyabr','Noyabr','Dekabr'];
const SERVICE_NAMES = { haircut: 'Soch olish', beard: 'Soqol olish', combo: 'Soch va soqol' };

let token = localStorage.getItem('admin_token') || null;
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);

document.addEventListener('DOMContentLoaded', () => {
  if (token) showAdmin();
});

async function login(e) {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.remove('visible');
  const password = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || "Noto'g'ri parol";
    errEl.classList.add('visible');
    return;
  }
  token = data.token;
  localStorage.setItem('admin_token', token);
  showAdmin();
}

function logout() {
  token = null;
  localStorage.removeItem('admin_token');
  document.getElementById('admin-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = '';
  document.getElementById('password').value = '';
}

function showAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-screen').style.display = '';
  loadDay();
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

function changeDate(delta) {
  currentDate.setDate(currentDate.getDate() + delta);
  loadDay();
}

function formatDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateDisplay(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  let prefix = diff === 0 ? 'Bugun, ' : diff === 1 ? 'Ertaga, ' : '';
  return `${prefix}${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`;
}

async function loadDay() {
  const dateStr = formatDateISO(currentDate);
  document.getElementById('current-date').textContent = formatDateDisplay(currentDate);
  let data;
  try {
    const res = await fetch(`/api/admin/day/${dateStr}`, { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    data = await res.json();
  } catch {
    document.getElementById('admin-slots').innerHTML =
      '<div style="padding:20px;text-align:center;color:#999">Server bilan boglanib bolmadi</div>';
    return;
  }

  const toggle = document.getElementById('day-off-toggle');
  toggle.checked = data.isDayOff;
  document.getElementById('day-status-label').textContent = data.isDayOff ? 'Dam olish kuni' : 'Ish kuni';

  let booked = 0, open = 0, blocked = 0;
  data.slots.forEach(s => {
    if (s.status === 'booked') booked++;
    else if (s.status === 'blocked') blocked++;
    else if (s.status === 'open') open++;
  });
  document.getElementById('stat-bookings').textContent = data.bookingCount;
  document.getElementById('stat-open').textContent = open;
  document.getElementById('stat-blocked').textContent = blocked;

  const el = document.getElementById('admin-slots');
  if (data.isDayOff) {
    el.innerHTML = data.slots.map(s => `
      <div class="admin-slot day-off-slot">
        <span class="time">${s.time}</span>
        <span class="status-dot blocked"></span>
        <span class="info">Dam olish kuni</span>
      </div>
    `).join('');
    return;
  }

  el.innerHTML = data.slots.map(s => {
    const dot = s.status === 'booked' ? 'booked' :
                s.status === 'continuation' ? 'continuation' :
                s.isBlocked ? 'blocked' : 'open';
    let info = '';
    let actionHtml = '';
    if (s.status === 'booked' && s.booking) {
      info = `<span class="info booked-info">${s.booking.name} &mdash; ${SERVICE_NAMES[s.booking.service] || s.booking.service}</span>`;
      actionHtml = `<button class="action-btn" onclick="showBookingModal(${s.booking.id})">Batafsil</button>`;
    } else if (s.status === 'continuation' && s.booking) {
      info = `<span class="info">${s.booking.name} (davomi)</span>`;
    } else if (s.isBlocked) {
      info = `<span class="info">Bloklangan</span>`;
      actionHtml = `<button class="action-btn" onclick="unblockSlot('${dateStr}','${s.time}')">Ochish</button>`;
    } else {
      info = `<span class="info">Bo'sh</span>`;
      actionHtml = `<button class="action-btn" onclick="blockSlot('${dateStr}','${s.time}')">Bloklash</button>`;
    }
    return `
      <div class="admin-slot">
        <span class="time">${s.time}</span>
        <span class="status-dot ${dot}"></span>
        ${info}
        ${actionHtml}
      </div>
    `;
  }).join('');
}

async function toggleDayOff() {
  const off = document.getElementById('day-off-toggle').checked;
  await fetch('/api/admin/day-off', {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ date: formatDateISO(currentDate), off })
  });
  loadDay();
}

async function blockSlot(date, time) {
  await fetch('/api/admin/block-slot', {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ date, time, blocked: true })
  });
  loadDay();
}

async function unblockSlot(date, time) {
  await fetch('/api/admin/block-slot', {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ date, time, blocked: false })
  });
  loadDay();
}

async function showBookingModal(bookingId) {
  const dateStr = formatDateISO(currentDate);
  const res = await fetch(`/api/admin/day/${dateStr}`, { headers: authHeaders() });
  const data = await res.json();
  const slot = data.slots.find(s => s.booking && s.booking.id === bookingId);
  if (!slot || !slot.booking) return;
  const b = slot.booking;
  const d = parseDate(b.date);
  document.getElementById('modal-title').textContent = 'Buyurtma tafsilotlari';
  document.getElementById('modal-body').innerHTML = `
    <div class="detail-row"><span class="detail-label">Ism</span><span class="detail-value">${b.name}</span></div>
    <div class="detail-row"><span class="detail-label">Telefon</span><span class="detail-value"><a href="tel:${b.phone}">${b.phone}</a></span></div>
    <div class="detail-row"><span class="detail-label">Xizmat</span><span class="detail-value">${SERVICE_NAMES[b.service] || b.service}</span></div>
    <div class="detail-row"><span class="detail-label">Sana</span><span class="detail-value">${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}</span></div>
    <div class="detail-row"><span class="detail-label">Vaqt</span><span class="detail-value">${b.time}</span></div>
  `;
  document.getElementById('modal-actions').innerHTML = `
    <button class="btn-cancel-booking" onclick="cancelBooking(${b.id})">Bekor qilish</button>
    <button class="btn-close-modal" onclick="closeModal()">Yopish</button>
  `;
  document.getElementById('modal').classList.add('visible');
}

async function cancelBooking(id) {
  if (!confirm('Buyurtmani bekor qilmoqchimisiz?')) return;
  await fetch(`/api/admin/booking/${id}`, { method: 'DELETE', headers: authHeaders() });
  closeModal();
  loadDay();
}

function closeModal() {
  document.getElementById('modal').classList.remove('visible');
}

document.getElementById('modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

async function testTelegram() {
  const btn = document.getElementById('tg-test-btn');
  const result = document.getElementById('tg-test-result');
  btn.disabled = true;
  btn.textContent = 'Yuborilmoqda...';
  result.textContent = '';
  result.className = '';
  try {
    const res = await fetch('/api/admin/test-telegram', {
      method: 'POST', headers: authHeaders()
    });
    const data = await res.json();
    if (data.ok) {
      result.textContent = '✓ Xabar yuborildi!';
      result.className = 'tg-ok';
    } else {
      result.textContent = '✗ ' + data.error;
      result.className = 'tg-err';
    }
  } catch {
    result.textContent = '✗ Server bilan boglanib bolmadi';
    result.className = 'tg-err';
  }
  btn.disabled = false;
  btn.textContent = 'Telegram sinov xabari yuborish';
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
