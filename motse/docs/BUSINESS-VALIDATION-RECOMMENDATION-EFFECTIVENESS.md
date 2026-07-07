# FINAL Phases 1 + 2 — Business Outcome Validation & Recommendation Effectiveness

The platform already *observes* the business and *advises* operators. This slice
makes both **trustworthy by evidence**: Phase 1 (highest priority) reconciles the
business telemetry against the **ledger — the authoritative system of record** —
so every dashboard number is validated against the money; Phase 2 treats the
advisors' recommendations as **measurable products** (accepted/rejected/outcomes)
and **recalibrates future confidence from the measured track record**. Both are
pure analytics over records that already exist — no new infrastructure — and are
additive, read-only, and validated: **31 unit tests + 4 new chaos-harness checks
(W20/W21), all green (112/112 total)**.

- **Business reconciliation** — `src/observability/business.reconciliation.js`
- **Recommendation effectiveness** — `src/observability/recommendation.effectiveness.js`
- **Wiring** — `container.js` (over business observability + the ledger + the capacity/governance advisors), two additive telemetry lines in `business.observability.js`
- **Control plane** — `/v1/admin/reconciliation`, `/v1/admin/recommendations/{effectiveness,calibration,ledger,ingest,:id/accept|reject|ignore|override|resolve}`, folded into `/overview`
- **Tests / gate** — `tests/reconciliation-effectiveness.test.js`, `motse:coverage:reconciliation` (≥95/95/90)
- **Validation** — harness `W20` (business outcome validation) + `W21` (recommendation effectiveness)
- **Dashboard** — `deploy/motse/observability/dashboards/reconciliation.json`

---

## Executive summary

**Phase 1 — Business Outcome Validation.** `BusinessReconciliation` reconciles the
per-capability business telemetry against the **ledger**, capability by capability:
fundraising against `escrow_fund` postings on `campaign:` refs, disbursements
against settled `ledger.payouts`, and card payments against `provider_deposit`
postings on `card:` refs. For each it computes **telemetry accuracy** (do the
event counts match the ledger?), **financial accuracy** (do the money totals
match?), **customer-impact accuracy** (is reported reach complete given event
capture?), **missing** and **duplicate** events, a **reconciliation success rate**,
and a composite **data-confidence** score. Every gap becomes an actionable
**discrepancy** carrying a probable **root cause**, the affected capability and
customers, the **financial exposure**, the operational impact, a confidence, and a
**remediation plan**. The ledger is authoritative by construction (double-entry,
idempotent), so any gap is a *telemetry* defect — never a reason to distrust the
money.

**Phase 2 — Recommendation Effectiveness.** `RecommendationEffectiveness` gives
every recommendation a lifecycle — *generated → accepted | rejected | ignored |
overridden → resolved(outcome)* — and records real incidents that **no**
recommendation caught (false negatives). From that history it computes
**precision**, **recall**, **usefulness**, an **operator-trust score** and a simple
**ROI** (incidents/exposure prevented vs false alarms and wasted reviews), and it
**recalibrates** the confidence of future recommendations by shrinking each
signal's stated confidence toward its measured hit-rate as evidence accumulates —
so a confidence score becomes statistically justified, not asserted. State
persists to the platform Store (`recommendation_ledger`), so it is durable and
inspectable.

## Business justification

Business observability that nobody has checked against the books is a leap of
faith: if the fundraising dashboard says P70,000 was raised but the ledger holds
P73,000, then reporting, SLA and customer-reach figures are all quietly wrong, and
so is every decision made from them. Reconciling telemetry against the ledger
turns "we think" into "we can prove," and localises the defect (which capability,
how much money, probable cause, fix). And recommendations that are never scored
are just opinions — tracking their precision/recall and recalibrating confidence
from outcomes is what lets operators *trust* the advisor and lets the platform
stop crying wolf. This is exactly the FINAL mission: **improve the accuracy,
governance and operational value of what already exists — not build more.**

## Current state → gap → design

**Gap (P1):** business observability tallied value from events but was never
checked against the authoritative money, so a telemetry defect (a dropped event, a
double count, an amount drift) would silently corrupt every business number.
**Design:** `BusinessReconciliation` reads the ledger's own collections and the
business tally and compares them per capability. One small **additive** change to
`BusinessObservability` — a `value_events` counter and a `valueEventCounts()`
accessor — lets the reconciler compare the *number* of value-bearing events
telemetry saw against the authoritative record exactly (the capability totals mix
several event types, so a value-event count is the honest unit). `accuracy = 1 −
|delta| / base`, weighted by authoritative volume; `data_confidence = 0.5·financial
+ 0.3·telemetry + 0.2·reconciliation_success`. Each discrepancy is diagnosed by the
sign of the count delta (under-count → missing events / subscriber-ordering;
over-count → duplicate delivery; count-matches-value-differs → amount drift) and
carries the exposure and remediation.

**Gap (P2):** the advisors emitted recommendations but nothing recorded whether
operators acted on them or whether they were right, so confidence was a fixed
guess. **Design:** `RecommendationEffectiveness` records each recommendation's
lifecycle and outcome in the Store, computes precision/recall/usefulness/trust/ROI,
and recalibrates confidence via **Bayesian shrinkage** toward the prior: `calibrated
= (prior·k + hitRate·n) / (k + n)` with `k = priorWeight`. With no evidence it
returns the prior; as resolved samples accumulate it pulls toward the observed
hit-rate — statistically justified by construction.

## Alternatives considered

- **Trusting business observability outright (P1):** rejected — telemetry is
  derived and lossy; the ledger is the system of record, so validation must run
  *against the ledger*, not assume the telemetry is correct.
