# FINAL Phase 5 — Enterprise Validation (Evidence Integrity Gate)

The capstone. Four phases made the platform measure, validate, explain and learn
from itself; this one **stops that from silently rotting.** A CI evidence-integrity
gate fails the build whenever evidence quality regresses — a dashboard references a
metric the code no longer emits, a recommendation lacks evidence, a confidence
score is unjustified, a runtime knob is ungoverned, or a domain report drops a
field. Additive, independently testable, and validated: **14 unit tests, all green
(800 total), and the gate passes the real platform with 0 findings.**

- **Evidence integrity** — `src/observability/evidence.integrity.js`
- **CI gate** — `motse/scripts/evidence-integrity.js` (`npm run motse:evidence`, exit 1 on any finding)
- **Tests / gate** — `tests/evidence-integrity.test.js`, `motse:coverage:evidence` (≥95/95/90)
- **CI wiring** — two steps in `foundation.yml` (coverage gate + the gate script)

---

## Executive summary

`EvidenceIntegrity` enforces, in CI, the invariants every earlier phase relied on:

- **Metric / dashboard / alert integrity** — it builds the catalog of metrics the
  code actually EMITS (literal `inc`/`setGauge`/`observe`/`gaugeFn` calls, plus
  whatever a driven platform renders) and the catalog REFERENCED by the Grafana
  dashboards and Prometheus alerts, and fails on any reference with no source
  (histogram `_bucket`/`_sum`/`_count` refs resolve to their base metric).
- **Recommendation evidence** — every recommendation, reconciliation discrepancy and
  executive risk the live advisors produce must carry evidence, a numeric confidence
  and a remediation/action.
- **Confidence justification** — every confidence/score is in `[0,1]`, and every
  composite confidence (the executive operational confidence) exposes its weighted
  components with their sources — never an asserted black box.
- **Configuration integrity** — every runtime knob is validated AND governed
  (risk-classified; emergency-managed knobs carry a safe value).
- **Domain reports** — governance, forecast accuracy, recommendation effectiveness,
  business validation, DR, operational and executive intelligence each still expose
  their evidence fields (the executive briefing still answers all seven questions).

The pure extractors are separated from the dynamic checks so both are independently
testable; the CLI wires them to the filesystem and a live platform and **exits
non-zero on any finding**, so CI fails the moment evidence quality regresses.

Measured on the current repo: **83 metrics emitted · 76 referenced · 0 findings.**

## Business justification

An evidence-driven platform is only as trustworthy as the evidence behind it, and
evidence rots quietly: someone renames a metric and a dashboard goes blank; someone
adds a recommendation type without a remediation; someone registers a config knob
and forgets to govern it. None of those break a test — they degrade *decision
quality*, which is invisible until an operator acts on a dead panel or an
unjustified number. This gate makes evidence quality a **build-breaking** property,
exactly as the mission demands: *every metric has a source, every recommendation has
evidence, every dashboard references live metrics, every confidence score is
justified — or CI fails.*

## Current state → gap → design

**Gap:** the platform produced a great deal of evidence, but nothing checked that
the evidence stayed *coherent* — dashboards, alerts, recommendations, confidences
and config could drift out of integrity with a green test suite. **Design:**
`EvidenceIntegrity` pairs pure catalog extractors (regex over source for emitted
metrics; PromQL token extraction for referenced metrics; dashboard/alert parsers)
with dynamic checks that run the live advisors and assert their evidence fields. The
emitted catalog is a **union** of code-literal emits and a driven `metrics.render()`
scrape, so conditionally-emitted metrics (DR, reconciliation, executive, learning)
are all recognised. The CLI aggregates findings across every category and returns a
non-zero exit, and the whole thing is wired as two CI steps (a coverage gate on the
module and the gate script itself).

## Alternatives considered

- **A hand-maintained metric allow-list:** rejected — it would itself drift. Deriving
  the emitted catalog from the code (the source of truth) means the check can never
  disagree with reality.
- **Only static checks:** rejected — "every recommendation has evidence" and "every
  confidence is justified" are runtime properties of the live advisors, so the gate
  drives a real platform and inspects its actual output.
