# VTS — Vessel Traffic Service

An operator system for a harbour master's VTS centre. It builds a live traffic image from AIS, watches it with VTS rules (close quarters, speed, restricted areas, anchor drag, lost AIS, permit checks), records the VTS log, issues traffic clearances and replays past traffic. It works on its own or linked to a **Port Community System (PCS)**: it receives the port calls and reports vessel movements back automatically.

![Operator console: traffic image, vessel card with PCS status, alerts](docs/console.png)

## What the harbour master gets

| Area | Capability |
|---|---|
| Traffic image | Live AIS targets on a dark ECDIS-style map: speed/course vectors (6 min), name labels, track history, anchor watch circle; colour by traffic state (inbound, outbound, at anchor, berthed); flashing ring on vessels with open alerts |
| Zones | VTS area, fairway, anchorages, pilot boarding ground, restricted areas, precautionary areas (speed limits, charted depth), berths mapped to PCS berth codes, reporting lines |
| Alerts | CPA/TCPA close quarters · speed over zone limit · inside a restricted area · anchor dragging · AIS lost · **entering the fairway without a PCS entry permit** · **leaving the berth without PCS departure clearance** · large vessel in port waters with no PCS call · draught vs charted depth. Acknowledge with a note, close, auto-clear when the condition ends |
| Traffic list | Vessels grouped by state, with PCS call and status |
| Vessel card | AIS static/voyage data, position, zones, PCS port call (agent, berth, ETA/ETD, entry permit, departure clearance, dangerous goods), open alerts, vessel log; actions: issue clearance, log a VHF call, report a movement to the PCS |
| Clearances | Enter fairway, proceed to anchorage, leave berth, shift berth, anchor; time-limited, revocable, with a warning when the PCS state does not support it |
| VTS log | Automatic events (zone entry/exit, reporting points, state changes, alerts, PCS updates) plus operator entries (VHF, instructions, incidents, notes) |
| Replay | Reconstruct the traffic image for any window up to 6 h, with the log alongside, for incident investigation |
| Settings | Alert thresholds, zone speed limits/depths, AIS input status, users |

Roles: `VTS_ADMIN`, `VTS_SUPERVISOR` (harbour master: thresholds, zones), `VTS_OPERATOR` (alerts, clearances, log, movements), `VTS_VIEWER` (read only).

## PCS integration

```
            vessel calls, permits, clearances (poll every 30 s + signed webhooks → immediate resync)
   PCS  ───────────────────────────────────────────────────────────────────────────▶  VTS
        ◀───────────────────────────────────────────────────────────────────────────
            ATA / all fast / ATD from AIS (retrying outbox) · live AIS picture for the PCS port map
```

* **PCS → VTS:** `GET /api/vessel-calls` with an API key (role of the issuing PCS user, normally the harbour master). The PCS webhook (`x-pcs-signature: sha256=<HMAC>`) on `/api/pcs/webhook` triggers an immediate resync.
* **VTS → PCS:** when a cleared vessel enters the VTS area the VTS posts `arrived`; when it stops in its berth zone, `berthed`; when a departure-cleared vessel leaves the area, `departed`. Reports go through an outbox (idempotent per call and movement, retried up to 20 times) and can be sent or corrected manually from the vessel card. The live picture is pushed to `POST /api/ais/positions`, and the PCS map then shows VTS positions instead of its own simulation.

## AIS input (`AIS_SOURCE`)

| Value | Use |
|---|---|
| `NMEA_TCP` | AIS base station, receiver or network feed speaking NMEA 0183 `!AIVDM` over TCP (`NMEA_HOST`, `NMEA_PORT`), reconnects with back-off |
| `NMEA_UDP` | the same, received on a UDP port |
| `PROVIDER` | commercial AIS data API, polled every 30 s (`AIS_PROVIDER_URL`, `AIS_PROVIDER_KEY`; generic JSON mapping in `src/ais/sources.ts`) |
| `SIMULATOR` | demo traffic: PCS port calls (anchor and wait without a permit, proceed to berth once cleared, depart when cleared), pilot boat, tug, fishing vessel, an anchored ship that sometimes drags, passing traffic. The simulator emits genuine AIVDM sentences through the same decoder as a live feed |

The built-in decoder handles message types 1/2/3, 5 (multipart), 18, 19 and 24, and validates checksums.

## Run locally

```bash
npm ci
createdb vts
export ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/vts DATABASE_URL=postgres://vts_app:vts_app@localhost:5432/vts
npm run db:migrate && npm run db:seed
npm run dev:api          # :4100 (migrates/seeds on start, simulator on)
npm run dev:web          # :5174
# link a PCS:  PCS_URL=http://localhost:4000 PCS_API_KEY=pcs_... PCS_WEBHOOK_SECRET=... npm run dev:api
```

Demo users (password `Vts-demo-2026` locally, generated in Azure): `harbour@vts.demo` (harbour master), `operator@vts.demo`, `viewer@vts.demo`, `admin@vts.demo`. The demo centre covers *Demo Port Alpha* (PCS port `ZZALP`).

Tests: `npm test` — AIS decoding against reference sentences, geometry and CPA, and integration tests of the engine rules and the PCS bridge against PostgreSQL and a mock PCS.

## Deploy (Azure, GitHub Actions)

`.github/workflows/ci-cd.yml`: typecheck, tests and console build → security scans (npm audit, gitleaks, Trivy, Bicep) → image build, scan and container smoke test → deploy to Azure Container Apps (`infra/main.bicep`) → link to the PCS → smoke test against Azure, with rollback on failure.

1. In Azure Cloud Shell: `bash infra/github-oidc-setup.sh <shared-rg> <pcs-rg> rg-vts-dev centralindia indranil32/vts azure-dev <repo-id> <owner-id>`.
2. Put the printed variables on the repository's `azure-dev` environment.
3. Push to `main`. The first deploy creates the `vts` database and roles on the shared server. It then signs in to the PCS as its harbour master (`PCS_LINK_USER`), creates an API key and a webhook, and stores both as container app secrets.
