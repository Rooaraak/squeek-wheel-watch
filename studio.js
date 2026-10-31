// Squeek Spin Art: the page. Live card, gallery, night view with replay and wallpapers, "Paint with Squeektoshi",
// and the ?overlay=art stream source. All data comes from the public Squeekchain API; nothing is stored anywhere.
import * as Art from './art.js';

const { API, SLOTS, PAINT_EDGE, PALETTES, GOLD } = Art;
const TAU = Math.PI * 2;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const OVERLAY = params.get('overlay') === 'art';
const MOVED = params.has('overlay') && !OVERLAY;               // the old live-speed overlay moved to /watch/
if (MOVED) location.replace(`watch/${location.search}`);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DPR = Math.min(2, window.devicePixelRatio || 1);
const nf = new Intl.NumberFormat('en-US');
const VISUAL = 0.3;          // the card turns at 30 % of the wheel's real rpm, fast enough to feel it, slow enough to watch
const WET_STEP = 450;        // while he runs, a drop of wet paint lands every 450 turns until the half hour is published
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
const ago = (iso) => { const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };
function runsText(plan) {
  if (!plan.runs.length) return 'He did not run.';
  const parts = plan.runs.map((r) => `${slotUtc(r.start)} to ${slotUtc((r.end + 1) % SLOTS)}`);
  return `He ran ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]} UTC.`;
}
const describe = (plan) => `Spin-art painting "${plan.title}", ${plan.palette.name} colours, night of ${dateLabel(plan.date)}: ${nf.format(plan.stats.turns)} wheel turns. ${runsText(plan)}`;

