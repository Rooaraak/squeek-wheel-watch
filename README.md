# Squeek Spin Art 🐹🎨

Every night the real hamster that mines [Squeekchain](https://squeekchain.com) paints a spin-art card with his wheel.

**Live at [www.squeekwheel.xyz](https://www.squeekwheel.xyz/)**

![Squeek Spin Art](og.png)

A spin-art machine flings paint off a spinning card. Here the machine is Squeektoshi's wheel and the card is one Squeek day (12:00 to 12:00 UTC):

- every half hour he runs drops paint on the card, at that half hour's place on a 12-hour watch face, so a painting can be read like a clock (21:00 sits at 9, 03:30 at half past 3);
- the more turns he made in that half hour, the faster the card spins and the further and more curved the trails fly;
- the colour follows the hour, from the first colour of the night's palette at dusk to the last at dawn;
- a record that night (a new top speed, or another 50 km of lifetime distance) adds a drop of gold.

By morning the card is a painting of his night. Nothing is drawn by hand or chosen by us.

## What you can do

- **Watch tonight's card live.** It spins at the wheel's real rpm. While he runs, wet paint lands every 450 turns, and each half hour dries into the painting when Squeekchain publishes it. Before he starts, the page shows last night's painting.
- **Browse every night.** One card per Squeek day, each with a title from its shape ("Marathon", "Zoomies", "Long Run"…) and its colours.
- **Replay a night.** The card spins harder through his busiest half hours while the paint flies on in order.
- **Take it with you.** Phone, desktop and square wallpapers, a share-to-X button and a link to each painting (`/#night=2026-10-29`).
- **Paint with Squeektoshi.** Your own card on his wheel: tap to drop paint, hold to pour more, pick colours and a card. It only spins when he runs, so your paint waits for him, or you can play it at last night's speeds. Save the result as an image.
- **Put it on your stream.** `https://www.squeekwheel.xyz/?overlay=art` is a see-through OBS or Streamlabs browser source (600 × 670) that spins and fills with paint all night. Add `&caption=0` to hide the caption or `&theme=light` for a light caption.
- **Check the numbers.** The [live stats dashboard](https://www.squeekwheel.xyz/watch/) (speed, records, blocks, SQK, wallet checker, live-speed overlay at `/watch/?overlay`) still lives at `/watch/`.

## Same numbers, same painting

A painting is a pure function of public data. `art.js` builds it from:

1. the 48 half-hour turn counts for the day in [`/v1/measurement/stats?range=30d`](https://api.squeekchain.com/v1/measurement/stats?range=30d) (buckets are keyed by UTC clock minute; 12:00 to 23:30 come first, 00:00 to 11:30 belong to the next date), and
2. the record events for that day in [`/v1/events?category=measurement`](https://api.squeekchain.com/v1/events?category=measurement&limit=100).

Every random choice comes from SHA-256: each half hour's paint is seeded by `squeek-spin-art/v1|date|slot|turns`, so paint already on tonight's card never changes as the night goes on, and the palette is picked by the date. The whole night's text (`squeek-spin-art/v1|date|48 counts|records`) is hashed into the painting's fingerprint, which names it and is printed on its rim. The page shows that text and hash under "Check how it was made", and you can reproduce them without a browser:

```bash
node verify.mjs 2026-10-29
```

## Run it

It's a static site with no build step and no dependencies: `index.html`, `studio.js` and `art.js` (plus `watch/` for the dashboard). Serve the folder with any static server, for example `python3 -m http.server`, and open http://localhost:8000. `node cli.mjs` prints the wheel's state in a terminal (Node 18 or newer).

## Data

Everything comes from Squeekchain's public read-only API. No wallet, key or login is needed, and nothing is stored anywhere except your theme choice in your own browser.

| Endpoint | Used for |
|---|---|
| `https://api.squeekchain.com/v1/status` | live rpm, run state and turn counter (every 5 s while he runs, 15 s otherwise) |
| `https://api.squeekchain.com/v1/measurement/stats?range=30d` and `?range=7d` | half-hour turn counts, distance per night, when he usually starts |
| `https://api.squeekchain.com/v1/events?category=measurement` | records that become gold paint |

Squeekchain currently runs on the Sepolia test network. One turn of the wheel is about 88 cm.

This is a community project and is not affiliated with the Squeekchain team.

## License

MIT
