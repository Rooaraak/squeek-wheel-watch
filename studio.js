// Squeek Spin Art: the page. Live card, gallery, night view with replay, video and wallpapers, Squeek portraits,
// "Paint with Squeektoshi", and the ?overlay=art stream source. Data comes from the public Squeekchain API plus
// nights.json (finished nights archived once, so paintings outlive the API's 30-day window). Nothing is sent anywhere.
import * as Art from './art.js';

const { API, SLOTS, PAINT_EDGE, PALETTES, GOLD } = Art;
const TAU = Math.PI * 2;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const OVERLAY = params.get('overlay') === 'art';
const CORNER = OVERLAY && params.get('layout') === 'corner';
const PREVIEW = params.has('preview');                          // the small preview on the main page polls gently
// The old live-speed overlay and wallet checker moved to /watch/; keep their links working.
const MOVED = (params.has('overlay') && !OVERLAY) || /^#wallet=/.test(location.hash);
if (MOVED) location.replace(`watch/${location.search}${location.hash}`);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DPR = Math.min(2, window.devicePixelRatio || 1);
const nf = new Intl.NumberFormat('en-US');
const VISUAL = 0.3;          // the card turns at 30 % of the wheel's real rpm, fast enough to feel it, slow enough to watch
const WET_STEP = 200;        // while he runs, a drop of wet paint lands every 200 turns (2–3 min) until the half hour is published
const MM_PER_TURN = 878;     // one turn of the wheel ≈ 88 cm (Squeekchain's own distance ÷ turns)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

// ---------- theme (shared with /watch/) ----------
(() => {
  const root = document.documentElement, saved = params.get('theme') || store.get('sww-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  $('theme')?.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('sww-theme', root.dataset.theme);
    if (!OVERLAY) $('overlayFrame').src = overlaySrc();
  });
})();