// ---------- data ----------
async function getJSON(path) {
  const r = await fetch(`${API}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return r.json();
}
const data = { days: new Map(), marks: [], status: null, typical: null, loaded: false, error: null };

async function loadStats(range) {
  const s = await getJSON(`/v1/measurement/stats?range=${range}`);
  for (const d of s.activity.days) data.days.set(d.date, d);
  if (range === '30d') data.typical = s.activity.typicalDay;
}
async function loadMarks() {
  const events = []; let cursor = null;
  for (let page = 0; page < 12; page++) {
    const q = new URLSearchParams({ category: 'measurement', limit: '100' }); if (cursor) q.set('cursor', cursor);
    const j = await getJSON(`/v1/events?${q}`);
    events.push(...j.events); cursor = j.nextCursor;
    if (!cursor || !j.events.length) break;
  }
  data.marks = Art.marksFromEvents(events);
}
function nightOf(date, { closedOnly = false } = {}) {
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
function finishedNights() {
  const tonight = now().date;
  return [...data.days.keys()].filter((d) => d < tonight).sort().reverse()
    .map((d) => planOf(nightOf(d))).filter((p) => p.stats.turns > 0);
}
function typicalStart() {
  if (!data.typical) return null;
  const byMin = new Map(data.typical.map((b) => [b.startMinuteUtc, Number(b.meanWorkMilli) / 1000]));
  for (let i = 0; i < SLOTS; i++) { const m = (720 + i * 30) % 1440; if ((byMin.get(m) ?? 0) >= 300) return m; }
  return null;
}
const isRunning = (st) => {
  if (!st) return false;
  const m = st.measurement, stale = (Date.now() - Date.parse(m.observedAt)) / 1000 > Number(m.staleAfterSeconds);
  return !stale && m.coreStatus !== 'IDLE' && m.speedMmPerSecond > 0;
};
const isStale = (st) => st && (Date.now() - Date.parse(st.measurement.observedAt)) / 1000 > Number(st.measurement.staleAfterSeconds);
const liveRpm = () => (isRunning(data.status) ? data.status.measurement.rpmMilli / 1000 : 0);

// ---------- a card on screen: layers, spin, wet paint ----------
const cards = new Set();
let rafId = 0, lastT = 0;
function kick() { if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(loop); } }
function loop(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  let busy = false;
  for (const c of cards) busy = c.frame(dt, t) || busy;
  rafId = busy ? requestAnimationFrame(loop) : 0;
}

class Card {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.angle = 0; this.speed = 0; this.target = 0;
    this.baked = []; this.wet = []; this.palette = PALETTES[0]; this.label = '';
    this.onScreen = true;
    cards.add(this);
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => { this.onScreen = e.isIntersecting; if (this.onScreen) { this.draw(); kick(); } }).observe(canvas);
  }
  get R() { return this.px / 2; }
  resize() {
    const px = Math.max(64, Math.round((this.canvas.clientWidth || 400) * DPR));
    if (px === this.px) return;
    this.px = px; this.canvas.width = this.canvas.height = px;
    this.buildLayers(); this.rebake(); this.draw();
  }
  setCard(palette, label) { this.palette = palette; this.label = label; if (this.px) { this.buildLayers(); this.rebake(); this.draw(); } }
  setLabel(label) { if (label === this.label) return; this.label = label; if (this.px) { this.buildTop(); this.draw(); } }
  buildLayers() {
    const px = this.px, R = this.R;
    this.bg = mk(px, px); const b = this.bg.getContext('2d'); b.translate(R, R); Art.drawCard(b, R, this.palette);
    this.paintLayer = mk(px, px);
    this.buildTop();
  }
  buildTop() {
    const px = this.px, R = this.R;
    this.top = mk(px, px); const t = this.top.getContext('2d'); t.translate(R, R);
    Art.drawFinish(t, R, this.palette, mk); Art.drawFrame(t, R, this.palette);
    if (this.label) Art.drawLabel(t, R, this.palette, this.label);
    Art.drawHub(t, R, this.palette);
  }
  rebake() {
    if (!this.px) return;
    const p = this.paintLayer.getContext('2d'); p.setTransform(1, 0, 0, 1, 0, 0); p.clearRect(0, 0, this.px, this.px);
    for (const d of this.baked) this.bakeOne(d);
  }
  bakeOne(d) {
    const p = this.paintLayer.getContext('2d'), R = this.R;
    p.save(); p.translate(R, R); p.beginPath(); p.arc(0, 0, R * PAINT_EDGE, 0, TAU); p.clip();
    Art.drawDrop(p, d, R, this.palette, 1); p.restore();
  }
  setDrops(drops) { this.baked = [...drops]; this.wet = []; this.rebake(); this.draw(); }
  add(drop, { dur = 1300, delay = 0, keepWet = false, tag = null } = {}) {
    if (REDUCED && !keepWet) { this.baked.push(drop); if (this.px) this.bakeOne(drop); this.draw(); return; }
    this.wet.push({ drop, t0: performance.now() + delay, dur, keepWet, tag }); kick();
  }
  clearPaint() { this.baked = []; this.wet = []; this.rebake(); this.draw(); }
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
      if (w.keepWet) continue;
      if (t >= w.t0 + w.dur) { this.wet.splice(this.wet.indexOf(w), 1); this.baked.push(w.drop); this.bakeOne(w.drop); }
    }
    if (this.wet.some((w) => !w.keepWet)) busy = true;
    if (this.onScreen) this.draw(t);
    return busy || target > 0;
  }
  draw(t = performance.now()) {
    if (!this.px || !this.bg) return;
    const c = this.ctx, R = this.R;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.px, this.px);
    c.translate(R, R); c.rotate(this.angle); c.translate(-R, -R);
    c.drawImage(this.bg, 0, 0); c.drawImage(this.paintLayer, 0, 0);
    if (this.wet.length) {
      c.save(); c.translate(R, R); c.beginPath(); c.arc(0, 0, R * PAINT_EDGE, 0, TAU); c.clip();
      for (const w of this.wet) {
        const k = w.keepWet ? 1 : Math.max(0, Math.min(1, (t - w.t0) / w.dur));
        if (k > 0 || w.keepWet) Art.drawDrop(c, w.drop, R, this.palette, 1 - Math.pow(1 - k, 2.2));
      }
      c.restore();
    }
    c.drawImage(this.top, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Card coordinates (radius 1) of a pointer event, undoing the spin.
  toCard(e) {
    const r = this.canvas.getBoundingClientRect();
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
// While tonight has paint, it shows tonight: published half hours as dry paint, the open half hour as wet paint that
// lands every WET_STEP turns. Before he starts, it shows last night's finished painting.
const live = { cards: [], mode: null, date: null, slot: null, base: null, wetCount: 0, wetDrops: [], plan: null, canonicalKey: '' };

function liveView() {
  const { date } = now();
  const tonight = planOf(nightOf(date, { closedOnly: true }));
  const hasWet = live.wetDrops.some((w) => w.date === date);
  if (tonight.stats.turns > 0 || hasWet || isRunning(data.status)) return { mode: 'tonight', plan: tonight, date };
  const last = finishedNights()[0];
  return last ? { mode: 'last', plan: last, date: last.date } : { mode: 'tonight', plan: tonight, date };
}
function tonightLabel(plan) {
  return `Tonight · ${dateLabel(plan.date)} · still painting · ${nf.format(plan.stats.turns + liveWetTurns())} turns so far`;
}
function liveWetTurns() { return live.base == null || !data.status ? 0 : Math.max(0, Number(data.status.measurement.cumulativeWorkUnits) - live.base); }

function refreshLive() {
  const v = liveView();
  const key = `${v.mode}|${v.plan.date}|${v.plan.seed}`;
  const label = v.mode === 'tonight' ? tonightLabel(v.plan) : Art.labelOf(v.plan);
  if (key !== live.canonicalKey) {
    const prev = live.plan, first = !live.canonicalKey;
    live.canonicalKey = key; live.mode = v.mode; live.plan = v.plan;
    const published = new Set(v.plan.drops.map((d) => d.slot));
    const wet = v.mode === 'tonight' ? live.wetDrops.filter((w) => w.date === v.plan.date && !published.has(w.slot)).map((w) => w.drop) : [];
    // Half hours already on the card keep their paint; newly published ones fly in. Wet paint stays until its half hour is published.
    const sameCard = prev && prev.date === v.plan.date && live.mode === v.mode;
    const oldSlots = new Set(sameCard ? prev.drops.map((d) => d.slot) : []);
    const fresh = first || !sameCard ? v.plan.drops : v.plan.drops.filter((d) => !oldSlots.has(d.slot));
    const kept = v.plan.drops.filter((d) => !fresh.includes(d));
    for (const c of live.cards) {
      c.setCard(v.plan.palette, label);
      c.setDrops([...kept, ...wet]);
      fresh.forEach((d, i) => c.add(d, { delay: i * Math.min(160, 4000 / fresh.length), dur: 900 }));
      c.canvas.setAttribute('aria-label', v.mode === 'tonight' ? `Tonight's card, still being painted. ${nf.format(v.plan.stats.turns)} turns so far.` : describe(v.plan));
    }
  } else for (const c of live.cards) c.setLabel(label);
  renderLiveText(v);
}

