// Squeek Spin Art: the painting engine.
//
// A spin-art machine flings paint off a spinning card. Here the card is one Squeek day (12:00 → 12:00 UTC) and the
// machine is the real hamster wheel: every half hour the hamster runs drops paint on the card, at the clock position of
// that half hour, and the more turns he made the faster the card spins and the further the paint flies.
//
// A painting is a pure function of public data: the 48 half-hour turn counts and the milestones Squeekchain publishes
// for that day (api.squeekchain.com /v1/measurement/stats and /v1/events). The numbers are hashed with SHA-256 and the
// hash seeds every random choice, so the same numbers always give the same painting and anyone can re-create it.
// No dependencies; runs in any browser and in Node 18+ (planNight and sha256Hex need no DOM).

export const ENGINE = 'squeek-spin-art/v1';
export const API = 'https://api.squeekchain.com';
export const SLOTS = 48;
export const PAINT_EDGE = 0.9;                                  // paint stays inside this radius; the band outside is the frame
const TAU = Math.PI * 2;

// ---------- SHA-256 (synchronous so plans work everywhere, including file:// pages and Node) ----------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const ror = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text), len = bytes.length, padded = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(padded); m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(padded - 8, Math.floor(len / 0x20000000)); dv.setUint32(padded - 4, (len * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let o = 0; o < padded; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = W[i - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + W[i - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10));
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// sfc32, seeded from the first 128 bits of the hash.
export function rng(hex) {
  let a = parseInt(hex.slice(0, 8), 16), b = parseInt(hex.slice(8, 16), 16), c = parseInt(hex.slice(16, 24), 16), d = parseInt(hex.slice(24, 32), 16);
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// ---------- Palettes: colours run from the first run of the night to the last ----------
export const PALETTES = [
  { name: 'Ember', card: '#f3ead9', ink: '#8a735a', hub: '#2a211a', glow: 0, colors: ['#f6c445', '#f08a24', '#d95926', '#b3261e', '#5c1a0b', '#2b2d42'] },
  { name: 'Moonlight', card: '#0c0e19', ink: '#5c6386', hub: '#dfe4ff', glow: 0.55, colors: ['#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff'] },
  { name: 'Bubblegum', card: '#fff2f6', ink: '#b07c95', hub: '#3a1d2e', glow: 0, colors: ['#ffd23f', '#ff8fab', '#ff4d8d', '#c9184a', '#7b2cbf', '#00a6fb'] },
  { name: 'Lagoon', card: '#05161b', ink: '#3f7c82', hub: '#d8fff6', glow: 0.6, colors: ['#fee440', '#00f5d4', '#00bbf9', '#4d96ff', '#9b5de5', '#f15bb5'] },
  { name: 'Toxic', card: '#090d08', ink: '#55704a', hub: '#e6ff9e', glow: 0.7, colors: ['#fff700', '#b8f400', '#39ff14', '#00e0ff', '#ff3cac', '#ff8c00'] },
  { name: 'Citrus', card: '#fffaee', ink: '#9a8a62', hub: '#20232a', glow: 0, colors: ['#06d6a0', '#ffd000', '#ff9500', '#ff4d6d', '#3a86ff', '#073b4c'] },
  { name: 'Royal', card: '#130a21', ink: '#6f5c96', hub: '#ffe8a3', glow: 0.5, colors: ['#ff7b00', '#ffd166', '#ffb4e0', '#e0aaff', '#9d4edd', '#5a189a'] },
  { name: 'Squeek', card: '#f6f5f2', ink: '#8f8e88', hub: '#0b0b0b', glow: 0, colors: ['#f29b6c', '#eb6834', '#d95926', '#8f2d0e', '#0b0b0b', '#52514e'] },
];
export const GOLD = '#d9ad3c';

// ---------- Data: a Squeek day from the public stats ----------
// /v1/measurement/stats keys buckets by UTC clock minute; a Squeek day runs 12:00 → 12:00, so 12:00…23:30 come first
// and 00:00…11:30 belong to the next calendar date. slots[i] is the turn count for 12:00 + 30·i minutes (null = no data).
export function nightFromStats(day) {
  const byMinute = new Map(day.buckets.map((b) => [b.startMinuteUtc, b.workUnits == null ? null : Number(b.workUnits)]));
  const cover = new Map(day.buckets.map((b) => [b.startMinuteUtc, b.coverage]));
  const slots = Array.from({ length: SLOTS }, (_, i) => byMinute.get((720 + i * 30) % 1440) ?? null);
  const coverage = Array.from({ length: SLOTS }, (_, i) => cover.get((720 + i * 30) % 1440) ?? 'missing');
  return { date: day.date, slots, coverage, distanceMm: day.distanceMm == null ? null : Number(day.distanceMm), marks: [] };
}

// Where a moment falls: the Squeek day it belongs to and its half-hour slot.
export function slotOf(iso) {
  const t = Date.parse(iso) - 12 * 3600e3, day = new Date(t);
  return { date: day.toISOString().slice(0, 10), slot: Math.floor((t % 86400e3) / 1800e3) };
}

// Records become gold paint, so gold stays rare: a new top speed, or every 50 km of lifetime distance.
export function marksFromEvents(events) {
  const out = [];
  for (const e of events) {
    const p = e.payload ?? {};
    let label = null;
    if (e.type === 'measurement.distance_milestone' && Number(p.thresholdDistanceMm) % 50e6 === 0) label = `${Math.round(Number(p.thresholdDistanceMm) / 1e6)} km run in his lifetime`;
    else if (e.type === 'measurement.speed_record') label = `new top speed, ${(Number(p.recordMmPerSecond) * 0.0036).toFixed(2)} km/h`;
    if (label) out.push({ ...slotOf(e.occurredAt), kind: e.type.replace('measurement.', ''), label, at: e.occurredAt });
  }
  return out;
}

export function seedTextOf(night) {
  const slots = night.slots.map((v) => (v == null ? '-' : v)).join(',');
  const marks = [...night.marks].sort((a, b) => a.slot - b.slot || a.kind.localeCompare(b.kind)).map((m) => `${m.slot}:${m.kind}`).join(',');
  return `${ENGINE}|${night.date}|${slots}|${marks}`;
}

// Runs = groups of active half hours with at most one quiet half hour between them.
export function runsOf(slots) {
  const runs = []; let cur = null, gap = 0;
  slots.forEach((w, i) => {
    if ((w ?? 0) > 0) { if (cur && gap <= 1) { cur.end = i; cur.turns += w; } else { cur = { start: i, end: i, turns: w }; runs.push(cur); } gap = 0; }
    else gap++;
  });
  return runs;
}

const TITLE_A = { Ember: ['Ember', 'Bonfire', 'Furnace'], Moonlight: ['Moonlit', 'Silver', 'Lunar'], Bubblegum: ['Bubblegum', 'Candy', 'Sugar'],
  Lagoon: ['Lagoon', 'Tidal', 'Coral'], Toxic: ['Toxic', 'Radioactive', 'Acid'], Citrus: ['Citrus', 'Tangerine', 'Zesty'],
  Royal: ['Royal', 'Velvet', 'Imperial'], Squeek: ['Squeek', 'Orange', 'Classic'] };

function titleOf(paletteName, stats, r) {
  const a = TITLE_A[paletteName][Math.floor(r() * 3)];
  let b;
  if (stats.turns >= 12500) b = 'Marathon';
  else if (stats.peak >= 1750) b = 'Zoomies';
  else if (stats.runs >= 4) b = 'Waltz';
  else if (stats.runs === 1) b = 'Long Run';
  else if (stats.turns === 0) b = 'Nap';
  else b = ['Sprint', 'Shuffle', 'Spin'][Math.floor(r() * 3)];
  return `${a} ${b}`;
}

// ---------- The plan: every stroke of the painting, in disc units (radius 1, centre 0,0) ----------
// Each half hour's paint depends only on the date, the slot and that slot's turn count, so tonight's card grows as he
// runs and paint already on it never changes. The palette depends only on the date. The fingerprint (SHA-256 of all
// the numbers) names the finished painting and picks its title.
// Steps through all eight palettes (3 and 8 share no factor), so nights in a row never share one.
export function paletteOf(date) {
  const day = Date.parse(`${date}T00:00:00Z`) / 86400e3;
  return PALETTES[Number.isInteger(day) ? (((day * 3) % PALETTES.length) + PALETTES.length) % PALETTES.length : 0];
}

// Paint colour follows the hour: the palette runs from 20:00 UTC (first colour) to 08:00 UTC (last).
export function hourT(slot) { return Math.max(0, Math.min(1, (slot - 16) / 24)); }

export function slotDrops(date, slot, turns, palette = paletteOf(date)) {
  const r = rng(sha256Hex(`${ENGINE}|${date}|${slot}|${turns}`));
  const a = Math.min(1.15, turns / 1800);                         // ~1 = a flat-out half hour (record is 1,827 turns)
  const n = 1 + Math.round(a * 2.2 + r() * 0.8), out = [];
  for (let k = 0; k < n; k++) out.push(slotDrop(r, palette, slot, hourT(slot), a, false));
  return out;
}

export function markDrop(date, mark, palette = paletteOf(date), n = 0) {
  return slotDrop(rng(sha256Hex(`${ENGINE}|${date}|mark|${mark.slot}|${mark.kind}${n ? `|${n}` : ''}`)), palette, mark.slot, 1, 0.95, true);
}

export function planNight(night) {
  const seedText = seedTextOf(night), seed = sha256Hex(seedText), r = rng(seed);
  const palette = paletteOf(night.date);
  const runs = runsOf(night.slots);
  const active = night.slots.map((w, i) => ({ w: w ?? 0, i })).filter((s) => s.w > 0);
  const turns = active.reduce((s, x) => s + x.w, 0), peak = active.reduce((m, x) => Math.max(m, x.w), 0);
  const drops = [];
  for (let i = 0; i < SLOTS; i++) {
    const w = night.slots[i] ?? 0;
    if (w > 0) drops.push(...slotDrops(night.date, i, w, palette));
    const seen = new Map();
    for (const m of night.marks.filter((x) => x.slot === i)) { const n = seen.get(m.kind) ?? 0; seen.set(m.kind, n + 1); drops.push(markDrop(night.date, m, palette, n)); }
  }
  const stats = { turns, peak, runs: runs.length, activeSlots: active.length, marks: night.marks.length,
    distanceMm: night.distanceMm, firstSlot: active[0]?.i ?? null, lastSlot: active.at(-1)?.i ?? null };
  return { engine: ENGINE, date: night.date, seedText, seed, palette, drops, runs, stats, title: titleOf(palette.name, stats, r) };
}

// The card is a 12-hour watch face in UTC: 12 o'clock at the top, running clockwise, so 21:00 sits at 9 and 03:30 at
// half past 3. A drop lands inside its half hour's wedge (like any watch, 09:00 and 21:00 share a position).
export function slotAngle(slot) { return -Math.PI / 2 + (((slot % 24) + 0.5) / 24) * TAU; }

function slotDrop(r, palette, slot, t, a, gold) {
  const n = palette.colors.length;
  const color = gold ? GOLD : palette.colors[Math.max(0, Math.min(n - 1, Math.round(t * (n - 1) + (r() - 0.5) * 1.4)))];
  const theta = slotAngle(slot) + (r() - 0.5) * (TAU / 24) * 1.3;
  const r0 = 0.13 + 0.5 * Math.pow(r(), 1.25);
  const vol = (0.4 + 0.6 * r()) * (0.55 + 0.55 * a);
  const omega = Math.min(1.2, a * (0.8 + 0.4 * r()));
  return { slot, ...dropAt(r, { color, gold, x0: r0 * Math.cos(theta), y0: r0 * Math.sin(theta), vol, omega }) };
}

// A drop of paint at (x0, y0) on a card spinning at omega (0 = still, 1 = flat out). Also used by "Paint with him".
export function dropAt(r, { color, gold = false, x0, y0, vol, omega }) {
  const theta = Math.atan2(y0, x0);
  const blob = 0.022 + 0.05 * vol;
  const curl = 0.3 + 0.95 * omega;                                // trails bend back against the spin
  const blobPts = Array.from({ length: 28 }, (_, i) => blob * (0.9 + 0.2 * r()) * (1 + 0.06 * Math.sin(i * 1.7)));
  const fingers = [];
  const count = Math.round(3 + omega * 11 + r() * 3);
  for (let f = 0; f < count; f++) {
    const off = (r() * 2 - 1) * (0.55 + 0.75 * (1 - omega));    // slow spins spread paint wide, fast ones throw it straight out
    const sx = x0 + blob * 0.85 * Math.cos(theta + off), sy = y0 + blob * 0.85 * Math.sin(theta + off);
    const rs = Math.hypot(sx, sy), ts = Math.atan2(sy, sx);
    const reach = (0.08 + 0.92 * Math.pow(omega, 0.85)) * (PAINT_EDGE + 0.06 - rs) * (0.4 + 0.6 * r());
    const wob = r() * TAU, wobAmp = 0.006 + 0.012 * r();
    const pts = [];
    for (let i = 0; i <= 36; i++) {
      const s = i / 36, rr = rs + reach * s;
      pts.push([rr, ts - curl * (rr - rs) * (0.85 + 0.3 * Math.sin(wob)) + wobAmp * Math.sin(wob + s * 7) * s]);
    }
    const w0 = blob * (0.12 + 0.4 * Math.pow(r(), 1.5)) * (1.15 - 0.4 * omega);
    const spray = [];
    const nSpray = Math.round(omega * omega * 7 * r());
    for (let i = 0; i < nSpray; i++) {
      const rr = rs + reach * (1.02 + 0.35 * r());
      spray.push([rr, ts - curl * (rr - rs) + (r() - 0.5) * 0.05, w0 * (0.12 + 0.35 * r())]);
    }
    fingers.push({ pts, w0, end: r() < 0.45 ? w0 * (0.55 + 0.4 * r()) : 0, spray });
  }
  return { color, gold, x0, y0, blob, blobPts, theta, fingers, omega };
}

// ---------- Drawing ----------
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const mixHex = (h, to, k) => { const a = hexRgb(h), b = hexRgb(to); return `#${a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('')}`; };
export const mix = (h, to, k) => { const a = hexRgb(h), b = hexRgb(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; };
export const isDark = (h) => { const [r, g, b] = hexRgb(h); return r * 0.299 + g * 0.587 + b * 0.114 < 90; };

const textureCache = new Map();
function grain(card, makeCanvas) {
  if (textureCache.has(card)) return textureCache.get(card);
  const c = makeCanvas(160, 160), x = c.getContext('2d'), img = x.createImageData(160, 160), r = rng(sha256Hex(card));
  const dark = isDark(card);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = dark ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = Math.floor(r() * (dark ? 22 : 30));
  }
  x.putImageData(img, 0, 0); textureCache.set(card, c); return c;
}

function fingerPath(ctx, f, R, upto) {
  const n = Math.max(2, Math.ceil((f.pts.length - 1) * upto) + 1), L = [], Rt = [];
  const P = f.pts.slice(0, n).map(([rr, th]) => [rr * Math.cos(th) * R, rr * Math.sin(th) * R]);
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const s = (i / (f.pts.length - 1)), w = f.w0 * R * Math.pow(1 - s, 0.75) * (1 + 0.12 * Math.sin(s * 11)) + 0.35;
    L.push([P[i][0] - (dy / len) * w, P[i][1] + (dx / len) * w]); Rt.push([P[i][0] + (dy / len) * w, P[i][1] - (dx / len) * w]);
  }
  ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L.slice(1)) ctx.lineTo(p[0], p[1]);
  for (const p of Rt.reverse()) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  return P;
}