// ---------- formatting ----------
const dateLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const slotUtc = (slot) => { const m = (720 + slot * 30) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const km = (mm) => (mm == null ? '–' : (Number(mm) / 1e6).toFixed(1));
const localTimeOfUtcMinute = (min) => { const d = new Date(); d.setUTCHours(Math.floor(min / 60), min % 60, 0, 0); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
const ago = (iso) => { const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
function runsText(plan) {
  if (!plan.runs.length) return 'He did not run.';
  const parts = plan.runs.map((r) => `${slotUtc(r.start)} to ${slotUtc((r.end + 1) % SLOTS)}`);
  return `He ran ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]} UTC.`;
}
const describe = (plan) => `Spin-art painting "${plan.title}", ${plan.palette.name} colours, night of ${dateLabel(plan.date)}: ${nf.format(plan.stats.turns)} wheel turns. ${runsText(plan)}`;

// ---------- data ----------
async function getJSON(path) {
  const r = await fetch(path.startsWith('http') ? path : `${API}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return r.json();
}
const data = { days: new Map(), archive: {}, marks: [], marksLoaded: false, status: null, statusFailed: false, typical: null, loaded: false, error: null, issued: 9999 };

async function loadArchive() {
  try { const r = await fetch('nights.json', { cache: 'no-cache', signal: AbortSignal.timeout(15000) }); if (r.ok) data.archive = (await r.json()).nights ?? {}; }
  catch (e) { console.warn('archive', e.message); }
}
async function loadStats(range) {
  const s = await getJSON(`/v1/measurement/stats?range=${range}`);
  for (const d of s.activity?.days ?? []) data.days.set(d.date, d);
  if (range === '30d') data.typical = s.activity?.typicalDay ?? null;
}
async function loadMarks() {
  const events = []; let cursor = null;
  for (let page = 0; page < 12; page++) {
    const q = new URLSearchParams({ category: 'measurement', limit: '100' }); if (cursor) q.set('cursor', cursor);
    const j = await getJSON(`/v1/events?${q}`);
    events.push(...(j.events ?? [])); cursor = j.nextCursor;
    if (!cursor || !j.events?.length) break;
  }
  data.marks = Art.marksFromEvents(events); data.marksLoaded = true;
}
function nightOf(date, { closedOnly = false } = {}) {
  const a = data.archive[date];
  if (a) return { date, slots: [...a.slots], coverage: a.slots.map((v) => (v == null ? 'missing' : 'complete')), distanceMm: a.distanceMm, marks: a.marks.map((m) => ({ ...m })), archived: true };
  const day = data.days.get(date);
  const night = day ? Art.nightFromStats(day) : { date, slots: Array(SLOTS).fill(null), coverage: Array(SLOTS).fill('missing'), distanceMm: null, marks: [] };
  if (closedOnly) night.slots = night.slots.map((w, i) => (night.coverage[i] === 'complete' ? w : null));
  night.marks = data.marks.filter((m) => m.date === date && (!closedOnly || night.coverage[m.slot] === 'complete'));
  return night;
}
const planCache = new Map();
function planOf(night) {                                      // plans are pure, so cache them by their recipe
  const key = Art.seedTextOf(night);
  if (!planCache.has(key)) { if (planCache.size > 200) planCache.clear(); planCache.set(key, Art.planNight(night)); }
  return planCache.get(key);
}
const now = () => Art.slotOf(new Date().toISOString());     // { date: tonight's Squeek day, slot: the open half hour }
const knownDates = () => [...new Set([...Object.keys(data.archive), ...data.days.keys()])];
function finishedNights() {
  const tonight = now().date;
  return knownDates().filter((d) => d < tonight).sort().reverse().map((d) => planOf(nightOf(d))).filter((p) => p.stats.turns > 0);
}
function publishedSlots(date) {
  const n = nightOf(date, { closedOnly: true });
  return new Set(n.slots.map((w, i) => (w == null ? -1 : i)).filter((i) => i >= 0));
}
function typicalStart() {
  if (!data.typical) return null;
  const byMin = new Map(data.typical.map((b) => [b.startMinuteUtc, Number(b.meanWorkMilli) / 1000]));
  for (let i = 0; i < SLOTS; i++) { const m = (720 + i * 30) % 1440; if ((byMin.get(m) ?? 0) >= 300) return m; }
  return null;
}
// "5 h 40 min" until his usual start (today or tomorrow), or null when unknown.
function untilStart() {
  const m = typicalStart(); if (m == null) return null;
  const d = new Date(); d.setUTCHours(Math.floor(m / 60), m % 60, 0, 0);
  if (d - Date.now() < -2 * 3600e3) d.setUTCDate(d.getUTCDate() + 1);
  const mins = Math.round((d - Date.now()) / 60e3);
  if (mins <= 0) return null;
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
// Optional browser notification when he gets on the wheel (only while this page is open).
function notifyStart() {
  if (store.get('sart-notify') !== '1' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('Squeektoshi is painting 🐹🎨', { body: 'He just got on the wheel. Tonight\'s card is spinning.', tag: 'sart-start' }); } catch {}
}
const isStale = (st) => { const m = st?.measurement; return !!m && !(Date.now() - Date.parse(m.observedAt) <= Number(m.staleAfterSeconds) * 1000); };
const isRunning = (st) => { const m = st?.measurement; return !!m && !isStale(st) && m.coreStatus !== 'IDLE' && Number(m.speedMmPerSecond) > 0; };
const liveRpm = () => (isRunning(data.status) ? Number(data.status.measurement.rpmMilli) / 1000 || 0 : 0);

// ---------- a card on screen: layers, spin, wet paint ----------
// The canvas is redrawn only when paint changes; the spin is a CSS rotation of the canvas inside its round wrapper
// (the wrapper keeps the shadow still), so a card left spinning all night in OBS costs almost nothing.
const cards = new Set();
let rafId = 0, lastT = 0;
function kick() { if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(loop); } }
function loop(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  let busy = false;
  for (const c of cards) busy = c.frame(dt, t) || busy;
  rafId = busy ? requestAnimationFrame(loop) : 0;
}
const removeFrom = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); };

class Card {
  constructor(canvas, { center = null } = {}) {
    this.canvas = canvas; this.wrap = canvas.parentElement; this.ctx = canvas.getContext('2d');
    this.angle = 0; this.speed = 0; this.target = 0; this.shown = null;
    this.baked = []; this.wet = []; this.palette = PALETTES[0]; this.label = ''; this.center = center;
    this.onScreen = true; this.dirty = true;
    cards.add(this);
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    new IntersectionObserver(([e]) => { this.onScreen = e.isIntersecting; if (this.onScreen) { this.dirty = true; kick(); } }).observe(this.wrap);
  }
  get R() { return this.px / 2; }
  resize() {
    const px = Math.max(64, Math.round((this.wrap.clientWidth || 400) * DPR));
    if (px === this.px) return;
    this.px = px; this.canvas.width = this.canvas.height = px;
    this.buildLayers(); this.rebake(); this.touch();
  }
  touch() { if (this.bg) { this.draw(); this.dirty = false; } else this.dirty = true; kick(); }   // draw now: animation frames pause off screen and in background iframes
  setCard(palette, label) { this.palette = palette; this.label = label; if (this.px) { this.buildLayers(); this.rebake(); } this.touch(); }
  setLabel(label) { if (label === this.label) return; this.label = label; if (this.px) this.buildTop(); this.touch(); }
  buildLayers() {
    const px = this.px, R = this.R;
    this.bg = mk(px, px); const b = this.bg.getContext('2d'); b.translate(R, R); Art.drawCard(b, R, this.palette);
    this.paintLayer = mk(px, px); this.top = mk(px, px);
    this.buildTop();
  }
  buildTop() {
    const R = this.R, t = this.top.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0); t.clearRect(0, 0, this.px, this.px); t.translate(R, R);
    Art.drawFinish(t, R, this.palette, mk); Art.drawFrame(t, R, this.palette);
    if (this.label) Art.drawLabel(t, R, this.palette, this.label);
    if (!this.center) Art.drawHub(t, R, this.palette);
  }
  rebake() {
    if (!this.px) return;
    const p = this.paintLayer.getContext('2d'); p.setTransform(1, 0, 0, 1, 0, 0); p.clearRect(0, 0, this.px, this.px);
    for (const d of this.baked) this.bakeOne(d);
  }
  bakeOne(d) {
    if (!this.px) return;
    const p = this.paintLayer.getContext('2d'), R = this.R;
    p.save(); p.translate(R, R); p.beginPath(); p.arc(0, 0, R * PAINT_EDGE, 0, TAU); p.clip();
    Art.drawDrop(p, d, R, this.palette, 1); p.restore();
  }
  setDrops(drops) { this.baked = [...drops]; this.wet = []; this.rebake(); this.touch(); }
  add(drop, { dur = 1300, delay = 0, keepWet = false } = {}) {
    if (REDUCED && !keepWet) { this.baked.push(drop); this.bakeOne(drop); this.touch(); return; }
    const w = { drop, t0: performance.now() + delay, dur, keepWet }; this.wet.push(w); this.touch(); return w;
  }
  clearPaint() { this.baked = []; this.wet = []; this.rebake(); this.touch(); }
  frame(dt, t) {
    if (!this.px) return false;
    const target = REDUCED ? 0 : this.target;
    const tau = target > this.speed ? 1.2 : 2.4;              // spins up quickly, coasts down like a real spin-art machine
    this.speed += (target - this.speed) * (1 - Math.exp(-dt / tau));
    if (target === 0 && this.speed < 0.04) {                  // settle back to 12 o'clock so the clock face reads right
      this.speed = 0;
      const off = ((this.angle % TAU) + TAU) % TAU, d = off > Math.PI ? TAU - off : -off;
      this.angle += Math.abs(d) < 0.002 ? d : d * (1 - Math.exp(-dt / 0.5));
    }
    this.angle += this.speed * dt;
    const off = ((this.angle % TAU) + TAU) % TAU;
    let busy = this.speed > 0 || (off > 0.001 && off < TAU - 0.001);
    for (const w of [...this.wet]) {
      if (w.keepWet || t < w.t0 + w.dur) continue;
      removeFrom(this.wet, w); this.baked.push(w.drop); this.bakeOne(w.drop); this.dirty = true;
    }
    const flying = this.wet.some((w) => !w.keepWet);
    if (flying) busy = true;
    if (this.onScreen) {
      if (this.dirty || this.wet.some((w) => !w.keepWet && t >= w.t0)) { this.draw(t); this.dirty = false; }
      if (this.angle !== this.shown) { this.canvas.style.transform = this.angle ? `rotate(${this.angle.toFixed(4)}rad)` : ''; this.shown = this.angle; }
    }
    return busy || target > 0;
  }
  draw(t = performance.now()) {
    if (!this.px || !this.bg) return;
    const c = this.ctx, R = this.R;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.px, this.px);
    c.drawImage(this.bg, 0, 0); c.drawImage(this.paintLayer, 0, 0);
    if (this.wet.length) {
      c.save(); c.translate(R, R); c.beginPath(); c.arc(0, 0, R * PAINT_EDGE, 0, TAU); c.clip();
      for (const w of this.wet) {
        const k = w.keepWet ? 1 : Math.max(0, Math.min(1, (t - w.t0) / w.dur));
        if (k > 0) Art.drawDrop(c, w.drop, R, this.palette, 1 - Math.pow(1 - k, 2.2));
      }
      c.restore();
    }
    c.drawImage(this.top, 0, 0);
  }
  // Card coordinates (radius 1) of a pointer event, undoing the spin (the wrapper never rotates).
  toCard(e) {
    const r = this.wrap.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1, a = -this.angle;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  }
  // A still, upright copy at any size (for downloads).
  snapshot(size, label = this.label) {
    const c = mk(size, size), x = c.getContext('2d'), R = size / 2;
    x.translate(R, R); Art.drawCard(x, R, this.palette);
    x.save(); x.beginPath(); x.arc(0, 0, R * PAINT_EDGE, 0, TAU); x.clip();
    for (const d of [...this.baked, ...this.wet.map((w) => w.drop)]) Art.drawDrop(x, d, R, this.palette, 1);
    x.restore();
    Art.drawFinish(x, R, this.palette, mk); Art.drawFrame(x, R, this.palette);
    if (label) Art.drawLabel(x, R, this.palette, label);
    Art.drawHub(x, R, this.palette);
    return c;
  }
}

// ---------- the live card (hero and stream overlay) ----------
// While tonight has paint, it shows tonight: published half hours as dry paint, newer turns as wet paint that lands
// every WET_STEP turns. Before he starts, it shows last night's finished painting.
const live = { cards: [], mode: null, plan: null, key: '', date: null, slot: null, base: null, wetCount: 0, wetDrops: [], closed: new Map() };

function liveView() {
  const { date } = now();
  const tonight = planOf(nightOf(date, { closedOnly: true }));
  const hasWet = live.wetDrops.some((w) => w.date === date);
  if (tonight.stats.turns > 0 || hasWet || isRunning(data.status)) return { mode: 'tonight', plan: tonight };
  const last = finishedNights()[0];
  return last ? { mode: 'last', plan: last } : { mode: 'tonight', plan: tonight };
}
// Turns not yet in the published half hours: the open half hour, plus closed ones Squeekchain hasn't published yet.
function liveWetTurns() {
  const m = data.status?.measurement;
  if (!m || live.base == null || live.date !== now().date) return 0;
  const pub = publishedSlots(live.date);
  for (const s of [...live.closed.keys()]) if (pub.has(s)) live.closed.delete(s);
  let pending = 0; for (const n of live.closed.values()) pending += n;
  return pending + Math.max(0, Number(m.cumulativeWorkUnits) - live.base);
}
const tonightLabel = (plan) => `Tonight · ${dateLabel(plan.date)} · ${nf.format(plan.stats.turns + liveWetTurns())} turns so far`;

function refreshLive() {
  const v = liveView();
  const key = `${v.mode}|${v.plan.date}|${v.plan.seed}`;
  const label = v.mode === 'tonight' ? tonightLabel(v.plan) : Art.labelOf(v.plan);
  if (key !== live.key) {
    const prev = live.plan, prevMode = live.mode, first = !live.key;
    live.key = key; live.mode = v.mode; live.plan = v.plan;
    const pub = publishedSlots(v.plan.date);
    const wet = v.mode === 'tonight' ? live.wetDrops.filter((w) => w.date === v.plan.date && !pub.has(w.slot)).map((w) => w.drop) : [];
    // Half hours already on the card keep their paint; newly published ones fly in. Wet paint stays until its half hour is published.
    const sameCard = !first && prev && prev.date === v.plan.date && prevMode === v.mode;
    const oldSlots = new Set(sameCard ? prev.drops.map((d) => d.slot) : []);
    const fresh = sameCard ? v.plan.drops.filter((d) => !oldSlots.has(d.slot)) : v.plan.drops;
    const kept = v.plan.drops.filter((d) => !fresh.includes(d));
    for (const c of live.cards) {
      c.setCard(v.plan.palette, label);
      c.setDrops([...kept, ...wet]);
      fresh.forEach((d, i) => c.add(d, { delay: i * Math.min(160, 4000 / fresh.length), dur: 900 }));
      c.canvas.setAttribute('aria-label', v.mode === 'tonight' ? `Tonight's card, still being painted. ${nf.format(v.plan.stats.turns)} turns so far.` : describe(v.plan));
    }
  } else for (const c of live.cards) c.setLabel(label);
  renderLiveText(v);
  updateGallery();
}

// New turns become wet paint.
function liveWet() {
  const m = data.status?.measurement;
  if (!m || live.mode !== 'tonight') return;
  const { date, slot } = now(), cum = Number(m.cumulativeWorkUnits);
  if (!Number.isFinite(cum)) return;
  if (live.date !== date) { Object.assign(live, { date, slot, base: cum, wetCount: 0, wetDrops: [], closed: new Map() }); return; }
  if (live.base == null || cum < live.base) { live.slot = slot; live.base = cum; live.wetCount = 0; return; }   // first reading, or the counter restarted
  if (live.slot !== slot) {
    if (cum - live.base > 0) live.closed.set(live.slot, (live.closed.get(live.slot) ?? 0) + cum - live.base);
    live.slot = slot; live.base = cum; live.wetCount = 0; return;
  }
  const want = Math.floor((cum - live.base) / WET_STEP);
  if (want <= live.wetCount) return;
  const palette = Art.paletteOf(date), rpm = liveRpm();
  while (live.wetCount < want) {
    const r = Art.rng(Art.sha256Hex(`live|${date}|${slot}|${live.wetCount}`));
    const th = Art.slotAngle(slot) + (r() - 0.5) * (TAU / 24) * 1.3, r0 = 0.13 + 0.5 * Math.pow(r(), 1.25);
    const n = palette.colors.length, color = palette.colors[Math.max(0, Math.min(n - 1, Math.round(Art.hourT(slot) * (n - 1) + (r() - 0.5) * 1.4)))];
    const drop = { slot, ...Art.dropAt(r, { color, x0: r0 * Math.cos(th), y0: r0 * Math.sin(th), vol: 0.5 + 0.4 * r(), omega: Math.min(1.15, Math.max(0.35, rpm / 95)) }) };
    live.wetDrops.push({ date, slot, drop });
    for (const c of live.cards) c.add(drop, { dur: 1600 });
    live.wetCount++;
  }
  flash();
}
function flash() {
  for (const el of [$('ovCap'), $('ovCorner')]) { if (!el) continue; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}

function renderLiveText(v) {
  const st = data.status, running = isRunning(st), stale = isStale(st);
  for (const el of [$('hero'), $('pill'), $('ovCap'), $('ovCorner')]) { el?.classList.toggle('is-running', running); el?.classList.toggle('is-stale', stale); }
  const turnsTonight = (v.mode === 'tonight' ? v.plan.stats.turns : 0) + liveWetTurns();
  const stateText = !st ? (data.statusFailed ? 'No signal' : 'Connecting…') : stale ? 'Sensor offline' : running ? 'Painting now' : 'Resting';
  const start = typicalStart(), startText = start == null ? '' : `He usually starts around ${localTimeOfUtcMinute(start)} your time.`;
  if (OVERLAY) {
    if (params.get('caption') === '0') { $('ovCap').hidden = true; $('ovCorner').hidden = true; }
    $('ovText').textContent = running ? `Squeektoshi is painting · ${nf.format(turnsTonight)} turns tonight`
      : v.mode === 'tonight' && turnsTonight > 0 ? `Resting · ${nf.format(turnsTonight)} turns on tonight's card`
      : v.plan?.stats.turns ? `Last night: ${v.plan.title} · squeekwheel.xyz` : 'Squeek Spin Art · squeekwheel.xyz';
    const lastMode = v.mode === 'last';
    $('ovEyebrow').textContent = lastMode ? "Squeektoshi's last painting" : "Squeektoshi's painting tonight";
    $('ovBig').textContent = lastMode ? v.plan.title : `${nf.format(turnsTonight)} turns`;
    $('ovSub').textContent = lastMode ? `${nf.format(v.plan.stats.turns)} turns · squeekwheel.xyz` : `${running ? 'painting now' : stale ? 'sensor offline' : 'resting'} · squeekwheel.xyz`;
    return;
  }
  $('pillText').textContent = stateText;
  $('headline').textContent = running ? 'Squeektoshi is painting right now' : stale ? 'The wheel sensor is offline' : 'Squeektoshi paints every night';
  document.title = running ? '🐹🎨 Painting now · Squeek Spin Art' : 'Squeek Spin Art · Paintings by the hamster that mines Squeekchain';
  const wait = untilStart();
  const [num, unit] = running ? [(Number(st.measurement.rpmMilli) / 1000).toFixed(0), 'rpm']
    : turnsTonight > 0 ? [nf.format(turnsTonight), 'turns tonight']
    : wait != null ? [wait, 'until he usually starts'] : ['–', 'rpm'];
  $('rpm').textContent = num; $('rpmUnit').textContent = unit;
  $('tonightTurns').textContent = nf.format(turnsTonight);
  $('tonightKm').textContent = km(turnsTonight * MM_PER_TURN);      // from the same turns, so the two never disagree mid-run
  $('sensor').textContent = st ? `sensor read ${ago(st.measurement.observedAt)}` : data.statusFailed ? 'can\'t reach the Squeekchain API right now' : '';
  const cap = $('heroCaption');
  if (v.mode === 'last') {
    cap.innerHTML = '';
    const b = document.createElement('b'); b.textContent = `Last night: ${v.plan.title}.`;
    cap.append(b, ` ${nf.format(v.plan.stats.turns)} turns, ${km(v.plan.stats.distanceMm)} km. Tonight's card is still blank. ${startText}`);
  } else {
    cap.textContent = running ? 'Tonight\'s card turns with his real speed (slowed down so you can watch). Wet paint lands every 200 turns and dries into the painting each half hour.'
      : turnsTonight > 0 ? `Tonight's card so far: ${nf.format(turnsTonight)} turns. It spins again as soon as he gets back on the wheel, and the night ends at 12:00 UTC.`
      : `Tonight's card is blank so far. ${startText}`;
  }
}

function applySpin() {
  const rpm = liveRpm();
  for (const c of live.cards) c.target = rpm > 0 ? (rpm / 60) * TAU * VISUAL : 0;
  kick();
}

// ---------- polling ----------
let statusTimer = 0, statsTimer = 0, lastRunAt = 0, statsPolls = 0;
async function pollStatus() {
  clearTimeout(statusTimer);
  if (!document.hidden) {
    try {
      const st = await getJSON('/v1/status');
      if (!st?.measurement?.observedAt) throw new Error('status without a measurement');
      data.status = st; data.statusFailed = false;
      // He runs in bursts, so only a start after at least 20 quiet minutes counts as "he started".
      if (isRunning(st)) { if (data.restingSince && Date.now() - data.restingSince > 20 * 60e3) notifyStart(); data.restingSince = 0; lastRunAt = Date.now(); }
      else if (!data.restingSince) data.restingSince = Date.now();
      liveWet();
    } catch (e) { data.statusFailed = true; console.warn('status', e.message); }
    try { refreshLive(); applySpin(); toy.onStatus(); } catch (e) { console.warn('render', e.message); }   // a stale reading shows as offline
  }
  statusTimer = setTimeout(pollStatus, PREVIEW ? 30000 : isRunning(data.status) ? 5000 : 15000);
}
async function pollStats() {
  clearTimeout(statsTimer);
  const recent = Date.now() - lastRunAt < 40 * 60e3;
  if (!document.hidden) {
    try { await loadStats(data.loaded ? '7d' : '30d'); data.loaded = true; data.error = null; } catch (e) { data.error = e; console.warn('stats', e.message); }
    if (!data.marksLoaded || recent) { try { await loadMarks(); } catch (e) { console.warn('marks', e.message); } }
    if (++statsPolls % 6 === 0) await loadArchive();             // pick up newly archived nights now and then
    try { refreshLive(); } catch (e) { console.warn('render', e.message); }
  }
  statsTimer = setTimeout(pollStats, recent ? 120e3 : !data.loaded || !data.marksLoaded ? 60e3 : 600e3);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollStatus(); });

// ---------- gallery ----------
let galleryKey = '';
function updateGallery(force = false) {
  if (OVERLAY) return;
  const plans = finishedNights(), key = `${plans.map((p) => p.seed).join(',')}|${data.error && !plans.length ? 'error' : ''}|${data.loaded}`;
  if (!force && key === galleryKey) return;
  galleryKey = key; renderGallery(plans);
}
function renderGallery(plans) {
  const grid = $('galleryGrid');
  grid.innerHTML = '';
  if (!plans.length) {
    grid.innerHTML = `<div class="empty">${data.error ? 'The Squeekchain API did not answer. Trying again shortly.' : data.loaded ? 'No finished nights yet. The first painting appears after his first night on the wheel.' : 'Collecting the paintings…'}</div>`;
    return;
  }
  plans.forEach((plan, i) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'card night'; btn.setAttribute('aria-label', `Open ${plan.title}, night of ${dateLabel(plan.date)}`);
    const c = mk(10, 10); c.className = 'disc'; c.setAttribute('role', 'img'); c.setAttribute('aria-label', describe(plan));
    const h = document.createElement('h3'); h.textContent = plan.title;
    if (plan.stats.marks) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'gold'; tag.title = 'A record that night: a new top speed or another 50 km'; h.append(tag); }
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = `${dateLabel(plan.date).replace(/ \d{4}$/, '')} · ${nf.format(plan.stats.turns)} turns · ${km(plan.stats.distanceMm)} km`;
    const text = document.createElement('div'); text.append(h, meta);
    btn.append(c, text); btn.addEventListener('click', () => openNight(plan.date));
    grid.append(btn);
    setTimeout(() => {                                          // paint thumbnails one by one so the page stays responsive
      const css = c.clientWidth || 220, px = Math.round(css * DPR);
      c.width = c.height = px;
      Art.paint(c.getContext('2d'), plan, { cx: px / 2, cy: px / 2, R: px / 2, label: px >= 360, makeCanvas: mk });
    }, 30 * i);
  });
}