- **Modifying the ledger or events to carry reconciliation state (P1):** rejected —
  that would touch the money path. Reconciliation is derived on demand from records
  that already exist, so it can never drift from the truth and carries zero risk to
  transactions.
- **Reconciling the mixed capability event *counts* (P1):** rejected — a
  capability's `completed` count aggregates several event types, so it can't map
  1:1 to one ledger source. A dedicated **value-event** counter (2 additive lines)
  makes the count reconciliation exact without redesigning anything.
- **A fixed confidence per signal (P2):** rejected — that is the very "assert, don't
  measure" the mission forbids. Shrinkage recalibration is the standard,
  evidence-driven fix and degrades gracefully to the prior when data is thin.
- **Inventing a currency ROI (P2):** rejected as unsupported — ROI is expressed only
  from evidence held (incidents/exposure prevented vs false alarms and wasted
  reviews).

## Trade-offs & risks

- Reconciliation currently covers the three **financial** capabilities whose
  authoritative record lives in the ledger (fundraising, disbursements, card
  payments). Non-financial capabilities (heritage, civic, workflows,
  notifications) have no monetary system of record to reconcile against; extending
  to a workflow/notification source of record is a documented next step, and the
  framework adds a reconciler as pure configuration.
- The gauges (`motse_reconciliation_*`, `motse_recommendation_*`) are emitted
  whenever the report is computed (the admin/overview call, or a scheduled job) —
  the same cadence model as governance analytics. Cross-pod aggregation happens at
  the Prometheus/dashboard layer.
- `data_confidence` and `operator_trust_score` are **composite heuristics** with
  documented weights — directional indicators, and every component sub-score is
  exposed so the number is explainable.
- Recalibration needs resolved outcomes to be meaningful; with thin history it
  stays close to the stated prior (by design), so it never over-corrects on one
  data point.

## Security, compliance & operational impact

Read-only; no new inbound surface for the analytics themselves; all routes reuse
the `platform_admin(platform)` L3 guard, and every lifecycle mutation flows through
the gateway idempotency middleware. The reconciliation report *is* a financial
assurance artefact — telemetry-vs-ledger deltas with exposure, ready for audit. New
gauges (`motse_reconciliation_financial_accuracy`, `_data_confidence`,
`motse_recommendation_precision`, `_trust_score`, …) and the `reconciliation`
Grafana dashboard make data trustworthiness and advisor quality first-class
operational signals. `/v1/admin/overview` now surfaces financial accuracy, data
confidence, open discrepancies, recommendation precision and operator trust at a
glance.

## Testing strategy & validation results

- **Unit (`tests/reconciliation-effectiveness.test.js`, 31):** perfect match →
  confidence 1; missing / duplicate / value-mismatch discrepancies with the right
  root cause, exposure and severity; equal-severity sort by exposure; authoritative
  ledger filtering (campaign vs booking refs, card vs top-up deposits, settled vs
  pending payouts, release/refund excluded); zero-base accuracy; empty-platform
  plain-mean path; the real platform reconciling contributions + a settled payout
  exactly; `valueEventCounts` on the real observer; recommendation lifecycle
  (record/dedupe/accept/reject/ignore/override/resolve/miss), precision/recall/
  usefulness/trust/ROI, confidence recalibration (0.8 → 0.68), null-safety on an
  empty tracker, trust fall-backs, `ingestFromPlatform`, Store persistence; and the
  admin API for both.
- **Chaos (harness W20/W21):** business telemetry reconciles against the
  authoritative ledger (data confidence 1, zero discrepancies) **and** an injected
  telemetry under-count is caught with root cause + P3,000 exposure; recommendations
  are tracked as measurable products (precision/recall/trust/ROI from real outcomes)
  and confidence recalibrates from evidence (0.9 → 0.74 on a 50 % hit-rate).
- **Results:** motse suite **766 green** (was 735; +31), harness **112/112 PASS**
  full + smoke. Gates: foundation 99.4/94.7, config 97.0/91.1, govdr 97.0/90.0,
  business 95.9/92.8, analytics 96.3/91.4, **reconciliation 99.3/99.5** — all
  ≥95/95/90.

## Rollback plan

Fully reversible. Both are new read-only modules plus wiring, admin routes, two
`/overview` fields and one Grafana dashboard; the only change to existing code is
two additive telemetry lines in `BusinessObservability` (a counter + an accessor,
behaviour-neutral). Removing the reconciler and the effectiveness tracker changes
no business, ledger, config or advisory behaviour. Reverting the commit is clean —
no schema/state migration (the `recommendation_ledger` collection simply stops being
written).

## Future enhancements & lessons learned

Reconcile workflow-completion and notification-delivery against their own systems of
record; feed reconciliation discrepancies into the operational-intelligence advisor
as first-class signals; auto-ingest the live advisors on the health cadence so
effectiveness accrues without operator action; persist reconciliation snapshots for
long-horizon data-quality trends. **Lesson:** the honest unit for event
reconciliation is the *value-bearing* event, not a capability's mixed activity
count — a two-line additive counter bought an exact reconciliation without touching
a completed system.

## Definition of success & final assessment

✅ Business observability is **continuously reconciled against the authoritative
ledger**, with telemetry/financial/customer-impact accuracy, missing/duplicate
events, reconciliation success and data confidence — and every discrepancy carries
root cause, affected capability/customers, financial exposure, operational impact,
confidence and remediation. ✅ Recommendations are **measured as products**
(precision/recall/usefulness/trust/ROI) with **confidence recalibrated from
historical evidence**. ✅ All existing guarantees intact (transactions, idempotency,
observability, governance, backward compatibility); a coverage gate was added, none
weakened; CI enforces it. The platform now validates its own business numbers
against the money and learns how much to trust its own advice.
