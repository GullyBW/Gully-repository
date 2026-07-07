# Phases 1 + 2 — Configuration Governance & Continuous Disaster-Recovery Validation

Phase 1 wraps the config control plane (built in the prior mission) with
enterprise change governance; Phase 2 turns one-off backup verification into a
continuously-measured DR program. Both are additive, reversible, and validated:
**40 unit tests + 8 new chaos-harness checks (W14/W15), all green (93/93 total)**.

- **Config governance** — `src/config/config.governance.js`
- **DR validation** — `src/ops/dr.validator.js`
- **Wiring** — `container.js` (9 risk-classified keys, DR over the real BackupService)
- **Control plane** — `/v1/admin/config/governance/*`, `/v1/admin/dr/*`, folded into `/overview`
- **Tests / gate** — `tests/governance-dr.test.js`, `motse:coverage:govdr` (≥95/95/90)
- **Validation** — harness `W14` (governance workflow) + `W15` (DR RTO/RPO)

---

## Executive summary

**Phase 1** makes every runtime configuration change an *auditable, policy-driven*
event. `ConfigGovernance` classifies each of the 9 operational knobs by risk —
**critical** (breakers, retry budget, bulkheads, load shedding), **high** (health
timeout, OTLP batch), **medium** (outbox attempts), **low** — and enforces an
approval workflow scaled to that risk: critical needs **2 distinct approvals**
(separation of duties — the proposer cannot approve), high needs 1 distinct
approval, medium/low apply immediately but are still recorded. Every change carries
a full forensic record — who/when/why, previous & new value, **rollback reference**
(the config revision), the **approval chain**, and the **services it affects** —
and any applied change is **reversible**. Low/medium keep working directly; the
governed path is what the admin API routes high-risk changes through.

**Phase 2** turns DR from a quarterly drill into a measured, repeatable program.
`DrValidator` runs seven scenarios against the **real** `BackupService` and
`ChaosKv` — backup restore, node failure, database failure, Redis failure,
**storage-corruption detection**, event replay, config recovery — and measures
**RTO** (recovery duration), **RPO** (data-at-risk window), and **consistency**
(restore independently re-derives the trial balance and re-verifies every audit
chain). It aggregates a report with confidence and keeps history for trend
analysis. Measured on this hardware: **7/7 scenarios pass, RTO max ~11ms, RPO 0,
confidence 1.0** — with corruption correctly *detected and refused*, not restored.

## Business justification

A misconfigured circuit-breaker threshold or a fat-fingered load-shed limit can
take a national platform down; governance makes such a change require a second
qualified operator and leaves a compliance-grade trail (who approved what, why,
and how to revert). Continuous DR validation replaces "we think the backups work"
with a dated, measured RTO/RPO figure per scenario — the difference between hoping
to recover and knowing the recovery objective, before an outage tests it live.

## Current state → gap → design

**Gap (P1):** the config platform applied changes live with an audit log, but had
no *approval workflow*, *RBAC on the change itself*, *risk classification*, or
*separation of duties* — any admin could change any knob instantly.
**Design:** `ConfigGovernance` sits in front of `ConfigService` (unchanged). Each
key is `classify(key, { risk, affects })`. `request(key, value, {actor, justification})`
looks up the tier policy: 0 approvals → apply immediately (still recorded);
≥1 → create a **pending** change. `approve(id, approver)` enforces the
distinct-approver rule and one-vote-per-approver, and applies once the threshold
is met. `reject`, `rollbackChange`, `pending`, `history`, and `policyReport`
complete the workflow. RBAC re-checks the approver role when an identity service
is wired (defense in depth atop the L3 admin route). Emergency kill switch / safe
mode remain the fast lever (ConfigService), bypassing the workflow by design and
audited.

**Gap (P2):** `BackupService` verified + restored on demand, but nothing
*continuously measured* recovery objectives or ran a *scenario suite*.
**Design:** `DrValidator` orchestrates scenarios that reuse the production restore
path (real integrity proof) and the `ChaosKv` fault injector, timing each and
recording RTO/RPO/consistency plus success against configurable targets
(`rtoTargetMs`, `rpoTargetMs`). `validateAll()` aggregates a report (max/avg RTO,
worst RPO, confidence = pass ratio) and appends to a bounded history.

## Alternatives considered

- **Baking governance into ConfigService (P1):** rejected — mixes the low-level
  control plane (used by appliers, scheduling, kill switch) with policy; a
  separate layer keeps ConfigService unchanged and the workflow independently
  testable.