// ---------- night dialog: replay, facts, video, wallpapers, share, verification ----------
let dlgCard = null, dlgPlan = null, replayTimer = 0;
function openNight(date) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !knownDates().includes(date)) return false;
    const night = nightOf(date), plan = planOf(night);
    if (!plan.stats.turns) return false;
    dlgPlan = plan;
    const dlg = $('nightDialog');
    if (!dlg.open) dlg.showModal();
    if (!dlgCard) dlgCard = new Card($('dlgCanvas'));
    stopReplay();
    dlgCard.setCard(plan.palette, Art.labelOf(plan)); dlgCard.setDrops(plan.drops); dlgCard.angle = 0; dlgCard.speed = 0;
    dlgCard.resize();
    $('dlgCanvas').setAttribute('aria-label', describe(plan));
    $('dlgTitle').textContent = plan.title;
    $('dlgSub').textContent = `Night of ${dateLabel(plan.date)} · ${plan.palette.name} card · ${runsText(plan)}`;
    const peakSlot = night.slots.reduce((best, w, i, a) => ((w ?? 0) > (a[best] ?? 0) ? i : best), 0);
    const facts = [
      ['Wheel turns', nf.format(plan.stats.turns)], ['Distance', `${km(plan.stats.distanceMm)} km`],
      ['Runs', String(plan.stats.runs)], ['Busiest half hour', `${nf.format(plan.stats.peak)} at ${slotUtc(peakSlot)} UTC`],
    ];
    renderFacts($('dlgFacts'), facts);
    drawStrip(plan, night);
    const ul = $('dlgMarks'); ul.innerHTML = '';
    for (const m of night.marks) { const li = document.createElement('li'); li.textContent = `Gold paint at ${new Date(m.at).toISOString().slice(11, 16)} UTC: ${m.label}.`; ul.append(li); }
    const url = `https://www.squeekwheel.xyz/#night=${plan.date}`;
    const text = `Squeektoshi painted "${plan.title}" on the night of ${dateLabel(plan.date)}: ${nf.format(plan.stats.turns)} turns of his wheel, ${km(plan.stats.distanceMm)} km 🐹🎨\n\nA new spin-art card every night, painted from @squeekchain's own data:`;
    $('dlgShare').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    $('dlgSeedText').textContent = plan.seedText;
    $('dlgSeed').textContent = plan.seed;
    $('dlgSource').textContent = night.archived ? 'nights.json, the archive this site keeps of every finished night (copied once from api.squeekchain.com/v1/measurement/stats and /v1/events, never changed)'
      : 'api.squeekchain.com/v1/measurement/stats and /v1/events';
    $('dlgSourceLink').href = night.archived ? 'https://github.com/Rooaraak/squeek-wheel-watch/blob/main/nights.json' : `${API}/v1/measurement/stats?range=30d`;
    $('dlgProvisional').hidden = night.archived || data.marksLoaded;
    $('dlgDay').textContent = plan.date;
    $('dlgCmd').textContent = `node verify.mjs ${plan.date}`;
    history.replaceState(null, '', `#night=${plan.date}`);
    return true;
  } catch (e) { console.warn('night', e.message); return false; }
}
function renderFacts(el, facts) {
  el.innerHTML = '';
  for (const [k, v] of facts) { const f = document.createElement('div'); f.className = 'fact'; f.innerHTML = '<div class="k"></div><div class="v"></div>'; f.firstChild.textContent = k; f.lastChild.textContent = v; el.append(f); }
}
function drawStrip(plan, night) {
  const svg = $('dlgStrip'), ns = 'http://www.w3.org/2000/svg', w = 480 / SLOTS;
  svg.innerHTML = '';
  svg.setAttribute('aria-label', `Turns per half hour from 12:00 to 12:00 UTC. ${runsText(plan)}`);
  const n = plan.palette.colors.length;
  night.slots.forEach((v, i) => {
    const h = Math.max(1.5, Math.min(1, (v ?? 0) / 1850) * 60);
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', (i * w + 0.8).toFixed(1)); r.setAttribute('width', (w - 1.6).toFixed(1));
    r.setAttribute('y', (64 - h).toFixed(1)); r.setAttribute('height', h.toFixed(1)); r.setAttribute('rx', '1.5');
    r.setAttribute('fill', (v ?? 0) > 0 ? plan.palette.colors[Math.round(Art.hourT(i) * (n - 1))] : 'var(--line)');
    const t = document.createElementNS(ns, 'title'); t.textContent = `${slotUtc(i)} UTC: ${v == null ? 'no data' : `${nf.format(v)} turns`}`; r.append(t);
    svg.append(r);
  });
}
function stopReplay() { clearTimeout(replayTimer); if (dlgCard) dlgCard.target = 0; }
function replay(card, plan) {
  stopReplay();
  card.setDrops([]); card.angle = 0;
  const drops = plan.drops, total = REDUCED ? 0 : 11000, step = drops.length ? total / drops.length : 0;
  let i = 0;
  const next = () => {
    if (i >= drops.length) { card.target = 0; kick(); return; }
    const d = drops[i++];
    card.add(d, { dur: 900 });
    card.target = (0.45 + d.omega) * TAU * 0.55;                // the card spins harder through his busiest half hours
    kick();
    replayTimer = setTimeout(next, step);
  };
  next();
}
$('dlgReplay').addEventListener('click', () => { if (dlgCard && dlgPlan) replay(dlgCard, dlgPlan); });
$('dlgClose').addEventListener('click', () => $('nightDialog').close());
$('nightDialog').addEventListener('close', () => { stopReplay(); if (/^#night=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); });
$('nightDialog').addEventListener('click', (e) => { if (e.target === $('nightDialog')) $('nightDialog').close(); });
$('dlgLink').addEventListener('click', () => copyText(`https://www.squeekwheel.xyz/#night=${dlgPlan.date}`, $('dlgLink'), 'Copy link'));
$('dlgVideo').addEventListener('click', () => dlgPlan && recordVideo({ plan: dlgPlan, label: Art.labelOf(dlgPlan), name: `squeek-spin-art-${dlgPlan.date}`,
  title: dlgPlan.title, sub: `Night of ${dateLabel(dlgPlan.date)} · ${nf.format(dlgPlan.stats.turns)} turns · squeekwheel.xyz` }, $('dlgVideo')));
for (const b of document.querySelectorAll('[data-wall]')) b.addEventListener('click', () => {
  if (!dlgPlan) return;
  const plan = dlgPlan;
  wallpaper({ kind: b.dataset.wall, name: `squeek-spin-art-${plan.date}-${b.dataset.wall}`, palette: plan.palette,
    draw: (x, cx, cy, R) => Art.paint(x, plan, { cx, cy, R, makeCanvas: mk }),
    lines: [plan.title, `Night of ${dateLabel(plan.date)}`, `${nf.format(plan.stats.turns)} wheel turns · ${km(plan.stats.distanceMm)} km`] }, b);
});

async function copyText(text, btn, label) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch { prompt('Copy this link', text); }
  setTimeout(() => { btn.textContent = label; }, 1600);
}

// ---------- downloads: wallpapers, profile pictures, videos ----------
async function wallpaper({ kind, name, palette, draw, lines }, btn) {
  const old = btn.textContent; btn.textContent = 'Painting…'; btn.disabled = true;
  await sleep(30);
  try {
    await Promise.allSettled([document.fonts.load('700 40px Inter'), document.fonts.load('600 20px "JetBrains Mono"')]);
    const [W, H] = { phone: [1290, 2796], desktop: [2560, 1440], square: [2048, 2048], pfp: [1024, 1024] }[kind];
    const c = mk(W, H), x = c.getContext('2d'), dark = Art.isDark(palette.card);
    const g = x.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.8);
    g.addColorStop(0, dark ? Art.mix(palette.card, '#ffffff', 0.08) : Art.mix(palette.card, '#ffffff', 0.4));
    g.addColorStop(1, dark ? Art.mix(palette.card, '#000000', 0.6) : Art.mix(palette.card, '#5a4a30', 0.22));
    x.fillStyle = kind === 'pfp' ? palette.card : g; x.fillRect(0, 0, W, H);
    const [cx, cy, R] = kind === 'phone' ? [W / 2, H * 0.4, W * 0.42] : kind === 'desktop' ? [W * 0.68, H / 2, H * 0.4] : kind === 'pfp' ? [W / 2, H / 2, W / 2] : [W / 2, H / 2, W * 0.44];
    if (kind !== 'pfp') { x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = R * 0.12; x.shadowOffsetY = R * 0.05; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fillStyle = palette.card; x.fill(); x.restore(); }
    draw(x, cx, cy, R);
    const ink = dark ? '#f3f1ea' : '#1b1712', sub = dark ? 'rgba(243,241,234,.66)' : 'rgba(27,23,18,.62)';
    const foot = 'squeekwheel.xyz · painted by a real hamster on Squeekchain';
    const fit = (text, weight, size, maxW) => { x.font = `${weight} ${size}px Inter, sans-serif`; const w = x.measureText(text).width; if (w > maxW) x.font = `${weight} ${size * (maxW / w)}px Inter, sans-serif`; };
    if (kind === 'phone') {
      x.textAlign = 'center'; let y = cy + R + H * 0.075;
      lines.forEach((t, i) => { fit(t, i ? 500 : 700, i ? W * 0.036 : W * 0.075, W * 0.88); x.fillStyle = i ? sub : ink; x.fillText(t, W / 2, y); y += i ? W * 0.055 : W * 0.075; });
      x.font = `500 ${W * 0.026}px "JetBrains Mono", monospace`; x.fillStyle = sub; x.fillText(foot, W / 2, H - H * 0.045);
    } else if (kind === 'desktop') {
      x.textAlign = 'left'; let y = H * 0.44; const maxW = cx - R - W * 0.08 - W * 0.03;
      lines.forEach((t, i) => { fit(t, i ? 500 : 700, i ? H * 0.032 : H * 0.07, maxW); x.fillStyle = i ? sub : ink; x.fillText(t, W * 0.08, y); y += i ? H * 0.05 : H * 0.075; });
      x.font = `500 ${H * 0.02}px "JetBrains Mono", monospace`; x.fillStyle = sub; x.fillText(foot, W * 0.08, H - H * 0.07);
    }
    await new Promise((resolve, reject) => c.toBlob((b) => (b ? (downloadBlob(b, `${name}.png`), resolve()) : reject(new Error('empty'))), 'image/png'));
  } catch (e) { console.warn('wallpaper', e.message); btn.textContent = 'Saving failed in this browser'; await sleep(2000); }
  finally { btn.textContent = old; btn.disabled = false; }
}
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const download = (canvas, name) => canvas.toBlob((b) => b && downloadBlob(b, name), 'image/png');

// A short video of the night painting itself (1080 × 1080): the card spins harder through his busiest half hours.
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const videoType = () => (window.MediaRecorder && HTMLCanvasElement.prototype.captureStream ? VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : null);
let recording = false;
async function recordVideo({ plan, img = null, label, name, title, sub }, btn) {
  if (recording) return;
  const type = videoType(), old = btn.textContent;
  if (!type) { btn.textContent = 'Video isn\'t supported in this browser'; await sleep(2500); btn.textContent = old; return; }
  recording = true; btn.disabled = true;
  let cleanup = () => {};
  try {
    await Promise.allSettled([document.fonts.load('700 40px Inter'), document.fonts.load('600 20px "JetBrains Mono"')]);
    const W = 1080, H = 1080, R = 430, cx = W / 2, cy = 492, S = R * 2, pal = plan.palette, dark = Art.isDark(pal.card);
    const c = mk(W, H), x = c.getContext('2d');
    c.style.cssText = 'position:fixed;left:-20000px;top:0;width:8px;height:8px;pointer-events:none';
    document.body.append(c);                                    // a canvas on the page captures reliably everywhere
    const back = mk(W, H), b = back.getContext('2d');
    const g = b.createRadialGradient(cx, cy, 0, cx, cy, W * 0.85);
    g.addColorStop(0, dark ? Art.mix(pal.card, '#ffffff', 0.08) : Art.mix(pal.card, '#ffffff', 0.4)); g.addColorStop(1, dark ? Art.mix(pal.card, '#000000', 0.6) : Art.mix(pal.card, '#5a4a30', 0.22));
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    b.save(); b.shadowColor = 'rgba(0,0,0,.45)'; b.shadowBlur = 50; b.shadowOffsetY = 20; b.beginPath(); b.arc(cx, cy, R, 0, TAU); b.fillStyle = pal.card; b.fill(); b.restore();
    b.textAlign = 'center'; b.fillStyle = dark ? '#f3f1ea' : '#1b1712';
    b.font = '700 52px Inter, sans-serif'; const tw = b.measureText(title).width; if (tw > W * 0.9) b.font = `700 ${52 * (W * 0.9) / tw}px Inter, sans-serif`;
    b.fillText(title, cx, 990);
    b.fillStyle = dark ? 'rgba(243,241,234,.66)' : 'rgba(27,23,18,.62)'; b.font = '500 28px Inter, sans-serif'; b.fillText(sub, cx, 1036);
    const bg = mk(S, S), bx = bg.getContext('2d'); bx.translate(R, R); Art.drawCard(bx, R, pal);
    const top = mk(S, S), tx = top.getContext('2d'); tx.translate(R, R);
    Art.drawFinish(tx, R, pal, mk); Art.drawFrame(tx, R, pal); Art.drawLabel(tx, R, pal, label); if (!img) Art.drawHub(tx, R, pal);
    const paintL = mk(S, S), px = paintL.getContext('2d'); px.translate(R, R); px.beginPath(); px.arc(0, 0, R * PAINT_EDGE, 0, TAU); px.clip();
    const drops = plan.drops, D = 9000, HOLD = 2600, GROW = 900, step = D / Math.max(1, drops.length);
    const stream = c.captureStream(0), track = stream.getVideoTracks()[0];   // 0 = we say when a frame is ready
    const manual = typeof track.requestFrame === 'function', live = manual ? stream : c.captureStream(30);
    const chunks = [], rec = new MediaRecorder(live, { mimeType: type, videoBitsPerSecond: 10e6 });
    cleanup = () => { c.remove(); for (const s of [stream, live]) s.getTracks().forEach((tr) => tr.stop()); };
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => { rec.onstop = r; });
    let angle = 0, speed = 0, baked = 0, t0 = null, last = 0;
    const drawFrame = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      while (baked < drops.length && t >= baked * step + GROW) Art.drawDrop(px, drops[baked++], R, pal, 1);
      const cur = Math.min(drops.length - 1, Math.floor(t / step));
      const target = t < D && drops.length ? (0.45 + drops[cur].omega) * TAU * 0.55 : 0;
      speed += (target - speed) * (1 - Math.exp(-dt / (target > speed ? 1.2 : 0.9)));
      if (t >= D && speed < 0.05) { speed = 0; const off = ((angle % TAU) + TAU) % TAU, d = off > Math.PI ? TAU - off : -off; angle += d * (1 - Math.exp(-dt / 0.35)); }
      angle += speed * dt;
      x.drawImage(back, 0, 0);
      x.save(); x.translate(cx, cy); x.rotate(angle);
      x.drawImage(bg, -R, -R); x.drawImage(paintL, -R, -R);
      x.save(); x.beginPath(); x.arc(0, 0, R * PAINT_EDGE, 0, TAU); x.clip();
      for (let i = baked; i < drops.length && i * step <= t; i++) Art.drawDrop(x, drops[i], R, pal, 1 - Math.pow(1 - Math.min(1, (t - i * step) / GROW), 2.2));
      x.restore();
      x.drawImage(top, -R, -R); x.restore();
      if (img) { x.save(); x.translate(cx, cy); Art.drawWindow(x, R, img, pal, plan.staked); x.restore(); }
    };
    drawFrame(0);
    rec.start(250);
    await new Promise((resolve) => {
      const tick = (nowT) => {
        if (t0 == null) { t0 = nowT; last = 0; }
        const t = nowT - t0;
        drawFrame(t); if (manual) track.requestFrame();
        btn.textContent = `Recording… ${Math.min(99, Math.round((t / (D + HOLD)) * 100))}%`;
        if (t >= D + HOLD) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    rec.stop(); await stopped;
    downloadBlob(new Blob(chunks, { type: type.split(';')[0] }), `${name}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
  } catch (e) { console.warn('video', e.message); btn.textContent = 'Recording failed'; await sleep(2000); }
  finally { cleanup(); recording = false; btn.disabled = false; btn.textContent = old; }
}

// ---------- Squeek portraits ----------
const portraits = {
  sq: null, nights: [], idx: 0, plan: null, featured: true, seq: 0,
  init() {
    $('ptForm').addEventListener('submit', (e) => { e.preventDefault(); this.lookup($('ptInput').value); });
    $('ptRandom').addEventListener('click', () => this.show(1 + Math.floor(Math.random() * data.issued), null, { note: 'A random Squeek.' }));
    $('ptPrev').addEventListener('click', () => { if (this.idx < this.nights.length - 1) { this.idx++; this.render(); } });
    $('ptNext').addEventListener('click', () => { if (this.idx > 0) { this.idx--; this.render(); } });
    for (const b of document.querySelectorAll('[data-ptwall]')) b.addEventListener('click', () => {
      if (!this.plan) return;
      const { plan, sq } = this;
      wallpaper({ kind: b.dataset.ptwall, name: `squeek-${sq.tokenId}-${plan.date}-${b.dataset.ptwall}`, palette: plan.palette,
        draw: (x, cx, cy, R) => Art.paintPortrait(x, plan, sq.img, { cx, cy, R, makeCanvas: mk }),
        lines: [`Squeek #${sq.tokenId}`, `Painted by Squeektoshi · night of ${dateLabel(plan.date)}`, `${nf.format(plan.turns)} wheel turns · level ${plan.level}${plan.staked ? ' · staked' : ''}`] }, b);
    });
    $('ptVideo').addEventListener('click', () => this.plan && recordVideo({ plan: this.plan, img: this.sq.img, label: Art.portraitLabel(this.plan),
      name: `squeek-${this.sq.tokenId}-${this.plan.date}`, title: `Squeek #${this.sq.tokenId}`, sub: `Painted by Squeektoshi · night of ${dateLabel(this.plan.date)} · squeekwheel.xyz` }, $('ptVideo')));
    $('ptLink').addEventListener('click', () => this.sq && copyText(`https://www.squeekwheel.xyz/#squeek=${this.sq.tokenId}`, $('ptLink'), 'Copy link'));
    new ResizeObserver(() => this.paint()).observe($('ptCanvas').parentElement);
    this.show(this.ofTheNight(), null, { note: 'This is the Squeek of the night. Look up yours by its number or your wallet.', featured: true });
  },
  ofTheNight() { const day = Math.floor(Date.parse(`${now().date}T00:00:00Z`) / 86400e3); return 1 + ((day * 7919) % data.issued); },
  hint(text) { $('ptHint').textContent = text; },
  async lookup(q, night = null) {
    ++this.seq;                                                   // whatever was loading before is no longer wanted
    q = String(q ?? '').trim();
    if (/^#?\d{1,6}$/.test(q)) return this.show(Number(q.replace('#', '')), night, { note: '' });
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) return this.wallet(q.toLowerCase());
    this.hint('Type a Squeek number like 4242, or a wallet address that starts with 0x.');
  },
  async wallet(addr) {
    const seq = ++this.seq;
    this.hint('Looking up that wallet…'); $('ptList').innerHTML = '';
    try {
      const j = await getJSON(`/v1/accounts/${addr}?limit=100`);
      if (seq !== this.seq) return;
      const tokens = j.tokens ?? [];
      if (!tokens.length) { this.hint('That wallet holds no Squeeks on Squeekchain yet.'); history.replaceState(null, '', location.pathname + location.search); return; }
      const list = $('ptList');
      for (const t of tokens) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'chip';
        b.textContent = `#${t.tokenId} · L${t.level}${t.custody === 'staking' ? ' · staked' : ''}`;
        b.addEventListener('click', () => this.show(Number(t.tokenId), this.plan?.date ?? null, { note: '' }));
        list.append(b);
      }
      const more = Number(j.tokenCounts?.staking ?? 0) + Number(j.tokenCounts?.wallet ?? 0) > tokens.length ? ' (first 100 shown)' : '';
      history.replaceState(null, '', `#holder=${addr}`);
      await this.show(Number(tokens[0].tokenId), null, { note: `${tokens.length} Squeek${tokens.length === 1 ? '' : 's'} in that wallet${more}. Tap one to see it.`, keepHash: true });
    } catch (e) { if (seq === this.seq) this.hint(/400/.test(e.message) ? 'That doesn\'t look like a wallet address.' : 'Couldn\'t reach Squeekchain. Try again in a moment.'); }
  },
  async show(id, night = null, { note = '', featured = false, keepHash = false } = {}) {
    const seq = ++this.seq;
    if (!(id >= 1 && id <= 99999)) { this.hint('Squeek numbers start at 1.'); return; }
    this.hint(`Fetching Squeek #${id}…`);
    try {
      let j = null;
      for (let tries = 0; tries < (featured ? 5 : 1); tries++) {
        j = await getJSON(`/v1/squeeks/${id}`).catch((e) => ({ error: e.message }));
        if (j?.metadata?.imageDataUri && !j.custody?.burned) break;
        if (!featured) break;
        id = (id % data.issued) + 1;
      }
      if (seq !== this.seq) return;
      if (!j?.metadata?.imageDataUri) { this.hint(/400|404/.test(j?.error ?? '') ? `There's no Squeek #${id}.` : 'Couldn\'t reach Squeekchain. Try again in a moment.'); return; }
      if (j.custody?.burned) { this.hint(`Squeek #${id} was merged into another Squeek, so it has no card any more.`); return; }
      const uri = j.metadata.imageDataUri, svg = uri.startsWith('data:image/svg+xml;base64,') ? new TextDecoder().decode(Uint8Array.from(atob(uri.split(',')[1]), (ch) => ch.charCodeAt(0))) : '';
      const img = new Image(); img.src = uri; await img.decode();
      if (seq !== this.seq) return;
      const traits = Object.fromEntries((j.metadata.attributes ?? []).map((a) => [a.traitType, a.value]));
      this.sq = { tokenId: String(j.tokenId ?? id), level: Number(j.level) || 1, staked: !!j.custody?.depositor, img, traits, palette: Art.squeekPalette(String(j.tokenId ?? id), svg) };
      this.nights = finishedNights();
      const at = night ? this.nights.findIndex((p) => p.date === night) : -1;
      this.idx = at >= 0 ? at : 0;
      this.featured = featured;
      this.hint(note);
      if (!featured && !keepHash) history.replaceState(null, '', `#squeek=${this.sq.tokenId}`);
      this.render();
    } catch (e) { if (seq === this.seq) this.hint('Couldn\'t draw that Squeek. Try another one.'); console.warn('squeek', e.message); }
  },
  render() {
    const sq = this.sq, np = this.nights[this.idx];
    if (!sq) return;
    if (!np) { this.plan = null; this.hint('No finished nights to paint yet.'); return; }
    this.plan = Art.planPortrait(sq, nightOf(np.date));
    $('ptNight').textContent = `Night of ${dateLabel(np.date)}`;
    $('ptPrev').disabled = this.idx >= this.nights.length - 1; $('ptNext').disabled = this.idx <= 0;
    renderFacts($('ptFacts'), [
      ['Squeek', `#${sq.tokenId}`], ['Level', String(sq.level)],
      ['Status', sq.staked ? 'Staked, mining' : 'In a wallet'], ['Palette', sq.traits.Palette ?? '–'],
    ]);
    const url = `https://www.squeekwheel.xyz/#squeek=${sq.tokenId}`;
    const text = `Squeek #${sq.tokenId}, painted by Squeektoshi's run on the night of ${dateLabel(np.date)} 🐹🎨\n\nEvery Squeek gets a new painting every night, from @squeekchain's own data:`;
    $('ptShare').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    $('ptCanvas').setAttribute('aria-label', `Portrait of Squeek #${sq.tokenId}, level ${sq.level}${sq.staked ? ', staked' : ''}, painted by the night of ${dateLabel(np.date)}: ${nf.format(this.plan.turns)} wheel turns. ${runsText(np)}`);
    this.paint();
  },
  paint() {
    if (!this.plan) return;
    const c = $('ptCanvas'), px = Math.max(64, Math.round(c.parentElement.clientWidth * DPR));
    if (c.width !== px) c.width = c.height = px;
    const x = c.getContext('2d'); x.clearRect(0, 0, px, px);
    Art.paintPortrait(x, this.plan, this.sq.img, { cx: px / 2, cy: px / 2, R: px / 2, makeCanvas: mk });
  },
};

