// Re-create a painting's recipe from the public Squeekchain data, without a browser.
//   node verify.mjs 2026-10-29
// Prints the exact text that is hashed, its SHA-256 fingerprint, the title, palette and how much paint lands, which
// must match the "Check how it was made" panel on www.squeekwheel.xyz/#night=2026-10-29. Node 18+, no dependencies.
import { API, planNight, nightFromStats, marksFromEvents } from './art.js';

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) { console.log('usage: node verify.mjs YYYY-MM-DD'); process.exit(1); }
const get = async (path) => { const r = await fetch(`${API}${path}`); if (!r.ok) throw new Error(`${path} answered ${r.status}`); return r.json(); };

const stats = await get('/v1/measurement/stats?range=30d');
const day = stats.activity.days.find((d) => d.date === date);
if (!day) { console.log(`${date} is not in the last 30 days of /v1/measurement/stats`); process.exit(1); }
const events = []; let cursor = null;
for (let page = 0; page < 12; page++) {
  const q = new URLSearchParams({ category: 'measurement', limit: '100' }); if (cursor) q.set('cursor', cursor);
  const j = await get(`/v1/events?${q}`); events.push(...j.events); cursor = j.nextCursor;
  if (!cursor || !j.events.length) break;
}
const night = nightFromStats(day);
night.marks = marksFromEvents(events).filter((m) => m.date === date);
const plan = planNight(night);
console.log(`hashed text  ${plan.seedText}`);
console.log(`fingerprint  ${plan.seed}`);
console.log(`title        ${plan.title}`);
console.log(`palette      ${plan.palette.name}`);
console.log(`paint        ${plan.drops.length} drops, ${plan.drops.reduce((s, d) => s + d.fingers.length, 0)} trails, ${night.marks.length} gold`);
console.log(`night        ${plan.stats.turns} turns in ${plan.stats.activeSlots} half hours, ${plan.stats.runs} runs`);
