const WEEKDAYS = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba'];
const WEEKDAYS_SHORT = ['Ya','Du','Se','Cho','Pa','Ju','Sha'];
const MONTHS = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentyabr','Oktyabr','Noyabr','Dekabr'];

let services = [];
let daysOff = [];
let selectedService = null;
let selectedDate = null;
let selectedTime = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Preload data silently in the background while home page is shown
  const [svcRes, doffRes] = await Promise.all([
    fetch('/api/services').then(r => r.json()),
    fetch('/api/days-off').then(r => r.json())
  ]);
  services = svcRes;
  daysOff = doffRes.daysOff || [];
  renderServices();
  // Start on home page
  showStep('home');
});

function renderServices() {
  const el = document.getElementById('services');
  const icons = { haircut: '&#9986;', beard: '&#9986;', combo: '&#9986;' };
  el.innerHTML = services.map(s => `
    <div class="service-card" data-id="${s.id}" onclick="selectService('${s.id}')">
      <div class="service-icon">${icons[s.id] || '&#9986;'}</div>
      <div class="service-info">
        <h3>${s.name}</h3>
        <span>${s.duration} daqiqa</span>
      </div>
    </div>
  `).join('');
}

function selectService(id) {
  selectedService = services.find(s => s.id === id);
  document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`[data-id="${id}"]`).classList.add('selected');
  selectedDate = null;
  selectedTime = null;
  renderDates();
  showStep('date');
}

function renderDates() {
  const el = document.getElementById('dates');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let html = '';
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = formatDateISO(d);
    const isDayOff = daysOff.includes(dateStr);
    const dayLabel = i === 0 ? 'Bugun' : i === 1 ? 'Ertaga' : WEEKDAYS_SHORT[d.getDay()];
    html += `
      <div class="date-card ${isDayOff ? 'day-off' : ''}"
           data-date="${dateStr}"
           onclick="${isDayOff ? '' : `selectDate('${dateStr}')`}">
        <div class="date-weekday">${dayLabel}</div>
        <div class="date-day">${d.getDate()}</div>
        <div class="date-month">${MONTHS[d.getMonth()].substring(0, 3)}</div>
      </div>
    `;
  }
  el.innerHTML = html;
  updateSummary();
}

function selectDate(dateStr) {
  selectedDate = dateStr;
  selectedTime = null;
  document.querySelectorAll('.date-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`[data-date="${dateStr}"]`).classList.add('selected');
  loadSlots();
  showStep('time');
}

async function loadSlots() {
  const el = document.getElementById('slots');
  el.innerHTML = '<div class="no-slots-msg">Yuklanmoqda...</div>';
  updateSummary();
  const res = await fetch(`/api/slots/${selectedDate}?service=${selectedService.id}`);
  const data = await res.json();
  if (data.dayOff) {
    el.innerHTML = '<div class="no-slots-msg">Bu kun dam olish kuni</div>';
    return;
  }
  const now = new Date();
  const isToday = selectedDate === formatDateISO(now);
  const hasAvailable = data.slots.some(s => {
    if (!s.available) return false;
    if (isToday) {
      const [h, m] = s.time.split(':').map(Number);
      const t = new Date(now); t.setHours(h, m, 0, 0);
      return t > now;
    }
    return true;
  });
  if (!hasAvailable) {
    el.innerHTML = '<div class="no-slots-msg">Bu kunda bo\'sh vaqt yo\'q</div>';
    return;
  }
  el.innerHTML = data.slots.map(s => {
    let isPast = false;
    if (isToday) {
      const [h, m] = s.time.split(':').map(Number);
      const t = new Date(now); t.setHours(h, m, 0, 0);
      if (t <= now) isPast = true;
    }
    let cls = 'slot ';
    if (isPast) cls += 'past';
    else if (s.available) cls += 'available';
    else cls += 'unavailable';
    const clickable = s.available && !isPast;
    return `
      <div class="${cls}" ${clickable ? `onclick="selectTime('${s.time}')"` : ''}>
        ${s.time}
        <div class="slot-label">${isPast ? "O'tdi" : s.available ? "Bo'sh" : 'Band'}</div>
      </div>
    `;
  }).join('');
}

function selectTime(time) {
  selectedTime = time;
  document.querySelectorAll('.slot.available').forEach(s => {
    s.classList.toggle('selected', s.textContent.trim().startsWith(time));
  });
  updateSummary();
  showStep('details');
}

async function submitBooking(e) {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  errEl.classList.remove('visible');
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  if (!name || !phone) {
    errEl.textContent = 'Ism va telefon raqamni kiriting';
    errEl.classList.add('visible');
    return;
  }
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Yuklanmoqda...';
  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: selectedDate, time: selectedTime, service: selectedService.id, name, phone })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Xatolik yuz berdi';
      errEl.classList.add('visible');
      btn.disabled = false;
      btn.textContent = 'Band qilish';
      return;
    }
    renderSuccess(data.booking);
    showStep('success');
  } catch {
    errEl.textContent = 'Server bilan bog\'lanib bo\'lmadi';
    errEl.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Band qilish';
  }
}

function renderSuccess(booking) {
  const d = parseDate(booking.date);
  document.getElementById('booking-result').innerHTML = `
    <div class="row"><span class="label">Xizmat</span><span class="value">${selectedService.name}</span></div>
    <div class="row"><span class="label">Sana</span><span class="value">${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}</span></div>
    <div class="row"><span class="label">Vaqt</span><span class="value">${booking.time}</span></div>
    <div class="row"><span class="label">Ism</span><span class="value">${booking.name}</span></div>
    <div class="row"><span class="label">Telefon</span><span class="value">${booking.phone}</span></div>
  `;
}

function resetBooking() {
  selectedService = null; selectedDate = null; selectedTime = null;
  document.getElementById('name').value = '';
  document.getElementById('phone').value = '';
  document.getElementById('submit-btn').disabled = false;
  document.getElementById('submit-btn').textContent = 'Band qilish';
  document.getElementById('form-error').classList.remove('visible');
  showStep('home');
}

function showStep(step) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById(`step-${step}`).classList.add('active');
  updateSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack(step) { showStep(step); }

function updateSummary() {
  const parts = [];
  if (selectedService) parts.push(`<span class="tag">${selectedService.name}</span>`);
  if (selectedDate) {
    const d = parseDate(selectedDate);
    parts.push(`<span class="tag">${d.getDate()} ${MONTHS[d.getMonth()].substring(0,3)}, ${WEEKDAYS_SHORT[d.getDay()]}</span>`);
  }
  if (selectedTime) parts.push(`<span class="tag">${selectedTime}</span>`);
  const html = parts.join('');
  ['summary','summary2','summary3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

function formatDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