// New turns in the open half hour become wet paint.
function liveWet() {
  if (!data.status || live.mode !== 'tonight') return;
  const { date, slot } = now(), cum = Number(data.status.measurement.cumulativeWorkUnits);
  if (live.date !== date || live.slot !== slot || live.base == null) { live.date = date; live.slot = slot; live.base = cum; live.wetCount = 0; return; }
  if (!isRunning(data.status) && live.wetCount === 0) return;
  const want = Math.floor((cum - live.base) / WET_STEP);
  const palette = Art.paletteOf(date), rpm = liveRpm();
  while (live.wetCount < want) {
    const r = Art.rng(Art.sha256Hex(`live|${date}|${slot}|${live.wetCount}`));
    const th = Art.slotAngle(slot) + (r() - 0.5) * (TAU / 24) * 1.3, r0 = 0.13 + 0.5 * Math.pow(r(), 1.25);
    const n = palette.colors.length, color = palette.colors[Math.max(0, Math.min(n - 1, Math.round(Art.hourT(slot) * (n - 1) + (r() - 0.5) * 1.4)))];
    const drop = { slot, ...Art.dropAt(r, { color, x0: r0 * Math.cos(th), y0: r0 * Math.sin(th), vol: 0.5 + 0.4 * r(), omega: Math.min(1.15, Math.max(0.35, rpm / 95)) }) };
    live.wetDrops = [...live.wetDrops.filter((w) => w.date === date), { date, slot, drop }];
    for (const c of live.cards) c.add(drop, { dur: 1600 });
    live.wetCount++;
  }
}

