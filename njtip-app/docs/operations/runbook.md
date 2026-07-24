# Operational Runbook (Phase 7)

**Scope:** running the NJTIP MVP (synthetic). Production operations (real DB/HSM/IdP) extend these
per the component transition matrix. **No production data; go-live is a human Oversight Board decision.**

## Start / stop
```bash
# local
cd njtip-app && npm start                 # http://localhost:8087
# container (from repo root, Docker build context = repo so it can copy the Twin)
docker build -f njtip-app/Dockerfile -t njtip-app .
docker run -p 8087:8087 -v njtip-data:/srv/njtip-app/data njtip-app
```
Startup runs `scripts/assure.js` first: **if architecture invariants fail, the app does not start.**

## Configuration (env)
| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | 8087 | listen port |
| `NJTIP_MODE` | synthetic | `synthetic` \| `production-shaped` |
| `NJTIP_PERSISTENCE` | memory | `memory` \| `file` (zone-isolated dirs) |
| `NJTIP_DATA_DIR` | ./data | file-persistence root |
| `NJTIP_SESSION_SECRET` | (synthetic) | **from secrets manager in prod** |
| `NJTIP_LOG_LEVEL` | info | error\|warn\|info\|debug |

## Health, readiness, metrics
- `GET /healthz` — liveness + component checks (audit/custody/invariants). 200 healthy / 503 unhealthy.
- `GET /readyz` — 200 only when architecture invariants hold.
- `GET /metrics` — Prometheus text (request counts, latency p95, domain counters).
- `GET /api/admin/{health,metrics,config}` — admin-authenticated; config is **secret-redacted**.

## Monitoring & alerting (thresholds — tune per baseline)
| Signal | Alert when |
|--------|-----------|
| `/healthz` != healthy | any check fails (page) |
| `architecture-invariants` check fail | **page immediately** (deploy should have been blocked) |
| `njtip_http_latency_ms_p95` | > target for 5m |
| 5xx rate | > 1% for 5m |
| audit/custody integrity | any failure → **security incident** |

## Common procedures
- **Incident (suspected integrity/security):** capture `traceId` from logs; `GET /api/evidence/bundle`
  + independent `njtip-twin` `verify-evidence`; convene IRB; never attempt to look up reporter identity
  (none exists).
- **Backup:** persistence is per-zone dirs under `NJTIP_DATA_DIR`; snapshot the volume. Governance
  ledger + evidence archive are append-only + hash-chained (tamper-evident).
- **Restore / DR:** restore the volume; run `npm test` + `scripts/assure.js` to confirm invariants
  before serving. RTO/RPO drills per blueprint design/04.
- **Rollback:** redeploy the previous image tag; state is on the mounted volume; verify `/readyz`.
- **Rotate session secret:** set `NJTIP_SESSION_SECRET` (invalidates existing sessions), restart.

## Logs
Structured JSON, **PII-redacting** (no identity/content/IP/tokens). Correlate by `traceId`. The intake
path emits only aggregate signals (no per-report telemetry).