// ---------- Paint with Squeektoshi ----------
const toy = {
  card: null, color: null, palette: null, src: 'live', pour: null, drops: [], waiting: [], lastIdx: 0, lastTimer: 0, lastSlots: [], omega: 0, rpm: 0,
  init() {
    this.card = new Card($('toyCanvas'));
    this.setPalette(Art.paletteOf(now().date));
    const cv = $('toyCanvas');
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointerup', (e) => this.up(e));
    cv.addEventListener('pointercancel', (e) => this.cancel(e));      // a scroll took over: forget the pour
    cv.addEventListener('contextmenu', (e) => e.preventDefault());    // long-press shouldn't open a menu
    cv.addEventListener('keydown', (e) => {                           // keyboard: Enter or Space drops paint somewhere on the card
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const a = Math.random() * TAU, r = 0.15 + Math.random() * 0.5;
      this.place(r * Math.cos(a), r * Math.sin(a), 0.5 + Math.random() * 0.5, `${Date.now()}|${Math.random()}`);
    });
    $('srcLive').addEventListener('click', () => { this.chosen = true; this.setSrc('live'); });
    $('srcLast').addEventListener('click', () => { this.chosen = true; this.setSrc('last'); });
    $('toyUndo').addEventListener('click', () => this.undo());
    $('toyClear').addEventListener('click', () => { this.drops = []; this.waiting = []; this.card.clearPaint(); this.buttons(); });
    $('toySave').addEventListener('click', () => {
      const n = this.drops.length + this.waiting.length;
      download(this.card.snapshot(2048, `You × Squeektoshi · ${dateLabel(now().date)} · ${n} drop${n === 1 ? '' : 's'} · squeekwheel.xyz`), 'squeek-spin-art-with-squeektoshi.png');
    });
    const picker = $('cardPicker');
    for (const p of PALETTES) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cardpick'; b.title = `${p.name} card`; b.setAttribute('aria-label', `${p.name} card`); b.dataset.name = p.name;
      b.style.background = `radial-gradient(circle, ${p.card} 0 42%, transparent 43%), conic-gradient(${p.colors.map((c, i) => `${c} ${(i / p.colors.length) * 100}% ${((i + 1) / p.colors.length) * 100}%`).join(',')})`;
      b.addEventListener('click', () => this.setPalette(p)); picker.append(b);
    }
    this.onStatus();
  },
  setPalette(p) {
    this.palette = p;
    this.card.setCard(p, `You × Squeektoshi · ${dateLabel(now().date)}`);
    this.card.baked = this.drops.filter((d) => !this.card.wet.some((w) => w.drop === d)); this.card.rebake(); this.card.touch();
    for (const b of $('cardPicker').children) b.setAttribute('aria-pressed', String(b.dataset.name === p.name));
    const sw = $('swatches'); sw.innerHTML = '';
    [...p.colors, GOLD].forEach((c, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.style.background = c; b.dataset.color = c;
      b.setAttribute('aria-label', c === GOLD ? 'Gold paint' : `Paint colour ${i + 1}`);
      b.addEventListener('click', () => this.setColor(c)); sw.append(b);
    });
    this.setColor(p.colors.includes(this.color) || this.color === GOLD ? this.color : p.colors[2]);
  },
  setColor(c) { this.color = c; for (const b of $('swatches').children) b.setAttribute('aria-pressed', String(b.dataset.color === c)); },
  setSrc(src) {
    if (src === 'last' && !this.lastSlots.length) return;
    this.src = src; $('srcLive').setAttribute('aria-pressed', String(src === 'live')); $('srcLast').setAttribute('aria-pressed', String(src === 'last'));
    $('toyHint').textContent = 'Tap the card to drop paint';
    clearTimeout(this.lastTimer);
    if (src === 'last') { this.lastIdx = 0; this.stepLast(); } else this.onStatus();
  },
  stepLast() {
    const s = this.lastSlots[this.lastIdx % this.lastSlots.length]; this.lastIdx++;
    this.omega = Math.min(1.15, s.w / 1800); this.rpm = s.w / 30;     // a half hour's turns ÷ 30 minutes = its average rpm
    this.card.target = (this.rpm / 60) * TAU * VISUAL; kick();
    $('srcHint').textContent = `Last night at ${slotUtc(s.i)} UTC he made ${nf.format(s.w)} turns in half an hour.`;
    this.render(); this.flingWaiting();
    this.lastTimer = setTimeout(() => this.stepLast(), 3500);
  },
  onStatus() {
    if (!this.card) return;
    const last = finishedNights()[0];
    this.lastSlots = last ? nightOf(last.date).slots.map((w, i) => ({ w: w ?? 0, i })).filter((s) => s.w > 0) : [];
    $('srcLast').disabled = !this.lastSlots.length;
    // While he rests, start on last night's speeds so the first tap flies; switch to live once he runs (unless chosen).
    if (!this.chosen && this.lastSlots.length && data.status) {
      const want = liveRpm() > 0 ? 'live' : 'last';
      if (want !== this.src) { this.setSrc(want); return; }
    }
    if (this.src !== 'live') return;
    this.rpm = liveRpm(); this.omega = Math.min(1.15, this.rpm / 95);
    this.card.target = this.rpm > 0 ? (this.rpm / 60) * TAU * VISUAL : 0; kick();
    const start = typicalStart();
    $('srcHint').textContent = this.rpm > 0 ? 'Your card is on his wheel right now. Drop paint and watch it fly.'
      : `He's resting, so your paint will sit still until he runs${start == null ? '' : ` (usually from about ${localTimeOfUtcMinute(start)} your time)`}. Or try last night's speeds.`;
    this.render(); this.flingWaiting();
  },
  render() {
    const running = this.src === 'last' || this.rpm > 0;
    $('toyState').textContent = this.src === 'last' ? 'Replaying last night' : !data.status ? (data.statusFailed ? 'No signal' : 'Connecting…') : running ? 'He is running' : 'He is resting';
    $('toyPill').classList.toggle('is-running', running);
    $('toySpeed').textContent = running ? `${Math.round(this.rpm)} rpm` : '';
  },
  down(e) {
    if (this.pour) return;                                      // one pour at a time (a second finger is ignored)
    const [x, y] = this.card.toCard(e), r = Math.hypot(x, y);
    if (r > PAINT_EDGE * 0.97 || r < 0.08) return;
    e.preventDefault(); this.card.canvas.setPointerCapture?.(e.pointerId);
    const seed = `${Date.now()}|${Math.random()}`;
    this.pour = { x, y, t0: performance.now(), seed, id: e.pointerId };
    this.pour.preview = { drop: this.blobDrop(x, y, 0.35, seed), keepWet: true };
    this.card.wet.push(this.pour.preview); this.card.touch();
    const grow = () => {
      if (!this.pour) return;
      this.pour.preview.drop = this.blobDrop(this.pour.x, this.pour.y, this.vol(), this.pour.seed);
      this.card.touch(); requestAnimationFrame(grow);
    };
    requestAnimationFrame(grow);
    $('toyHint').textContent = 'Hold to pour more paint';
  },
  vol() { return Math.min(1.35, 0.35 + ((performance.now() - this.pour.t0) / 1000) * 0.9); },
  up(e) {
    if (!this.pour || e.pointerId !== this.pour.id) return;
    const p = this.pour, vol = this.vol(); this.pour = null;
    removeFrom(this.card.wet, p.preview);
    this.place(p.x, p.y, vol, p.seed);
  },
  cancel(e) {
    if (!this.pour || e.pointerId !== this.pour.id) return;
    removeFrom(this.card.wet, this.pour.preview); this.pour = null; this.card.touch();
  },
  place(x, y, vol, seed) {
    if (this.omega >= 0.08) this.fling(x, y, vol, seed);
    else { const w = { drop: this.blobDrop(x, y, vol, seed), keepWet: true, spec: { x, y, vol, color: this.color, seed } }; this.waiting.push(w); this.card.wet.push(w); this.card.touch(); }
    $('toyHint').textContent = this.omega >= 0.08 ? 'Tap again, or hold to pour more' : 'Your paint is waiting for him to run';
    this.buttons();
  },
  // The preview and the flung drop share a seed, so the blob keeps its shape when the trails fly out.
  blobDrop(x, y, vol, seed, color = this.color) { const d = Art.dropAt(Art.rng(Art.sha256Hex(seed)), { color, gold: color === GOLD, x0: x, y0: y, vol, omega: 0 }); d.fingers = []; return d; },
  fling(x, y, vol, seed, color = this.color) {
    const d = Art.dropAt(Art.rng(Art.sha256Hex(seed)), { color, gold: color === GOLD, x0: x, y0: y, vol, omega: Math.max(0.15, this.omega) });
    this.drops.push(d); this.card.add(d, { dur: 1200 + 500 * this.omega });
  },
  flingWaiting() {
    if (this.omega < 0.08 || !this.waiting.length) return;
    for (const w of this.waiting) { removeFrom(this.card.wet, w); this.fling(w.spec.x, w.spec.y, w.spec.vol, w.spec.seed, w.spec.color); }
    this.waiting = []; this.buttons();
  },
  undo() {
    if (this.waiting.length) removeFrom(this.card.wet, this.waiting.pop());
    else if (this.drops.length) {
      const d = this.drops.pop();
      this.card.wet = this.card.wet.filter((w) => w.drop !== d); this.card.baked = this.card.baked.filter((b) => b !== d); this.card.rebake();
    }
    this.card.touch(); this.buttons();
  },
  buttons() { const any = this.drops.length + this.waiting.length > 0; for (const id of ['toyUndo', 'toyClear', 'toySave']) $(id).disabled = !any; },
};