function renderLiveText(v) {
  const st = data.status, running = isRunning(st), stale = isStale(st);
  for (const el of [$('hero'), $('pill'), $('ovCap')]) { el?.classList.toggle('is-running', running); el?.classList.toggle('is-stale', !!stale); }
  const turnsTonight = (v.mode === 'tonight' ? v.plan.stats.turns : 0) + liveWetTurns();
  const stateText = !st ? 'Connecting…' : stale ? 'Sensor offline' : running ? 'Painting now' : 'Resting';
  const start = typicalStart(), startText = start == null ? '' : `He usually starts around ${localTimeOfUtcMinute(start)} your time.`;
  if (OVERLAY) {
    if (params.get('caption') === '0') $('ovCap').hidden = true;
    $('ovText').textContent = running ? `Squeektoshi is painting · ${nf.format(turnsTonight)} turns tonight`
      : v.mode === 'tonight' && turnsTonight > 0 ? `Resting · ${nf.format(turnsTonight)} turns on tonight's card`
      : v.plan ? `Last night: ${v.plan.title} · squeekwheel.xyz` : 'Squeek Spin Art · squeekwheel.xyz';
    return;
  }
  $('pillText').textContent = stateText;
  $('headline').textContent = running ? 'Squeektoshi is painting right now' : stale ? 'The wheel sensor is offline' : 'Squeektoshi paints every night';
  document.title = running ? '🐹🎨 Painting now · Squeek Spin Art' : 'Squeek Spin Art · Paintings by the hamster that mines Squeekchain';
  $('rpm').textContent = st ? (st.measurement.rpmMilli / 1000).toFixed(0) : '–';
  $('tonightTurns').textContent = nf.format(turnsTonight);
  const day = data.days.get(now().date);
  $('tonightKm').textContent = km(day?.distanceMm ?? 0);
  $('sensor').textContent = st ? `sensor read ${ago(st.measurement.observedAt)}` : '';
  const cap = $('heroCaption');
  if (v.mode === 'last') {
    cap.innerHTML = '';
    const b = document.createElement('b'); b.textContent = `Last night: ${v.plan.title}.`;
    cap.append(b, ` ${nf.format(v.plan.stats.turns)} turns, ${km(v.plan.stats.distanceMm)} km. Tonight's card is still blank. ${startText}`);
    $('replayHeroText').textContent = 'Replay last night';
  } else {
    cap.textContent = running ? 'Tonight\'s card is spinning at his real speed. Wet paint lands as he runs and dries into the painting each half hour.'
      : turnsTonight > 0 ? `Tonight's card so far: ${nf.format(turnsTonight)} turns. It spins again as soon as he gets back on the wheel.`
      : `Tonight's card is blank so far. ${startText}`;
    $('replayHeroText').textContent = 'Replay last night';
  }
}

function applySpin() {
  const rpm = liveRpm();
  for (const c of live.cards) { c.target = rpm > 0 ? (rpm / 60) * TAU * VISUAL : 0; }
  kick();
}

// ---------- polling ----------
let statusTimer = 0, statsTimer = 0, lastRunAt = 0;
async function pollStatus() {
  clearTimeout(statusTimer);
  if (!document.hidden) {
    try {
      data.status = await getJSON('/v1/status');
      if (isRunning(data.status)) lastRunAt = Date.now();
      liveWet(); refreshLive(); applySpin(); toy.onStatus();
    } catch (e) { console.warn('status', e.message); }
  }
  statusTimer = setTimeout(pollStatus, isRunning(data.status) ? 5000 : 15000);
}
async function pollStats() {
  clearTimeout(statsTimer);
  if (!document.hidden) {
    try { await loadStats('7d'); if (Date.now() - lastRunAt < 40 * 60e3) await loadMarks(); refreshLive(); }
    catch (e) { console.warn('stats', e.message); }
  }
  statsTimer = setTimeout(pollStats, Date.now() - lastRunAt < 40 * 60e3 ? 120e3 : 600e3);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollStatus(); } });

