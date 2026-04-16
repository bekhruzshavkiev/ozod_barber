const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ozod2026';
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Services ---
const SERVICES = {
  haircut: { id: 'haircut', name: 'Soch olish', duration: 40, slots: 2 },
  beard:   { id: 'beard',   name: 'Soqol olish', duration: 20, slots: 1 },
  combo:   { id: 'combo',   name: 'Soch va soqol', duration: 60, slots: 2 }
};

// --- Time slots: 09:00 - 18:30 every 30 min ---
const ALL_SLOTS = [];
for (let h = 9; h <= 18; h++) {
  ALL_SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  ALL_SLOTS.push(`${String(h).padStart(2, '0')}:30`);
}
// ALL_SLOTS = ["09:00","09:30","10:00",...,"18:00","18:30"]

// --- Data helpers ---
function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { daysOff: [], blockedSlots: {}, bookings: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getOccupiedTimes(bookings) {
  const occupied = new Set();
  for (const b of bookings) {
    const idx = ALL_SLOTS.indexOf(b.time);
    for (let i = 0; i < (b.slotsNeeded || 1); i++) {
      if (idx + i < ALL_SLOTS.length) occupied.add(ALL_SLOTS[idx + i]);
    }
  }
  return occupied;
}

// --- Public API ---

app.get('/api/services', (_req, res) => {
  res.json(Object.values(SERVICES));
});

app.get('/api/days-off', (_req, res) => {
  const data = readData();
  res.json({ daysOff: data.daysOff });
});

app.get('/api/slots/:date', (req, res) => {
  const { date } = req.params;
  const serviceId = req.query.service || 'haircut';
  const data = readData();

  if (data.daysOff.includes(date)) {
    return res.json({ dayOff: true, slots: [] });
  }

  const slotsNeeded = SERVICES[serviceId]?.slots || 1;
  const dayBookings = data.bookings.filter(b => b.date === date);
  const occupied = getOccupiedTimes(dayBookings);
  const blocked = new Set(data.blockedSlots[date] || []);

  const slots = ALL_SLOTS.map((time, idx) => {
    const isOccupied = occupied.has(time);
    const isBlocked = blocked.has(time);

    let available = true;
    for (let i = 0; i < slotsNeeded; i++) {
      if (idx + i >= ALL_SLOTS.length ||
          occupied.has(ALL_SLOTS[idx + i]) ||
          blocked.has(ALL_SLOTS[idx + i])) {
        available = false;
        break;
      }
    }

    return {
      time,
      status: isOccupied ? 'booked' : isBlocked ? 'blocked' : 'open',
      available
    };
  });

  res.json({ dayOff: false, slots });
});

app.post('/api/book', (req, res) => {
  const { date, time, service, name, phone } = req.body;

  if (!date || !time || !service || !name || !phone) {
    return res.status(400).json({ error: "Barcha maydonlarni to'ldiring" });
  }

  if (!SERVICES[service]) {
    return res.status(400).json({ error: "Noto'g'ri xizmat turi" });
  }

  const data = readData();

  if (data.daysOff.includes(date)) {
    return res.status(400).json({ error: 'Bu kun dam olish kuni' });
  }

  const slotsNeeded = SERVICES[service].slots;
  const idx = ALL_SLOTS.indexOf(time);
  if (idx === -1) {
    return res.status(400).json({ error: "Noto'g'ri vaqt" });
  }

  const dayBookings = data.bookings.filter(b => b.date === date);
  const occupied = getOccupiedTimes(dayBookings);
  const blocked = new Set(data.blockedSlots[date] || []);

  for (let i = 0; i < slotsNeeded; i++) {
    if (idx + i >= ALL_SLOTS.length) {
      return res.status(400).json({ error: "Bu vaqtda joy yo'q" });
    }
    const t = ALL_SLOTS[idx + i];
    if (occupied.has(t) || blocked.has(t)) {
      return res.status(400).json({ error: 'Bu vaqt allaqachon band' });
    }
  }

  const booking = {
    id: Date.now(),
    date,
    time,
    service,
    slotsNeeded,
    name: name.trim(),
    phone: phone.trim(),
    createdAt: new Date().toISOString()
  };

  data.bookings.push(booking);
  writeData(data);
  sendTelegramNotification(booking);

  res.json({ success: true, booking });
});

// --- Admin API ---

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const token = Buffer.from(`admin:${Date.now()}`).toString('base64');
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: "Noto'g'ri parol" });
  }
});

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: "Ruxsat yo'q" });
  try {
    if (Buffer.from(token, 'base64').toString().startsWith('admin:')) return next();
  } catch {}
  res.status(401).json({ error: "Ruxsat yo'q" });
}

app.get('/api/admin/day/:date', adminAuth, (req, res) => {
  const { date } = req.params;
  const data = readData();
  const bookings = data.bookings.filter(b => b.date === date);
  const blockedSlots = data.blockedSlots[date] || [];
  const isDayOff = data.daysOff.includes(date);

  const occupied = getOccupiedTimes(bookings);

  const slots = ALL_SLOTS.map(time => {
    const booking = bookings.find(b => b.time === time);
    const isPartOfBooking = occupied.has(time) && !booking;
    const parentBooking = isPartOfBooking
      ? bookings.find(b => {
          const bIdx = ALL_SLOTS.indexOf(b.time);
          const tIdx = ALL_SLOTS.indexOf(time);
          return tIdx > bIdx && tIdx < bIdx + (b.slotsNeeded || 1);
        })
      : null;

    return {
      time,
      status: booking ? 'booked' : isPartOfBooking ? 'continuation' : blockedSlots.includes(time) ? 'blocked' : 'open',
      booking: booking || parentBooking || null,
      isBlocked: blockedSlots.includes(time)
    };
  });

  res.json({ isDayOff, slots, bookingCount: bookings.length });
});

app.post('/api/admin/day-off', adminAuth, (req, res) => {
  const { date, off } = req.body;
  const data = readData();

  if (off && !data.daysOff.includes(date)) {
    data.daysOff.push(date);
  } else if (!off) {
    data.daysOff = data.daysOff.filter(d => d !== date);
  }

  writeData(data);
  res.json({ success: true });
});

app.post('/api/admin/block-slot', adminAuth, (req, res) => {
  const { date, time, blocked } = req.body;
  const data = readData();

  if (!data.blockedSlots[date]) data.blockedSlots[date] = [];

  if (blocked && !data.blockedSlots[date].includes(time)) {
    data.blockedSlots[date].push(time);
  } else if (!blocked) {
    data.blockedSlots[date] = data.blockedSlots[date].filter(t => t !== time);
  }

  writeData(data);
  res.json({ success: true });
});

app.delete('/api/admin/booking/:id', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const data = readData();
  data.bookings = data.bookings.filter(b => b.id !== id);
  writeData(data);
  res.json({ success: true });
});

// --- Telegram ---

async function sendTelegramNotification(booking) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  const sName = SERVICES[booking.service]?.name || booking.service;
  const text = `Yangi band qilish!\n\nIsm: ${booking.name}\nTelefon: ${booking.phone}\nXizmat: ${sName}\nSana: ${booking.date}\nVaqt: ${booking.time}`;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text })
    });
  } catch (err) {
    console.error('Telegram xatolik:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`\n  Ozod Barber server ishlamoqda!`);
  console.log(`  Mijozlar uchun:  http://localhost:${PORT}`);
  console.log(`  Admin panel:     http://localhost:${PORT}/admin.html`);
  console.log(`  Admin parol:     ${ADMIN_PASSWORD}\n`);
});