// ---------- stream overlay link ----------
function overlaySrc() { const t = document.documentElement.dataset.theme; return `${location.pathname}?overlay=art&preview=1${t ? `&theme=${t}` : ''}`; }
$('copyOverlay')?.addEventListener('click', () => copyText($('overlayUrl').value, $('copyOverlay'), 'Copy'));
$('copyCorner')?.addEventListener('click', () => copyText($('cornerUrl').value, $('copyCorner'), 'Copy'));

// ---------- links: #night=YYYY-MM-DD, #squeek=N[&night=…], #holder=0x… ----------
function routeHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('squeek') || h.get('holder')) { $('squeeks').scrollIntoView({ block: 'start' }); portraits.lookup(h.get('squeek') ?? h.get('holder'), h.get('night')); }
  else if (h.get('night')) openNight(h.get('night'));
}

// ---------- start ----------
async function start() {
  if (OVERLAY) {
    document.documentElement.classList.add('overlay-mode');
    if (CORNER) document.documentElement.classList.add('corner');
    live.cards.push(new Card($('ovCanvas')));
  } else {
    live.cards.push(new Card($('heroCanvas')));
    toy.init();
    $('replayHero').addEventListener('click', () => { const last = finishedNights()[0]; if (last && openNight(last.date)) replay(dlgCard, last); });
    $('overlayFrame').src = overlaySrc();
    const nb = $('notifyBtn'), setNb = () => { nb.textContent = store.get('sart-notify') === '1' && Notification.permission === 'granted' ? 'I\'ll tell you when he starts' : 'Tell me when he starts'; };
    if (!('Notification' in window)) nb.hidden = true;
    else { setNb(); nb.addEventListener('click', async () => {
      if (store.get('sart-notify') === '1') store.set('sart-notify', '0');
      else if ((await Notification.requestPermission()) === 'granted') store.set('sart-notify', '1');
      setNb();
    }); }
  }
  pollStatus();                                                 // the live wheel doesn't wait for the history
  await Promise.allSettled([document.fonts.load('600 20px "JetBrains Mono"'), document.fonts.load('700 20px Inter'), loadArchive()]);
  try { refreshLive(); } catch (e) { console.warn('render', e.message); }
  for (let attempt = 0; ; attempt++) {
    try { await loadStats('30d'); data.loaded = true; data.error = null; break; }
    catch (e) {
      data.error = e; updateGallery(true);
      if (Object.keys(data.archive).length) break;                // the archive is enough to show the gallery; pollStats keeps trying
      await sleep(Math.min(60e3, 5000 * (attempt + 1)));
    }
  }
  try { await loadMarks(); } catch (e) { console.warn('marks', e.message); }
  try { const eco = await getJSON('/v1/economy/state'); if (Number(eco?.nft?.issued) > 0) data.issued = Number(eco.nft.issued); } catch {}
  try { refreshLive(); } catch (e) { console.warn('render', e.message); }
  if (!OVERLAY) {
    updateGallery(true); toy.onStatus(); portraits.init();
    routeHash(); window.addEventListener('hashchange', routeHash);
  }
  statsTimer = setTimeout(pollStats, data.loaded && data.marksLoaded ? 120e3 : 30e3);
}
if (params.has('debug')) window.sart = { live, data, cards, refreshLive, portraits, toy };   // for tests
if (!MOVED) start();
