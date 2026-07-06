# Missions 6 + 9 — Distributed Configuration Platform & Predictive Capacity Planning

Mission 6 (the prompt's *highest priority*) with Mission 9, because the config
platform's reason to exist is governing the resilience/observability knobs built
in prior missions, and capacity planning consumes the runtime-intelligence
history. Both are additive, reversible, and validated: **34 unit tests + 6 new
chaos-harness checks (W12/W13), all green (84/84 total)**.

- **Config platform** — `src/config/config.service.js`
- **Capacity planner** — `src/observability/capacity.planner.js`
- **Wiring** — `container.js` (9 registered knobs with live appliers), `health.service.js` (`tick()` + `record()` on the probe cycle)
- **Control plane** — `/v1/admin/config*`, `/v1/admin/capacity`, folded into `/overview`
- **Tests / gate** — `tests/config-capacity.test.js`, `motse:coverage:config` (≥95/95/90)
- **Validation** — harness `W12` (live config under emergency ops) + `W13` (forecasting)

---

## Executive summary

**Mission 6** turns the existing feature-flag capability into a full operational
**configuration platform** that governs the running resilience/observability
subsystems with **zero restart**. Nine typed, validated knobs (circuit-breaker
threshold + cooldown, bulkhead limit, load-shed in-flight + lag thresholds, retry
budget, health-probe timeout, OTLP batch size, outbox max-attempts) each carry a
**live applier** that mutates the already-constructed object. Every change is
validated (a bad threshold is rejected), versioned (append-only revisions with
rollback), and auditable. It adds **percentage/canary rollout** (deterministic
subject hashing), **per-subject targeting**, **scheduled activation/expiration**,
named **snapshots** with restore, and **emergency operations** — a global kill
switch and safe mode that force flagged knobs to safe values, reversibly. The
domain `FlagService` (per-ward pilot flags) is untouched.

**Mission 9** forecasts infrastructure needs from measured trend, not static
rules. `CapacityPlanner` records a coarse growth sample each health cycle (heap,
RSS, event-loop utilization, outbox backlog/archive, store rows) and projects each
to its limit via least-squares slope, emitting **30/90/180/365-day forecasts**,
**time-to-exhaustion**, and **confidence** (R² × sample weight) with stated
assumptions. It derives **autoscaling recommendations** (scale out/in compute on
event-loop utilization, raise memory before the heap limit, add queue consumers on
backlog growth) from observed workload — never a fixed threshold.

## Business justification

Tuning a resilience threshold or tripping an emergency kill switch previously
meant a redeploy — minutes of exposure during an incident. Live config makes it
seconds and auditable, and safe mode gives operators one lever to shrink every
blast-radius knob at once. Capacity planning replaces "we OOM-killed at 2am" with
a dated, confidence-scored projection and a concrete scaling recommendation —
essential for a national platform whose growth is a policy input, not a surprise.

## Current state → gap → design

**Gap (M6):** the resilience knobs (Mission 8) and telemetry/health settings were
construction-time constants; changing one required a restart, and there was no
versioning, rollout, scheduling, or emergency control over operational behaviour.
**Design:** `ConfigService` holds typed keys, each with `validate` and `apply`.
`set()` validates → stores a revision → applies live → audits/events. `effective(key, subject)`
resolves precedence: **kill switch / safe mode (managed keys) > per-subject target
> rollout bucket > current value**. Rollout uses SHA-256(`salt:subject`) mod 100
for a stable, uniform split (canary = low percent). Scheduling stages a
`pendingValue`; `tick()` (driven by the health cycle — no new timer) activates and
expires due changes. Snapshots capture all values; restore re-sets only what
differs. Appliers are fail-safe (a throwing applier is swallowed — a config change
must never crash the platform).

**Gap (M9):** runtime intelligence (Mission 5) detected *current* pressure but
did not *forecast*. **Design:** `CapacityPlanner.record()` snapshots resource
counters into a long-horizon ring; `project(field)` fits a slope, projects to a
limit, and scores confidence from R² and sample count; `forecast()` assembles
memory/storage/backlog projections plus trend-derived scaling recommendations.

## Alternatives considered

- **etcd / Consul / LaunchDarkly (M6):** rejected — external dependency and egress
  for what is an in-process concern; the in-house service shares the platform's
  audit/event/metrics model and is chaos-testable. A distributed backend is a
  documented extension (the Store/KV seam is ready).
- **Overloading FlagService (M6):** rejected — its scope precedence (ward/morafe)
  and boolean-flag semantics differ from typed operational config with appliers;
  keeping them separate avoids coupling and preserves the domain flag contract.
- **A forecasting library / Prophet (M9):** rejected — over-engineered for the
  linear trends that dominate here; least-squares + R² confidence is transparent,
  dependency-free, and honest about uncertainty. Non-linear models are a future
  extension once data justifies them.
- **Static autoscaling thresholds (M9):** rejected by the mission's own rule —
  recommendations must derive from observed workload.

## Trade-offs & risks

- Config is per-process; multi-pod deployments each hold their own copy. For
  cross-pod propagation, the change event (`config.changed`) is the seam — a
  documented extension; today each pod is independently and safely configurable.
- Appliers mutate live objects; a mis-registered applier could set a wrong field —
  mitigated by validators, the fail-safe wrapper, and full test coverage of every
  registered knob's application.
- Forecasts assume a linear trend over the observed window; confidence makes this
  explicit and low-R² projections are labelled as such, so operators don't act on
  noise. Risk of premature scaling is mitigated by urgency tiers and the
  hold-by-default recommendation.
- Kill switch is powerful; it is audited, reversible, and only affects keys
  explicitly marked `emergencyManaged`.

## Security & performance impact

All config/capacity routes reuse the `platform_admin(platform)` L3 guard; every
mutation is audited (actor, before/after, reason) and evented. No new inbound
surface, no secrets in config values. Performance: `set`/`effective` are O(1) map
ops; rollout hashing is one SHA-256 per evaluation (only on targeted reads);
capacity `record()` is one cheap snapshot per health cycle; `forecast()` is O(samples)
and computed on demand. Full suite + harness confirm zero regression and ledger
integrity through W12's emergency-ops phase.

## Operational impact & control plane

- `GET /v1/admin/config` (+ `/:key/history`), `PUT /v1/admin/config/:key`
  (value, reason, activate_at, expire_at), `POST /:key/rollout|target|rollback`,
  `POST /config/snapshots[/:label/restore]`, `POST /config/kill-switch|safe-mode`.
- `GET /v1/admin/capacity` (forecast + recommendations), `POST /capacity/sample`.
- `/v1/admin/overview` now folds in `config` stats and the `capacity` forecast.
- New Grafana dashboards: `config` (changes by op, kill-switch/safe-mode state)
  and the runtime/resilience dashboards from prior missions.

## Testing strategy & validation results

- **Unit (`tests/config-capacity.test.js`, 34):** config typing/validation, live
  apply, revisions + rollback, snapshot/restore (incl. skip-unchanged), rollout
  determinism + distribution, targeting precedence, schedule activate/expire,
  kill switch + safe mode reversibility, fail-safe appliers, guard rails;
  capacity slope/forecast/time-to-limit/confidence, insufficient-data guard,
  scale-out/scale-in/hold recommendations, R² fit; live application to the real
  platform + HTTP control plane.
- **Chaos (harness W12/W13):** a config change applies to the running breaker with
  zero restart; validation rejects a bad value; kill switch forces then restores a
  safe value; snapshot restore reverts; capacity forecast yields multi-horizon
  projections with confidence + assumptions and ≥1 recommendation.
- **Results:** motse suite **667 green** (was 640; +27), root 131 green, harness
  **84/84 PASS** full + smoke. Gates: foundation 99.4/94.7, observability
  98.0/90.9, enterprise 98.8/91.1, resilience 97.7/92.8, **config 95.8/90.4** —
  all ≥95/95/90.

## Rollback plan

Fully reversible. Config and capacity are new modules plus wiring; the health-cycle
hooks are two guarded calls. No knob is *required* to be set — every registered key
seeds its default on boot, so removing the config layer restores construction-time
constants exactly. Reverting the commit removes everything with no schema, state,
or API-contract change. At runtime, `restore` a snapshot or flip the kill switch to
undo any change instantly.

## Future extension points

Cross-pod config propagation via the `config.changed` event + KV; approval
workflow (the revision log is the audit trail already); config values persisted to
the Store for restart durability; non-linear capacity models and cost projection
once billing data is wired; feed capacity recommendations into an autoscaler
(HPA) and the SLO burn-rate alerts.

## Production readiness assessment & success criteria — met

✅ Operational behaviour is adjusted through **centralized, versioned, validated
runtime config with zero restart**, with rollout, scheduling, snapshots, rollback,
and emergency kill switch / safe mode — all audited and reversible. ✅ Infrastructure
growth, capacity limits, and scaling needs are **forecast from historical runtime
intelligence with stated confidence and assumptions**, not static thresholds. ✅
All existing guarantees intact (transactions, idempotency, observability,
resilience, backward compatibility); coverage gate added, none weakened; CI
enforces it. The platform now adapts its own operational behaviour safely at
runtime and predicts when it will need to grow.