// ---------- gallery ----------
function renderGallery() {
  const grid = $('galleryGrid'), plans = finishedNights();
  grid.innerHTML = '';
  if (!plans.length) { grid.innerHTML = `<div class="empty">${data.error ? 'The Squeekchain API did not answer. Trying again shortly.' : 'No finished nights yet. The first painting appears after his first night on the wheel.'}</div>`; return; }
  plans.forEach((plan, i) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'card night'; btn.setAttribute('aria-label', `Open ${plan.title}, night of ${dateLabel(plan.date)}`);
    const c = mk(10, 10); c.className = 'disc'; c.setAttribute('role', 'img'); c.setAttribute('aria-label', describe(plan));
    const h = document.createElement('h3'); h.textContent = plan.title;
    if (plan.stats.marks) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'gold'; tag.title = 'A milestone happened this night'; h.append(tag); }
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

// ---------- night dialog: replay, facts, wallpapers, share, verification ----------
let dlgCard = null, dlgPlan = null, replayTimer = 0;
function openNight(date) {
  const plan = planOf(nightOf(date));
  if (!plan.stats.turns) return;
  dlgPlan = plan;
  const dlg = $('nightDialog');
  if (!dlg.open) dlg.showModal();
  if (!dlgCard) dlgCard = new Card($('dlgCanvas'));
  stopReplay();
  dlgCard.setCard(plan.palette, Art.labelOf(plan)); dlgCard.setDrops(plan.drops); dlgCard.angle = 0;
  dlgCard.resize();
  $('dlgCanvas').setAttribute('aria-label', describe(plan));
  $('dlgTitle').textContent = plan.title;
  $('dlgSub').textContent = `Night of ${dateLabel(plan.date)} · ${plan.palette.name} card · ${runsText(plan)}`;
  const peakSlot = plan.drops.length ? nightOf(date).slots.reduce((best, w, i, a) => ((w ?? 0) > (a[best] ?? 0) ? i : best), 0) : 0;
  const facts = [
    ['Wheel turns', nf.format(plan.stats.turns)], ['Distance', `${km(plan.stats.distanceMm)} km`],
    ['Runs', String(plan.stats.runs)], ['Busiest half hour', `${nf.format(plan.stats.peak)} at ${slotUtc(peakSlot)} UTC`],
  ];
  $('dlgFacts').innerHTML = '';
  for (const [k, v] of facts) { const f = document.createElement('div'); f.className = 'fact'; f.innerHTML = '<div class="k"></div><div class="v"></div>'; f.firstChild.textContent = k; f.lastChild.textContent = v; $('dlgFacts').append(f); }
  drawStrip(plan, nightOf(date));
  const ul = $('dlgMarks'); ul.innerHTML = '';
  for (const m of nightOf(date).marks) { const li = document.createElement('li'); li.textContent = `Gold paint at ${new Date(m.at).toISOString().slice(11, 16)} UTC: ${m.label}.`; ul.append(li); }
  const url = `https://www.squeekwheel.xyz/#night=${plan.date}`;
  const text = `Squeektoshi painted "${plan.title}" on the night of ${dateLabel(plan.date)}: ${nf.format(plan.stats.turns)} turns of his wheel, ${km(plan.stats.distanceMm)} km 🐹🎨\n\nA new spin-art card every night, painted from @squeekchain's own data:`;
  $('dlgShare').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  $('dlgSeedText').textContent = plan.seedText;
  $('dlgSeed').textContent = plan.seed;
  $('dlgData').href = `${API}/v1/measurement/stats?range=30d`;
  $('dlgDay').textContent = plan.date;
  $('dlgCmd').textContent = `node verify.mjs ${plan.date}`;
  history.replaceState(null, '', `#night=${plan.date}`);
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
function replay(card, plan, onDone) {
  card.setDrops([]); card.angle = 0;
  const drops = plan.drops, total = REDUCED ? 0 : 11000, step = drops.length ? total / drops.length : 0;
  let i = 0;
  const next = () => {
    if (i >= drops.length) { card.target = 0; kick(); onDone?.(); return; }
    const d = drops[i++];
    card.add(d, { dur: 900 });
    card.target = (0.45 + d.omega) * TAU * 0.55;                // the card spins harder through his busiest half hours
    kick();
    replayTimer = setTimeout(next, step);
  };
  next();
}
$('dlgReplay').addEventListener('click', () => { if (dlgCard && dlgPlan) { stopReplay(); replay(dlgCard, dlgPlan); } });
$('dlgClose').addEventListener('click', () => $('nightDialog').close());
$('nightDialog').addEventListener('close', () => { stopReplay(); history.replaceState(null, '', location.pathname + location.search); });
$('nightDialog').addEventListener('click', (e) => { if (e.target === $('nightDialog')) $('nightDialog').close(); });
$('dlgLink').addEventListener('click', async () => {
  const url = `https://www.squeekwheel.xyz/#night=${dlgPlan.date}`;
  try { await navigator.clipboard.writeText(url); $('dlgLink').textContent = 'Copied'; } catch { prompt('Link to this painting', url); }
  setTimeout(() => { $('dlgLink').textContent = 'Copy link'; }, 1600);
});
for (const b of document.querySelectorAll('[data-wall]')) b.addEventListener('click', () => dlgPlan && wallpaper(dlgPlan, b.dataset.wall, b));

async function wallpaper(plan, kind, btn) {
  const old = btn.textContent; btn.textContent = 'Painting…'; btn.disabled = true;
  await new Promise((r) => setTimeout(r, 30));
  try {
    await document.fonts.load('700 40px Inter'); await document.fonts.load('600 20px "JetBrains Mono"');
    const [W, H] = { phone: [1290, 2796], desktop: [2560, 1440], square: [2048, 2048] }[kind];
    const c = mk(W, H), x = c.getContext('2d'), pal = plan.palette, dark = Art.isDark(pal.card);
    const g = x.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.8);
    g.addColorStop(0, dark ? Art.mix(pal.card, '#ffffff', 0.08) : Art.mix(pal.card, '#ffffff', 0.4));
    g.addColorStop(1, dark ? Art.mix(pal.card, '#000000', 0.6) : Art.mix(pal.card, '#5a4a30', 0.22));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const [cx, cy, R] = kind === 'phone' ? [W / 2, H * 0.4, W * 0.42] : kind === 'desktop' ? [W * 0.68, H / 2, H * 0.4] : [W / 2, H / 2, W * 0.44];
    x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = R * 0.12; x.shadowOffsetY = R * 0.05;
    x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fillStyle = pal.card; x.fill(); x.restore();
    Art.paint(x, plan, { cx, cy, R, makeCanvas: mk });
    const ink = dark ? '#f3f1ea' : '#1b1712', sub = dark ? 'rgba(243,241,234,.66)' : 'rgba(27,23,18,.62)';
    const lines = [
      [plan.title, `700 ${kind === 'desktop' ? H * 0.07 : W * 0.075}px Inter, sans-serif`, ink],
      [`Night of ${dateLabel(plan.date)}`, `500 ${kind === 'desktop' ? H * 0.032 : W * 0.036}px Inter, sans-serif`, sub],
      [`${nf.format(plan.stats.turns)} wheel turns · ${km(plan.stats.distanceMm)} km`, `500 ${kind === 'desktop' ? H * 0.032 : W * 0.036}px Inter, sans-serif`, sub],
    ];
    const foot = ['squeekwheel.xyz · painted by a real hamster on Squeekchain', `500 ${kind === 'desktop' ? H * 0.02 : W * 0.026}px "JetBrains Mono", monospace`, sub];
    if (kind === 'phone') {
      x.textAlign = 'center'; let y = cy + R + H * 0.075;
      lines.forEach(([t, f, col], i) => { x.font = f; x.fillStyle = col; x.fillText(t, W / 2, y); y += i ? W * 0.055 : W * 0.075; });
      x.font = foot[1]; x.fillStyle = foot[2]; x.fillText(foot[0], W / 2, H - H * 0.045);
    } else if (kind === 'desktop') {
      x.textAlign = 'left'; let y = H * 0.44;
      lines.forEach(([t, f, col], i) => { x.font = f; x.fillStyle = col; x.fillText(t, W * 0.08, y); y += i ? H * 0.05 : H * 0.075; });
      x.font = foot[1]; x.fillStyle = foot[2]; x.fillText(foot[0], W * 0.08, H - H * 0.07);
    }
    download(c, `squeek-spin-art-${plan.date}-${kind}.png`);
  } finally { btn.textContent = old; btn.disabled = false; }
}
function download(canvas, name) {
  canvas.toBlob((blob) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

// ---------- Paint with Squeektoshi ----------
const toy = {
  card: null, color: null, palette: null, src: 'live', pour: null, drops: [], waiting: [], lastIdx: 0, lastTimer: 0, lastSlots: [],
  init() {
    this.card = new Card($('toyCanvas'));
    this.palette = Art.paletteOf(now().date);
    this.setPalette(this.palette);
    const cv = $('toyCanvas');
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.tabIndex = 0;
    cv.addEventListener('keydown', (e) => {                       // keyboard: Enter or Space drops paint somewhere on the card
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const a = Math.random() * TAU, r = 0.15 + Math.random() * 0.5, rr = Art.rng(Art.sha256Hex(`${Date.now()}|${Math.random()}`));
      const [x, y] = [r * Math.cos(a), r * Math.sin(a)], vol = 0.5 + Math.random() * 0.5;
      if (this.omega >= 0.08) this.fling(x, y, vol, rr);
      else { const w = { drop: this.blobDrop(x, y, vol, rr), keepWet: true, spec: { x, y, vol, color: this.color } }; this.waiting.push(w); this.card.wet.push(w); this.card.draw(); }
      this.buttons();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) cv.addEventListener(ev, (e) => this.up(e));
    $('srcLive').addEventListener('click', () => this.setSrc('live'));
    $('srcLast').addEventListener('click', () => this.setSrc('last'));
    $('toyUndo').addEventListener('click', () => this.undo());
    $('toyClear').addEventListener('click', () => { this.drops = []; this.waiting = []; this.card.clearPaint(); this.buttons(); });
    $('toySave').addEventListener('click', () => {
      const n = this.drops.length + this.waiting.length;
      download(this.card.snapshot(2048, `You × Squeektoshi · ${dateLabel(now().date)} · ${n} drop${n === 1 ? '' : 's'} · squeekwheel.xyz`), 'squeek-spin-art-with-squeektoshi.png');
    });
    const picker = $('cardPicker');
    for (const p of PALETTES) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cardpick'; b.title = `${p.name} card`; b.setAttribute('aria-label', `${p.name} card`);
      b.style.background = `radial-gradient(circle, ${p.card} 0 42%, transparent 43%), conic-gradient(${p.colors.map((c, i) => `${c} ${(i / p.colors.length) * 100}% ${((i + 1) / p.colors.length) * 100}%`).join(',')})`;
      b.addEventListener('click', () => this.setPalette(p)); picker.append(b);
    }
    this.onStatus();
  },
  setPalette(p) {
    this.palette = p;
    this.card.setCard(p, `You × Squeektoshi · ${dateLabel(now().date)}`);
    this.card.baked = this.drops.filter((d) => !this.card.wet.some((w) => w.drop === d)); this.card.rebake(); this.card.draw();
    for (const b of $('cardPicker').children) b.setAttribute('aria-pressed', String(b.title === `${p.name} card`));
    const sw = $('swatches'); sw.innerHTML = '';
    for (const c of [...p.colors, GOLD]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.style.background = c; b.dataset.color = c;
      b.setAttribute('aria-label', c === GOLD ? 'Gold paint' : `Paint ${c}`);
      b.addEventListener('click', () => this.setColor(c)); sw.append(b);
    }
    this.setColor(p.colors.includes(this.color) || this.color === GOLD ? this.color : p.colors[2]);
  },
  setColor(c) { this.color = c; for (const b of $('swatches').children) b.setAttribute('aria-pressed', String(b.dataset.color === c)); },
  setSrc(src) {
    if (src === 'last' && !this.lastSlots.length) return;
    this.src = src; $('srcLive').setAttribute('aria-pressed', String(src === 'live')); $('srcLast').setAttribute('aria-pressed', String(src === 'last'));
    clearTimeout(this.lastTimer);
    if (src === 'last') { this.lastIdx = 0; this.stepLast(); } else this.onStatus();
  },
  stepLast() {
    const s = this.lastSlots[this.lastIdx % this.lastSlots.length]; this.lastIdx++;
    this.omega = Math.min(1.15, s.w / 1800); this.rpm = this.omega * 95;
    this.card.target = (this.rpm / 60) * TAU * VISUAL; kick();
    $('srcHint').textContent = `Last night at ${slotUtc(s.i)} UTC he made ${nf.format(s.w)} turns in half an hour.`;
    this.render(); this.flingWaiting();
    this.lastTimer = setTimeout(() => this.stepLast(), 3500);
  },
  onStatus() {
    if (!this.card) return;
    const last = finishedNights()[0];
    this.lastSlots = last ? Art.nightFromStats(data.days.get(last.date)).slots.map((w, i) => ({ w: w ?? 0, i })).filter((s) => s.w > 0) : [];
    $('srcLast').disabled = !this.lastSlots.length;
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
    $('toyState').textContent = this.src === 'last' ? 'Replaying last night' : !data.status ? 'Connecting…' : running ? 'He is running' : 'He is resting';
    $('toyPill').classList.toggle('is-running', running);
    $('toySpeed').textContent = running ? `${Math.round(this.rpm)} rpm` : '';
  },
  down(e) {
    const [x, y] = this.card.toCard(e), r = Math.hypot(x, y);
    if (r > PAINT_EDGE * 0.97 || r < 0.08) return;
    e.preventDefault(); this.card.canvas.setPointerCapture?.(e.pointerId);
    const rr = Art.rng(Art.sha256Hex(`${Date.now()}|${Math.random()}`));
    this.pour = { x, y, t0: performance.now(), r: rr, id: e.pointerId };
    this.pour.preview = { drop: this.blobDrop(x, y, 0.35, rr), keepWet: true };
    this.card.wet.push(this.pour.preview); this.card.draw();
    const grow = () => {
      if (!this.pour) return;
      const vol = Math.min(1.35, 0.35 + ((performance.now() - this.pour.t0) / 1000) * 0.9);
      this.pour.preview.drop = this.blobDrop(this.pour.x, this.pour.y, vol, Art.rng(Art.sha256Hex(`${this.pour.t0}`)));
      this.card.draw(); requestAnimationFrame(grow);
    };
    requestAnimationFrame(grow);
    $('toyHint').textContent = 'Hold to pour more paint';
  },
  up(e) {
    if (!this.pour || (e.pointerId !== undefined && e.pointerId !== this.pour.id)) return;
    const p = this.pour; this.pour = null;
    this.card.wet.splice(this.card.wet.indexOf(p.preview), 1);
    const vol = Math.min(1.35, 0.35 + ((performance.now() - p.t0) / 1000) * 0.9);
    if (this.omega >= 0.08) this.fling(p.x, p.y, vol, p.r);
    else { const w = { drop: this.blobDrop(p.x, p.y, vol, p.r), keepWet: true, spec: { x: p.x, y: p.y, vol, color: this.color } }; this.waiting.push(w); this.card.wet.push(w); this.card.draw(); }
    $('toyHint').textContent = this.omega >= 0.08 ? 'Tap again, or hold to pour more' : 'Your paint is waiting for him to run';
    this.buttons();
  },
  blobDrop(x, y, vol, r) { const d = Art.dropAt(r, { color: this.color, gold: this.color === GOLD, x0: x, y0: y, vol, omega: 0 }); d.fingers = []; return d; },
  fling(x, y, vol, r, color = this.color) {
    const d = Art.dropAt(r, { color, gold: color === GOLD, x0: x, y0: y, vol, omega: Math.max(0.15, this.omega) });
    this.drops.push(d); this.card.add(d, { dur: 1200 + 500 * this.omega });
  },
  flingWaiting() {
    if (this.omega < 0.08 || !this.waiting.length) return;
    for (const w of this.waiting) {
      this.card.wet.splice(this.card.wet.indexOf(w), 1);
      this.fling(w.spec.x, w.spec.y, w.spec.vol, Art.rng(Art.sha256Hex(`${w.spec.x}|${w.spec.y}`)), w.spec.color);
    }
    this.waiting = []; this.buttons();
  },
  undo() {
    if (this.waiting.length) { const w = this.waiting.pop(); this.card.wet.splice(this.card.wet.indexOf(w), 1); }
    else if (this.drops.length) {
      const d = this.drops.pop();
      this.card.wet = this.card.wet.filter((w) => w.drop !== d); this.card.baked = this.card.baked.filter((b) => b !== d); this.card.rebake();
    }
    this.card.draw(); this.buttons();
  },
  buttons() { const any = this.drops.length + this.waiting.length > 0; for (const id of ['toyUndo', 'toyClear', 'toySave']) $(id).disabled = !any; },
};

// ---------- stream overlay link ----------
function overlaySrc() { const t = document.documentElement.dataset.theme; return `${location.pathname}?overlay=art${t ? `&theme=${t}` : ''}`; }
$('copyOverlay')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('overlayUrl').value); $('copyOverlay').textContent = 'Copied'; } catch { $('overlayUrl').select(); }
  setTimeout(() => { $('copyOverlay').textContent = 'Copy'; }, 1600);
});