- **prom-client / a metrics registry introspection library:** rejected as speculative
  — the platform's `Metrics` is a small custom registry; a regex over emit calls plus
  a `render()` scrape is the apples-to-apples catalog with zero new dependencies.
- **Failing on emitted-but-unreferenced metrics:** rejected as noise — an emitted
  metric with no dashboard is not a regression (it may be scraped ad hoc); a
  *referenced* metric with no source always is. The gate fails only on dead
  references.

## Trade-offs & risks

- The emitted-metric regex recognises **literal** emit calls; a metric emitted only
  via a computed name would be missed by the static pass, which is why the driven
  `render()` union backstops it. All current platform metrics are literals or render
  under the driven scenario.
- The gate drives a real platform once; it is a **CI check**, not a hot path, so the
  cost is a single platform boot plus a light scenario.
- The referenced-metric extraction keys on the `motse_`/`foundation_` prefixes, so
  PromQL functions, label names and recording rules (`slo:…:ratio`) are naturally
  excluded — deliberate, and documented.
- New metric prefixes in future work must follow the convention (or the extractor's
  prefix list is extended) to be validated — a documented maintenance note.

## Security, compliance & operational impact

No runtime surface — this is a build-time gate. It writes an evidence artefact to
`docs/evidence/evidence-integrity.json` (emitted/referenced counts + any findings),
which doubles as a compliance record that the platform's evidence is internally
consistent. It strengthens every other guarantee by making their evidence
non-regressable: a governance/forecast/recommendation/business-validation report that
silently drops a field now fails CI.

## Testing strategy & validation results

- **Unit (`tests/evidence-integrity.test.js`, 14):** the pure extractors
  (emitted vs read metrics, PromQL token extraction, dashboard/alert parsing,
  histogram-suffix stripping); dead-reference detection (and the histogram-base
  match); each dynamic check catching its regression — a recommendation missing
  evidence, an out-of-range/unsourced confidence, an ungoverned/unvalidated/unsafe
  config knob, a domain report dropping a field; an empty/no-arg platform being
  safe; the real platform passing its own gate with zero findings; and a dead
  dashboard reference against the real platform being caught.
- **Gate run:** `npm run motse:evidence` on the repo → **83 emitted · 76 referenced
  · 0 findings · verdict PASS** (exit 0). All eleven CI checklist items
  (governance, forecast, recommendation, business validation, DR, operational and
  executive intelligence, metric/dashboard/alert/configuration integrity) pass.
- **Results:** motse suite **800 green** (was 786; +14), root 131 green, harness
  119/119 PASS. Gates: foundation 99.4/94.7, config 97.0/91.1, govdr 97.0/90.0,
  business 95.9/92.8, analytics 96.3/91.4, reconciliation 99.3/99.5, executive
  99.2/98.9, learning 100/98.1, **evidence 100/97.5** — all ≥95/95/90.

## Rollback plan

Fully reversible. A new read-only module, a CLI script, two CI steps, one npm script
and a coverage gate — no change to any runtime code or subsystem behaviour. Removing
the two CI steps disables the gate; reverting the commit is clean, with no
schema/state migration.

## Future enhancements & lessons learned

Extend the emitted catalog to flag *emitted-but-never-surfaced* metrics as an
informational report; validate that each SLO alert has a matching dashboard panel;
assert every admin analytics route is reachable and returns its documented shape;
snapshot the emitted/referenced counts over time so a shrinking catalog raises a
learning signal. **Lesson:** the cheapest way to keep evidence honest is to derive
the check from the code itself — a hand-maintained list of "valid metrics" would be
the first thing to rot, so the gate reads the source of truth and compares.

## Definition of success & final assessment

✅ CI now **fails whenever evidence quality regresses** — every metric a dashboard or
alert references has a source, every recommendation carries evidence, every
confidence score is in range and backed by sourced components, every runtime knob is
validated and governed, and every domain report keeps its evidence fields. ✅ The
gate passes the real platform with **0 findings** and is enforced by two CI steps.
✅ All existing guarantees intact (transactions, idempotency, observability,
governance, backward compatibility); a coverage gate was added, none weakened.

With this the FINAL system prompt is complete: the platform **measures, validates,
explains, improves and now guards** its own evidence — a self-governing enterprise
operating system whose operational confidence is, and stays, justified by
measurable evidence.
