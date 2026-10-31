// Re-create a painting's recipe from public data, without a browser.
//   node verify.mjs 2026-10-29
// Prints the exact text that is hashed, its SHA-256 fingerprint, the title, palette and how much paint lands, which
// must match the "Check how it was made" panel on www.squeekwheel.xyz/#night=2026-10-29. Node 18+, no dependencies.
// Finished nights come from nights.json (archived once from the API, so they outlive its 30-day window); newer nights
// come straight from api.squeekchain.com.
import fs from 'node:fs';
import { API, planNight, nightFromStats, marksFromEvents } from './art.js';

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) { console.log('usage: node verify.mjs YYYY-MM-DD'); process.exit(1); }
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r.json(); };

const local = new URL('./nights.json', import.meta.url);
const archive = fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, 'utf8')) : await get('https://www.squeekwheel.xyz/nights.json').catch(() => ({ nights: {} }));
let night, source;
if (archive.nights?.[date]) {
  const a = archive.nights[date];
  night = { date, slots: a.slots, distanceMm: a.distanceMm, marks: a.marks };
  source = `nights.json (archived ${a.archivedAt})`;
} else {
  const stats = await get(`${API}/v1/measurement/stats?range=30d`);
  const day = stats.activity.days.find((d) => d.date === date);
  if (!day) { console.log(`${date} is neither in nights.json nor in the last 30 days of /v1/measurement/stats`); process.exit(1); }
  const events = []; let cursor = null;
  for (let page = 0; page < 12; page++) {
    const q = new URLSearchParams({ category: 'measurement', limit: '100' }); if (cursor) q.set('cursor', cursor);
    const j = await get(`${API}/v1/events?${q}`); events.push(...j.events); cursor = j.nextCursor;
    if (!cursor || !j.events.length) break;
  }
  night = nightFromStats(day);
  night.marks = marksFromEvents(events).filter((m) => m.date === date);
  source = 'api.squeekchain.com (live)';
}
const plan = planNight(night);
console.log(`data         ${source}`);
console.log(`hashed text  ${plan.seedText}`);
console.log(`fingerprint  ${plan.seed}`);
console.log(`title        ${plan.title}`);
console.log(`palette      ${plan.palette.name}`);
console.log(`paint        ${plan.drops.length} drops, ${plan.drops.reduce((s, d) => s + d.fingers.length, 0)} trails, ${night.marks.length} gold`);
console.log(`night        ${plan.stats.turns} turns in ${plan.stats.activeSlots} half hours, ${plan.stats.runs} runs`);