// ---------- start ----------
async function start() {
  if (OVERLAY) { document.documentElement.classList.add('overlay-mode'); live.cards.push(new Card($('ovCanvas'))); }
  else {
    live.cards.push(new Card($('heroCanvas')));
    toy.init();
    $('replayHero').addEventListener('click', () => { const last = finishedNights()[0]; if (last) { openNight(last.date); replay(dlgCard, last); } });
    $('overlayFrame').src = overlaySrc();
  }
  await Promise.allSettled([document.fonts.load('600 20px "JetBrains Mono"'), document.fonts.load('700 20px Inter')]);
  for (let attempt = 0; ; attempt++) {
    try { await Promise.all([loadStats('30d'), loadMarks().catch((e) => console.warn('marks', e.message))]); data.error = null; break; }
    catch (e) {
      data.error = e; if (!OVERLAY) renderGallery();
      await new Promise((r) => setTimeout(r, Math.min(60e3, 5000 * (attempt + 1))));
    }
  }
  data.loaded = true;
  try { data.status = await getJSON('/v1/status'); } catch {}
  refreshLive(); liveWet(); applySpin();
  if (!OVERLAY) {
    renderGallery(); toy.onStatus();
    const m = location.hash.match(/night=(\d{4}-\d{2}-\d{2})/);
    if (m) openNight(m[1]);
  }
  pollStatus(); statsTimer = setTimeout(pollStats, 120e3);
}
if (params.has('debug')) window.sart = { live, data, cards, refreshLive };   // for tests
if (!MOVED) start();
