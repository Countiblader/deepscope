# DeepScope — Maritime Geopolitical Intelligence Dashboard

> **Real-time AIS ship tracking + oil prices + geopolitical news in one dashboard.**
> Built to independently verify news claims about oil tankers, shadow fleets, and chokepoints like the Strait of Hormuz.

![DeepScope Dashboard](https://img.shields.io/badge/status-active-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![Bun](https://img.shields.io/badge/runtime-Bun-orange) ![Next.js](https://img.shields.io/badge/frontend-Next.js_16-black)

---

## The Vision

When you read headlines like *"Iran blocks tanker in Hormuz"* or *"Russian shadow fleet bypasses Norway sanctions"* — how do you know if it's real?

DeepScope lets you **cross-reference news claims against actual ship movement data**. If Iran supposedly blocked the Strait of Hormuz, you'd see it immediately: fewer tankers moving through, ships anchoring, course changes. If Russia's shadow fleet is routing through Norwegian waters, the AIS data shows it.

This dashboard was built for:
- **Geopolitical analysts** who want ground truth beyond headlines
- **Energy traders** watching chokepoints that move oil prices
- **Journalists** fact-checking maritime news
- **Anyone curious** about what's actually happening on the world's oceans

---

## Features

- **Live Ship Map** — Real-time AIS vessel positions via [aisstream.io](https://aisstream.io). Leaflet.js with Canvas renderer (no GPU needed, works on any machine)
- **Shadow Fleet Detection** — Automatic risk scoring for vessels with flags of convenience, Russian port destinations, AIS gaps, or suspicious patterns
- **4 Monitored Zones** — Norway→Murmansk corridor, Strait of Hormuz, North Sea, Suez Canal
- **Live Oil Prices** — Real-time Brent, WTI, Gold, Natural Gas from Yahoo Finance (no API key required)
- **News Intelligence** — 500+ articles/day from maritime and energy sources, keyword filtered, sentiment scored
- **Demo Mode** — If AISstream is offline, the dashboard auto-switches to 50 realistic demo vessels so it's always usable
- **Risk Scoring** — Each vessel gets a 0-100 shadow fleet risk score based on flag, destination, AIS gaps, name patterns

---

## Monitored Zones

| Zone | Why It Matters |
|------|----------------|
| **Strait of Hormuz** | ~20% of global oil supply passes through here. Iran can threaten to block it. |
| **Norway → Murmansk** | Russia's shadow fleet route — old tankers hauling sanctioned crude under flags of convenience |
| **North Sea** | European oil hub, UK/Norway offshore fields |
| **Suez Canal** | Asia-Europe chokepoint — Houthi attacks, Egyptian politics |

---

## Risk Scoring

Each vessel is scored 0–100 for shadow fleet likelihood:

| Factor | Score |
|--------|-------|
| Tanker (ship type 80–89) | +20 |
| Flag of convenience (Panama, Liberia, Marshall Islands…) | +20 |
| Russian port destination | +15 |
| Norway-Murmansk zone | +10 |
| AIS gap > 60 min (dark ship) | +15 |
| Suspicious vessel name (TRUST, GLORY, FORTUNE…) | +10 |
| Anchored in open water | +10 |

**70+** = CRITICAL (alert generated)
**50–69** = HIGH
**30–49** = MEDIUM

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Map | react-leaflet + Canvas renderer (no WebGL/GPU required) |
| Backend | Bun (HTTP + WebSocket server) |
| AIS Data | aisstream.io (free WebSocket API) |
| Prices | Yahoo Finance (free, no key) + EIA API (optional) |
| News | Google News RSS (6 maritime/energy feeds) |
| Database | ClickHouse (optional — in-memory fallback if not running) |

---

## Getting Started

### 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/deepscope.git
cd deepscope
```

### 2. Get a Free AIS API Key

Go to **[aisstream.io](https://aisstream.io)** → Sign up → Copy your API key.

This gives you a free WebSocket stream of real-time ship positions worldwide.
Without it, the dashboard runs in Demo Mode (50 realistic pre-loaded vessels).

> **Note:** As of early 2026, aisstream.io is in beta and occasionally experiences instability.
> DeepScope auto-detects silence and switches to Demo Mode after 3 minutes — so the dashboard is always functional.

### 3. Configure Environment

```bash
cd apps/server
cp .env.example .env
```

Edit `.env` and add your API key:

```env
AISSTREAM_API_KEY=your_key_here
```

Oil prices work automatically via Yahoo Finance — **no API key needed**.

### 4. Start the Backend

```bash
cd apps/server
bun install
bun run src/index.ts
```

Server starts on **http://localhost:4000**

### 5. Start the Frontend

```bash
cd apps/web
npm install
npm run dev
```

Frontend starts on **http://localhost:3847**

---

## Where to See Live Ships (Alternative Sources)

If you want to compare DeepScope data against other sources:

| Site | What it shows |
|------|---------------|
| **[MarineTraffic.com](https://www.marinetraffic.com)** | The industry standard. Free tier shows live positions, vessel details, port movements |
| **[VesselFinder.com](https://www.vesselfinder.com)** | Similar to MarineTraffic, good free tier |
| **[Kystverket AIS](https://kart.kystverket.no)** | Norwegian Coastal Administration — excellent for Norway corridor tracking |
| **[AISHub](https://www.aishub.net)** | Community AIS network, requires contributing a receiver for full access |
| **[Windyty / Windy](https://www.windy.com)** | Has a ship layer alongside weather data |
| **[FleetMon](https://www.fleetmon.com)** | Maritime intelligence platform |

For the shadow fleet specifically:
- **[CREA Energy Tracker](https://energyandcleanair.org)** — Tracks sanctioned Russian oil flows
- **[Kpler](https://www.kpler.com)** — Professional tanker tracking (paid)
- **[Vortexa](https://www.vortexa.com)** — Energy cargo analytics (paid)

---

## API Keys You Can Get for Free

| Service | What For | Link | Cost |
|---------|----------|------|------|
| **aisstream.io** | Real-time AIS ship positions | [aisstream.io](https://aisstream.io) | Free beta |
| **EIA API** | Official US government petroleum prices | [eia.gov/opendata](https://www.eia.gov/opendata/) | Free |
| **Yahoo Finance** | Real-time commodity prices | No key needed | Free |

---

## Architecture

```
                    aisstream.io WebSocket
                           ↓
              ┌─── AIS Worker (ais.worker.ts) ───┐
              │  - Silence detection              │
              │  - Risk scoring (0-100)           │
              │  - 50 demo vessels fallback       │
              └───────────────┬──────────────────┘
                              │
              ┌─── Price Worker (price.worker.ts) ┐
              │  - Yahoo Finance (real-time)       │
              │  - EIA API (optional)              │
              └───────────────┬───────────────────┘
                              │
              ┌─── News Worker (news.worker.ts) ───┐
              │  - 6 Google News RSS feeds          │
              │  - Sentiment analysis               │
              │  - 500+ articles/day               │
              └───────────────┬────────────────────┘
                              │
                    Bun HTTP Server :4000
                    REST API + WebSocket
                              │
                    Next.js Frontend :3847
              ┌───────────────┼───────────────────┐
              │               │                   │
           Map (Leaflet)  KPI Cards          News Feed
           Ship positions  Risk counts        Live articles
```

---

## Roadmap

- [ ] **X/Twitter integration** — Monitor geopolitical posts about shipping routes in real-time
- [ ] **GDELT event monitor** — Cross-reference news events with ship movements automatically
- [ ] **Fact-check engine** — "Iran blocking Hormuz" claim → verify against actual AIS data
- [ ] **Dark ship detection** — Alert when a vessel's AIS goes silent in suspicious circumstances
- [ ] **STS transfer detection** — Ship-to-ship transfers (common in sanctions evasion)
- [ ] **Historical trails** — Show vessel route history on the map
- [ ] **Trading signals** — Export intelligence to trading bots (Tristan Wolf integration)
- [ ] **ClickHouse persistence** — Full historical database for pattern analysis

---

## Running with Docker (ClickHouse included)

```bash
docker compose up -d
```

This starts:
- ClickHouse database (data persistence, historical queries)
- You still need to start the Bun server and Next.js manually

---

## License

MIT — do whatever you want with it.

---

## Acknowledgements

- [aisstream.io](https://aisstream.io) — Free AIS WebSocket stream
- [Leaflet.js](https://leafletjs.com) — Map rendering
- [Yahoo Finance](https://finance.yahoo.com) — Commodity prices
- [GDELT Project](https://www.gdeltproject.org) — Global event data (coming soon)

---

*Built because reading "Iran threatens Hormuz" in the news and not being able to verify it with real ship data is frustrating.*