// Draws one drop. grow (0..1) lets the paint run outwards for animations.
export function drawDrop(ctx, d, R, palette, grow = 1) {
  const glow = palette.glow, body = d.gold ? GOLD : d.color;
  const light = d.gold ? '#fff3c4' : mix(d.color, '#ffffff', 0.55), deep = d.gold ? '#8a6a1f' : mix(d.color, '#000000', 0.35);
  ctx.save();
  if (glow) { ctx.shadowColor = body; ctx.shadowBlur = R * 0.018 * glow; }
  ctx.fillStyle = body;
  const runs = [];
  for (const f of d.fingers) {
    const P = fingerPath(ctx, f, R, grow); ctx.fill(); runs.push(P);
    if (grow >= 1 && f.end) { const e = P.at(-1); ctx.beginPath(); ctx.arc(e[0], e[1], f.end * R, 0, TAU); ctx.fill(); }
    if (grow >= 1) for (const [rr, th, s] of f.spray) { ctx.beginPath(); ctx.arc(rr * Math.cos(th) * R, rr * Math.sin(th) * R, Math.max(0.6, s * R), 0, TAU); ctx.fill(); }
  }
  // the drop itself, on top of where its trails start
  const blobScale = 0.55 + 0.45 * Math.min(1, grow * 1.4);
  ctx.beginPath();
  d.blobPts.forEach((rad, i) => {
    const a = (i / d.blobPts.length) * TAU, x = (d.x0 + Math.cos(a) * rad * blobScale) * R, y = (d.y0 + Math.sin(a) * rad * blobScale) * R;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // wet gloss: a thin bright line along each trail and a highlight on the drop
  ctx.save();
  ctx.globalAlpha = glow ? 0.55 : 0.42; ctx.strokeStyle = light; ctx.lineCap = 'round';
  d.fingers.forEach((f, k) => {
    const P = runs[k], m = Math.floor(P.length * 0.7); if (m < 3) return;
    ctx.lineWidth = Math.max(0.5, f.w0 * R * 0.28);
    ctx.beginPath(); ctx.moveTo(P[1][0], P[1][1]); for (let i = 2; i < m; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.stroke();
  });
  ctx.globalAlpha = 1;
  const hx = (d.x0 - d.blob * 0.3) * R, hy = (d.y0 - d.blob * 0.35) * R;
  const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, d.blob * R * 0.75 * blobScale);
  g.addColorStop(0, d.gold ? 'rgba(255,248,214,.9)' : 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, d.blob * R * 0.75 * blobScale, 0, TAU); ctx.fill();
  if (d.gold && grow >= 1) {                                       // gold catches the light: a four-point glint
    const s = d.blob * R * 0.95, gx = hx + d.blob * R * 0.1, gy = hy;
    ctx.fillStyle = 'rgba(255,252,235,.95)'; ctx.beginPath();
    ctx.moveTo(gx, gy - s); ctx.quadraticCurveTo(gx, gy, gx + s * 0.32, gy); ctx.quadraticCurveTo(gx, gy, gx, gy + s);
    ctx.quadraticCurveTo(gx, gy, gx - s * 0.32, gy); ctx.quadraticCurveTo(gx, gy, gx, gy - s); ctx.fill();
    ctx.beginPath(); ctx.moveTo(gx - s * 0.6, gy); ctx.quadraticCurveTo(gx, gy, gx, gy - s * 0.2); ctx.quadraticCurveTo(gx, gy, gx + s * 0.6, gy);
    ctx.quadraticCurveTo(gx, gy, gx, gy + s * 0.2); ctx.quadraticCurveTo(gx, gy, gx - s * 0.6, gy); ctx.fill();
  }
  if (!glow) { // a soft rim of deeper colour gives the paint body
    ctx.globalAlpha = 0.25; ctx.strokeStyle = deep; ctx.lineWidth = Math.max(0.6, R * 0.0025);
    ctx.beginPath(); d.blobPts.forEach((rad, i) => { const a = (i / d.blobPts.length) * TAU, x = (d.x0 + Math.cos(a) * rad * blobScale) * R, y = (d.y0 + Math.sin(a) * rad * blobScale) * R; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

// The blank card: paper or black board with a soft vignette.
export function drawCard(ctx, R, palette) {
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = palette.card; ctx.fill();
  const v = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R * PAINT_EDGE);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, isDark(palette.card) ? 'rgba(0,0,0,.35)' : 'rgba(80,60,30,.07)');
  ctx.fillStyle = v; ctx.fill();
  ctx.restore();
}

// The frame: a band around the paint with the 12 hour marks, lying over the card's edge.
export function drawFrame(ctx, R, palette) {
  const dark = isDark(palette.card), band = mix(palette.card, dark ? '#ffffff' : '#000000', dark ? 0.06 : 0.045);
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.arc(0, 0, R * PAINT_EDGE, 0, TAU, true);
  ctx.fillStyle = band; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = R * 0.02; ctx.fill('evenodd');
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = palette.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(0.6, R * 0.0025);
  ctx.beginPath(); ctx.arc(0, 0, R * PAINT_EDGE, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.6; ctx.lineCap = 'round';
  for (let h = 0; h < 12; h++) {
    const a = -Math.PI / 2 + (h / 12) * TAU, big = h % 3 === 0;
    ctx.lineWidth = Math.max(0.8, R * (big ? 0.008 : 0.004));
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.912, Math.sin(a) * R * 0.912);
    ctx.lineTo(Math.cos(a) * R * (big ? 0.936 : 0.928), Math.sin(a) * R * (big ? 0.936 : 0.928)); ctx.stroke();
  }
  ctx.restore();
}

export function drawLabel(ctx, R, palette, text) {
  ctx.save();
  ctx.fillStyle = palette.ink; ctx.globalAlpha = 0.95;
  const size = Math.max(6, R * 0.03);
  ctx.font = `600 ${size}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const chars = [...text.toUpperCase()], rad = R * 0.962, step = (size * 0.64) / rad;
  let a = Math.PI / 2 + ((chars.length - 1) * step) / 2;       // centred at the bottom, reading left to right
  for (const ch of chars) {
    ctx.save(); ctx.rotate(a); ctx.translate(rad, 0); ctx.rotate(-Math.PI / 2); ctx.fillText(ch, 0, 0); ctx.restore();
    a -= step;
  }
  ctx.restore();
}

export function drawHub(ctx, R, palette, spin = 0) {
  const r = R * 0.06, ink = palette.hub, back = palette.card;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = R * 0.02; ctx.shadowOffsetY = R * 0.006;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = ink; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.rotate(spin);
  ctx.strokeStyle = back; ctx.lineWidth = Math.max(1, r * 0.13); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.68, 0, TAU); ctx.stroke();
  ctx.lineWidth = Math.max(0.8, r * 0.08);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62); ctx.lineTo(-Math.cos(a) * r * 0.62, -Math.sin(a) * r * 0.62); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, TAU); ctx.fillStyle = back; ctx.fill();
  ctx.restore();
}

export function labelOf(plan) {
  const d = new Date(`${plan.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const km = plan.stats.distanceMm ? ` · ${(plan.stats.distanceMm / 1e6).toFixed(1)} km` : '';
  return `${plan.title} · night of ${d} · ${plan.stats.turns.toLocaleString('en')} turns${km} · ${plan.seed.slice(0, 8)}`;
}

// Paints a whole plan into ctx at (cx, cy) with radius R. progress (0..1) draws the night up to that point, for replays.
export function paint(ctx, plan, { cx, cy, R, progress = 1, label = true, makeCanvas }) {
  ctx.save(); ctx.translate(cx, cy);
  drawCard(ctx, R, plan.palette);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * PAINT_EDGE, 0, TAU); ctx.clip();
  const total = plan.drops.length, upto = progress * total;
  for (let i = 0; i < total && i < upto; i++) drawDrop(ctx, plan.drops[i], R, plan.palette, Math.min(1, upto - i));
  ctx.restore();
  drawFinish(ctx, R, plan.palette, makeCanvas);
  drawFrame(ctx, R, plan.palette);
  if (label) drawLabel(ctx, R, plan.palette, typeof label === 'string' ? label : labelOf(plan));
  drawHub(ctx, R, plan.palette);
  ctx.restore();
}

// Paper grain and a soft sheen over the paint (ctx already centred on the card).
export function drawFinish(ctx, R, palette, makeCanvas) {
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * PAINT_EDGE, 0, TAU); ctx.clip();
  if (makeCanvas) { ctx.fillStyle = ctx.createPattern(grain(palette.card, makeCanvas), 'repeat'); ctx.fillRect(-R, -R, R * 2, R * 2); }
  const sheen = ctx.createLinearGradient(-R, -R, R, R);
  sheen.addColorStop(0, 'rgba(255,255,255,.07)'); sheen.addColorStop(0.45, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(0,0,0,.05)');
  ctx.fillStyle = sheen; ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();
}

// ---------- Squeek portraits: a Squeek NFT in the middle of a card, painted by one night of the wheel ----------
// The paint uses the Squeek's own colours (read from its on-chain SVG) and lands around it; each half hour of the night
// is seeded by `squeek-spin-art/v1|squeek|<tokenId>|<date>|<slot>|<turns>`, so every Squeek gets its own painting of
// every night, and higher levels throw a little more paint.
export const WINDOW = 0.34;                                       // radius of the round window the Squeek looks out of

const hexHsl = (h) => {
  const [r, g, b] = hexRgb(h).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, s, l];
};

// Up to six well-separated, saturated colours from the Squeek's art, ordered by hue.
export function squeekColors(svg) {
  const counts = new Map();
  for (const m of svg.matchAll(/(?:color|fill|stroke)="(#[0-9a-fA-F]{6})"/g)) { const c = m[1].toLowerCase(); counts.set(c, (counts.get(c) ?? 0) + 1); }
  const cands = [...counts].map(([c, n]) => ({ c, n, hsl: hexHsl(c) })).filter(({ hsl: [, s, l] }) => s > 0.3 && l > 0.22 && l < 0.88)
    .sort((a, b) => b.n - a.n || a.c.localeCompare(b.c));
  for (const gap of [28, 16, 8]) {
    const pick = [];
    for (const x of cands) {
      if (pick.length === 6) break;
      if (pick.every((p) => Math.min(Math.abs(p.hsl[0] - x.hsl[0]), 360 - Math.abs(p.hsl[0] - x.hsl[0])) >= gap)) pick.push(x);
    }
    if (pick.length >= 4 || gap === 8) {
      const cols = pick.sort((a, b) => a.hsl[0] - b.hsl[0]).map((p) => p.c);
      for (let i = 0; cols.length && cols.length < 4; i++) cols.push(mixHex(cols[i], '#ffffff', 0.35));
      return cols.length ? cols : PALETTES[3].colors;
    }
  }
  return PALETTES[3].colors;
}

export function squeekPalette(tokenId, svg) {
  return { name: `Squeek #${tokenId}`, card: '#0a0a0d', ink: '#6b6f80', hub: '#e9e9ef', glow: 0.6, colors: squeekColors(svg) };
}

export function portraitSeedText(sq, night) {
  return `${ENGINE}|squeek|${sq.tokenId}|level ${sq.level}|${seedTextOf(night).slice(ENGINE.length + 1)}`;
}

export function planPortrait(sq, night) {
  const palette = sq.palette, drops = [];
  const lv = Math.max(1, Math.min(10, Number(sq.level) || 1));
  for (let i = 0; i < SLOTS; i++) {
    const w = night.slots[i] ?? 0;
    if (w > 0) {
      const r = rng(sha256Hex(`${ENGINE}|squeek|${sq.tokenId}|${night.date}|${i}|${w}`));
      const a = Math.min(1.15, w / 1800), n = 1 + Math.round(a * (1.7 + 0.2 * lv) + r() * 0.8);
      for (let k = 0; k < n; k++) {
        const nc = palette.colors.length, t = hourT(i);
        const color = palette.colors[Math.max(0, Math.min(nc - 1, Math.round(t * (nc - 1) + (r() - 0.5) * 1.4)))];
        const theta = slotAngle(i) + (r() - 0.5) * (TAU / 24) * 1.3, r0 = WINDOW + 0.05 + 0.3 * Math.pow(r(), 1.3);
        drops.push({ slot: i, ...dropAt(r, { color, x0: r0 * Math.cos(theta), y0: r0 * Math.sin(theta), vol: (0.4 + 0.6 * r()) * (0.55 + 0.5 * a), omega: Math.min(1.2, a * (0.8 + 0.4 * r())) }) });
      }
    }
    const seen = new Map();
    for (const m of night.marks.filter((x) => x.slot === i)) {
      const n = seen.get(m.kind) ?? 0; seen.set(m.kind, n + 1);
      const r = rng(sha256Hex(`${ENGINE}|squeek|${sq.tokenId}|${night.date}|mark|${m.slot}|${m.kind}${n ? `|${n}` : ''}`)), theta = slotAngle(i) + n * 0.12, r0 = WINDOW + 0.08;
      drops.push({ slot: i, ...dropAt(r, { color: GOLD, gold: true, x0: r0 * Math.cos(theta), y0: r0 * Math.sin(theta), vol: 0.9, omega: 0.95 }) });
    }
  }
  const seedText = portraitSeedText(sq, night), seed = sha256Hex(seedText);
  const turns = night.slots.reduce((s, w) => s + (w ?? 0), 0);
  return { engine: ENGINE, date: night.date, seedText, seed, palette, drops, turns, tokenId: sq.tokenId, level: lv, staked: !!sq.staked };
}

export function portraitLabel(plan) {
  const d = new Date(`${plan.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `Squeek #${plan.tokenId} · level ${plan.level}${plan.staked ? ' · staked' : ''} · night of ${d} · ${plan.turns.toLocaleString('en')} turns · ${plan.seed.slice(0, 8)}`;
}

// The round window with the Squeek's art, upright, with a ring in its own colour (gold while it is staked and mining).
export function drawWindow(ctx, R, img, palette, staked) {
  const r = R * WINDOW;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = R * 0.04;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = '#08080a'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.save(); ctx.clip();
  if (img) { const s = r * 2.25; ctx.drawImage(img, -s / 2, -s / 2 - r * 0.02, s, s); }
  ctx.restore();
  ctx.lineWidth = Math.max(1.5, R * 0.014);
  ctx.strokeStyle = staked ? GOLD : palette.colors[Math.floor(palette.colors.length / 2)];
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  if (staked) { ctx.lineWidth = Math.max(0.8, R * 0.004); ctx.strokeStyle = '#fff3c4'; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(0, 0, r - R * 0.012, 0, TAU); ctx.stroke(); }
  ctx.restore();
}

export function paintPortrait(ctx, plan, img, { cx, cy, R, progress = 1, label = true, makeCanvas }) {
  ctx.save(); ctx.translate(cx, cy);
  drawCard(ctx, R, plan.palette);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * PAINT_EDGE, 0, TAU); ctx.clip();
  const total = plan.drops.length, upto = progress * total;
  for (let i = 0; i < total && i < upto; i++) drawDrop(ctx, plan.drops[i], R, plan.palette, Math.min(1, upto - i));
  ctx.restore();
  drawFinish(ctx, R, plan.palette, makeCanvas);
  drawFrame(ctx, R, plan.palette);
  if (label) drawLabel(ctx, R, plan.palette, typeof label === 'string' ? label : portraitLabel(plan));
  drawWindow(ctx, R, img, plan.palette, plan.staked);
  ctx.restore();
}
