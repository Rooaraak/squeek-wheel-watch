# Squeek Wheel Watch 🐹

A live dashboard for [Squeekchain](https://squeekchain.com), the proof-of-work chain powered by a real hamster wheel.

**Live at [www.squeekwheel.xyz](https://www.squeekwheel.xyz/)**

![Squeek Wheel Watch](og.png)

What's on it:

- **The wheel, live**: running or resting, speed, rpm and sensor freshness, refreshed every 15 seconds
- **Key numbers**: distance run, blocks mined, SQK mined against the cap, current round
- **Live run tracker**: while the hamster runs, a live speed line, run time, distance, top and average speed; otherwise the last run session with its wheel turns
- **Mining activity** over 24 hours, 7 days or 30 days: blocks, SQK minted or work, with a table view
- **Hamster records**: top speed, peak rpm, longest run, best day, longest streak, plus when it usually runs
- **Milestones and live activity**: distance and speed milestones, staking, claims and settled blocks
- **Economy**: SQK per block now, launch bonus and first halving with time estimates, latest settlements
- **Wallet checker**: any wallet's Squeeks (with their on-chain art), mining power, staking and rewards; link one with `#wallet=0x…`
- **Run alerts**: a browser notification and optional squeak sound when the hamster starts running
- **Share on X**: one tap to post the live numbers (or a wallet's Squeeks and rewards)
- **Stream overlay**: `?overlay` shows a see-through live box for OBS or Streamlabs (add `&theme=light` for a light box)

## Run it

**Browser:** open `index.html`. It's a single file with no build step and no dependencies. You can also serve the folder with any static server, for example `python3 -m http.server`, and open http://localhost:8000.

**Terminal** (Node 18 or newer):

```bash
node cli.mjs            # print the wheel's state once
node cli.mjs --watch    # refresh every 15 seconds
```

## Data

Everything comes from Squeekchain's public read-only API. No wallet, key or login is needed.

| Endpoint | Used for |
|---|---|
| `https://api.squeekchain.com/v1/status` | wheel sensor, block height and progress |
| `https://api.squeekchain.com/v1/economy/state` | SQK supply, rounds, NFTs, staking |
| `https://api.squeekchain.com/v1/settlements?range=24h` | hourly blocks and recent settlements |
| `https://api.squeekchain.com/v1/measurement/stats?range=30d` | distance, records, typical day |
| `https://api.squeekchain.com/v1/events` | milestones and live activity |
| `https://api.squeekchain.com/v1/accounts/{address}` and `/v1/squeeks/{id}` | wallet checker |

Squeekchain currently runs on the Sepolia test network, so SQK shown here is test SQK. Squeekchain's stats count each day from 12:00 to 12:00 UTC, so a night's run stays in one day; one work unit is one turn of the wheel (about 88 cm).

This is a community project and is not affiliated with the Squeekchain team.

## License

MIT
