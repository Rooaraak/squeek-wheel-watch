#!/usr/bin/env node
// Squeek Wheel Watch, terminal edition: prints the hamster wheel's live state once.
// Usage: node cli.mjs          (Node 18+, no dependencies)
//        node cli.mjs --watch  (refresh every 15 seconds)
const API = 'https://api.squeekchain.com/v1';
const nf = new Intl.NumberFormat('en-US');
const sqk = (base) => nf.format(BigInt(base) / 10n ** 18n);

async function get(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

async function show() {
  const [status, eco, day] = await Promise.all([get('/status'), get('/economy/state'), get('/settlements?range=24h')]);
  const m = status.measurement;
  const b = status.builder.projected ?? status.builder.anchor;
  const running = m.coreStatus !== 'IDLE' && m.speedMmPerSecond > 0;
  const minted = day.buckets.reduce((sum, x) => sum + BigInt(x.sqkMintedBaseUnits), 0n);
  const lines = [
    `🐹 Squeek Wheel Watch · ${new Date().toLocaleString()}`,
    `Wheel      ${running ? 'running' : 'resting'} · ${(m.speedMmPerSecond * 0.0036).toFixed(2)} km/h · ${(m.rpmMilli / 1000).toFixed(1)} rpm (${m.provenance} sensor, read ${m.observedAt})`,
    `Distance   ${(m.distanceMm / 1e6).toFixed(3)} km · ${nf.format(BigInt(m.cumulativeWorkUnits))} work units`,
    `Blocks     #${nf.format(BigInt(b.blockHeight))} · ${(Number(BigInt(b.blockProgress) / 10_000_000n)).toFixed(0)}% into the next one`,
    `SQK        ${sqk(eco.supply.totalMintedBaseUnits)} mined of ${sqk(eco.supply.capBaseUnits)} cap · round ${eco.lifecycle.currentRound}`,
    `Last 24 h  ${day.summary.completedBlockCount} blocks · ${day.summary.settlementCount} settlements · ${sqk(minted)} SQK minted`,
  ];
  console.log(lines.join('\n'));
}

await show();
if (process.argv.includes('--watch')) setInterval(() => { console.log(''); show().catch((e) => console.error(e.message)); }, 15_000);
