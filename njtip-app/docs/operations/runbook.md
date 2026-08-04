# Operational Runbook (Phase 7)

**Scope:** running the NJTIP MVP (synthetic). Production operations (real DB/HSM/IdP) extend these
per the component transition matrix. **No production data; go-live is a human Oversight Board decision.**

## Prerequisites

Before you start, all of these must be true. If any is not, stop and escalate rather than improvising —
a procedure begun without its prerequisites is how a recovery becomes an incident.

| Prerequisite | Check |
|---|---|
| You hold the role the procedure requires | Every route below states one: `admin`, `oversight-board` or `investigator` |
| Node.js is available | `node --version` — the platform has zero runtime dependencies, so nothing else is needed |
| The invariant gate passes on the current build | `npm run twin` → all invariants hold |
| You know which zone you are acting in | `independent`, `executive` or `judiciary`; they are separated on purpose |
| For anything touching evidence or custody | A second named human is available to witness — no single person completes a custody action |

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
| burn-rate (fast window) | budget exhausting inside the fast window → page; a **recovered** incident stops paging on its own |
| predictive lead time | any predictor reporting `imminent` (≤ 7 days to threshold) |
| escalation unacknowledged | any escalation past its 24 h acknowledgement window |
| unmapped affected component | a mission-impact forecast reporting `unmappedComponents` — citizen impact is **unknown**, which is not the same as none |

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

---

## Partition & consistency posture (Phase 12)

`GET /api/resilience/consistency` · `GET /api/resilience/consistency/failover/<comma-separated regions>`

During a partition, read the posture matrix to decide **what to shed**, not to guess:

- A context reported `unavailable` is refusing rather than degrading. **That is the correct
  outcome** — it cannot meet its declared consistency model, so it serves nothing rather than
  serving a weaker answer under the stronger name. Do not "fix" it by relaxing the model.
- A context reported `read-only` has lost write quorum. Reads continue; writes are refused.
- **Rows marked `sessionDependent: true` are capability statements, not decisions.**
  `read-your-writes` (investigation) and `monotonic-reads` (analytics) are per-session guarantees,
  so the posture view cannot settle them — it does not know who will ask. The per-session guarantee
  is settled at read time by `readAllowed()`, which refuses when no session token is supplied.
  A row saying "allowed" for one of these means *this region may serve this context at all*, not
  *every read will succeed*. ([ADR-0007](../adr/0007-session-consistency-and-adr-review-lifecycle.md))

New failure mode to expect: **"refused because your session token is missing."** Operators have not
seen this before Phase 12. `readAllowed()` returns the specific reason text; it is a caller defect,
not a partition symptom.

## Rehearsing a change before making it

`POST /api/twin/operations/simulate` — scenarios: `infrastructure-change`, `policy-update`,
`governance-change`, `operational-failure`, `migration-plan`, `dr-exercise`.

The twin is built from the architecture-of-record on every call and simulates against a deep clone;
the baseline digest is re-derived and compared after every run, so a simulation **cannot** touch
production state. Use it for DR drills and zone-withdrawal rehearsals instead of the real thing.

Two things the output is deliberately careful about, and that you must read as written:

- **The blast radius is a lower bound.** Traversal is over *declared* dependencies. An undeclared
  dependency does not appear. Do not treat a small radius as a small change.
- **`safe: true` is not approval.** It means no blocking finding against the declared model.

## Before a deployment

| Check | Route | Blocks on |
|---|---|---|
| Supply-chain deployability | `POST /api/supply-chain/deployability` | untrusted/unidentified builder; **zero vulnerability scans** (zero scans is not zero findings) |
| Consumer release impact | `POST /api/contracts/release-impact` | a constitutional consumer broken; two changes landing on one consumer at once; **nothing submitted for assessment** |
| Mission impact forecast | `POST /api/observability/mission-forecast` | any citizen impact; any **unmapped or unmodelled** affected component |
| Predictive reliability | `GET /api/observability/predictive` | a predictor at `imminent` lead time |

All four are advisory to a human: each returns `authorizes: false`. Deployment remains a recorded
decision by the approving authority.

## Escalations

`GET /api/governance/continuity/dashboard`

An escalation moves `raised → acknowledged → resolved`. **Resolution cannot skip acknowledgement** —
"resolved without anyone admitting they saw it" is the record that makes an after-the-fact review
impossible. An escalation unacknowledged past 24 h appears in `unacknowledged` with the board it
escalates to.

The dashboard reports `activeCoverage` separately from `availabilityCoverage`: availability is what
somebody declared, activity is what they did, training is what they are certified to do. A role can
be fully staffed on paper and still not actively owned.

> **Expect `sound: false` on a fresh deployment.** The activity and training registers start empty,
> so every owner reads as `never-acted` and the dashboard says so. That is accurate, not a defect —
> record real governance acts and completions rather than seeding them.

## Communication

Who is told, and when. An incident nobody communicated is an incident that repeats, and a recovery
nobody announced is one the next shift undoes.

| Event | Notify | When |
|---|---|---|
| Any `/healthz` failure or paged alert | Operations Review Board duty officer | Immediately, before starting recovery |
| Suspected integrity or security incident | Information Security Review Board **and** the Oversight Board | Immediately — do not wait for confirmation |
| A context reported `unavailable` during a partition | ORB duty officer; the accountable authority for that context | Within the acknowledgement window (24 h), sooner if constitutional |
| Constitutional path affected (anonymous reporting, evidence custody) | Oversight Board | Immediately. This is the one escalation that does not wait for triage |
| Recovery complete | Everyone notified above, plus the next shift | Before standing down, with the `traceId` and what was changed |
| A documented procedure that did not work | The document's owner, via an escalation | Same day — a runbook that misled somebody is a defect, not a nuisance |

Record every notification against the incident's `traceId`. Notifications are part of the evidence
package; an escalation raised and never acknowledged is reported by
`GET /api/governance/continuity/dashboard` and does not close itself.