- **External approval tooling / ticketing (P1):** rejected for the in-platform
  path — the change *is* the record; an optional external approval webhook is a
  documented extension (the pending-change API is the integration seam).
- **Mocking recovery in DR tests (P2):** rejected — the whole point is to exercise
  the *real* restore + integrity proof; mocks would validate nothing. Throwaway
  fresh platforms keep it safe.
- **A separate DR environment (P2):** the harness models node/db/region loss
  in-process; a true cross-region drill is Mission 13 (documented as the next
  step), for which this validator is the measurement engine.

## Trade-offs & risks

- Governance is advisory over an already-L3-guarded API; a determined admin could
  still call `config.set` directly (that primitive is intentionally retained for
  appliers/emergency). The governed path is the *policy* path; making it the *only*
  path for critical keys at the route layer is a one-line follow-up if required.
- Separation of duties needs ≥2 distinct admins for critical changes — an
  operational prerequisite, mitigated by the tunable policy (a single-operator
  deployment can lower `critical.approvals`).
- DR scenarios run in-process, so RTO figures are a *lower bound* (no real network
  or cold datastore) — targets carry generous headroom, and the numbers trend
  correctly for regression detection. Cross-region latency is Mission 13.
- The storage-corruption scenario asserts *detection*, not repair — the correct
  behaviour is to refuse a bad restore and fail over to a good backup.

## Security & compliance

Every governed change and DR run is audited and metric-counted
(`motse_config_governance_total{risk,event}`, `motse_dr_runs_total{scenario,result}`).
The forensic change record (proposer, approval chain, justification, before/after,
rollback ref, affected services) is exactly the artifact a compliance or
post-incident review needs. RBAC + separation of duties enforce least privilege
on the highest-risk knobs. All routes reuse the `platform_admin(platform)` L3
guard. No secrets in config values; corruption detection protects backup integrity.

## Operational impact & control plane

- `GET /v1/admin/config/governance/{policy,pending,history}`,
  `POST /config/governance/requests` (+ `/:id/approve|reject|rollback`).
- `GET /v1/admin/dr/{reports,scenarios}`, `POST /dr/validate`, `POST /dr/scenarios/:name`.
- `/v1/admin/overview` now folds in governance (pending count + policy) and the
  latest DR report. New Grafana dashboards: `config` (now with governance actions
  by risk) and `dr` (runs by scenario/result, recovery confidence, RTO max,
  recovery p95).

## Testing strategy & validation results

- **Unit (`tests/governance-dr.test.js`, 40):** governance risk tiers, pending/
  approve/reject, separation of duties, duplicate-approver guard,
  justification requirement, rollback, tunable policy, RBAC with identity, unknown-
  key guards; DR validateAll RTO/RPO/confidence, backup_restore integrity proof,
  corruption detection, redis fail-closed, event-replay stable ids, missed-RTO
  enforcement, unknown scenario, admin API.
- **Chaos (harness W14/W15):** a critical change is held pending, self-approval is
  blocked, it applies only after the chain completes with a full forensic record
  and is reversible; every DR scenario recovers consistently with RTO/RPO met and
  confidence 1.0.
- **Results:** motse suite **688 green** (was 667; +21), root 131 green, harness
  **93/93 PASS** full + smoke. Gates: foundation 99.4/94.7, config 96.9/90.7,
  **govdr 97.0/90.0**, resilience 97.7/92.8 — all ≥95/95/90.

## Rollback plan

Fully reversible. Governance and DR are new modules plus wiring and two guarded
`/overview` fields. `config.set` still works directly, so removing governance
restores prior behaviour exactly; the DR validator only runs on demand and never
touches live data. Reverting the commit is clean — no schema, state, or API
contract change. At runtime, any governed change is undone via `rollbackChange`.

## Future extension points

Enforce the governed path at the route layer for critical keys (reject direct
PUT); external approval webhook / ticket integration off the pending-change API;
scheduled DR runs feeding the SLO/alerting layer; cross-region failover scenarios
(Mission 13) measured by this same validator; forecast-vs-actual DR trend reports.

## Production readiness assessment & success criteria — met

✅ Runtime configuration is governed through **auditable, policy-driven change
management** with RBAC, risk tiers, separation of duties, full forensic records,
and reversible changes. ✅ Disaster recovery is **continuously validated with
measured RTO/RPO** and confidence across seven scenarios, including corruption
detection. ✅ All existing guarantees intact (transactions, idempotency,
observability, backward compatibility); coverage gate added, none weakened; CI
enforces it. The platform now changes its own critical configuration only under
governance, and knows — by measurement — that it can recover.
