# Analytics Phases 1 + 2 — Governance Analytics & Forecast Accuracy Validation

Phase 1 (highest priority) turns the configuration-governance **records** into
actionable governance intelligence; Phase 2 **validates the capacity planner's own
predictions** by backtesting its history. Both extract value from data already
collected — no new infrastructure — and are additive, read-only, and validated:
**41 unit tests + 6 new chaos-harness checks (W18/W19), all green (106/106 total)**.

- **Governance analytics** — `src/observability/governance.analytics.js`
- **Forecast accuracy** — `src/observability/forecast.accuracy.js`
- **Wiring** — `container.js` (over the governance service + capacity planner), one additive emergency-activation counter in `config.service.js`
- **Control plane** — `/v1/admin/governance/analytics[/recommendations]`, `/v1/admin/forecast/accuracy`, folded into `/overview`
- **Tests / gate** — `tests/governance-forecast-analytics.test.js`, `motse:coverage:analytics` (≥95/95/90)
- **Validation** — harness `W18` (governance analytics) + `W19` (forecast accuracy)

---

## Executive summary

**Phase 1** transforms the governance change log (proposals, approvals, rollbacks,
rejections, risk classifications) into **governance intelligence**: changes by
risk and status, approval turnaround (avg/p95), rollback and rejection rates,
change success rate, configuration churn (most-modified keys), emergency
activations, service impact, and two composite scores — a **compliance score**
(separation of duties + justification + stability) and an **operational-maturity
score**. It generates **evidence-backed recommendations** — approval delays,
excessive rollbacks, recurring risky changes, governance bottlenecks — each with
supporting evidence, affected services, operational and business impact,
confidence, urgency, and suggested remediation. Read-only over the governance
service; it computes, it never changes governance state.

**Phase 2** answers "are the capacity forecasts actually correct?" the honest way —
**backtesting**. It fits the planner's model on the first part of its recorded
history, predicts the rest, and compares predictions to the actual observed
values, computing forecast error (MAPE), an **accuracy percentage**, trend-
direction agreement, **model stability** (slope variance across sub-windows), and
drift — plus a **confidence-vs-accuracy calibration** check against the planner's
own stated confidence. Infrastructure recommendations are **gated on measured
accuracy**, so the platform only advises expansion when its own forecasts have
proven trustworthy. Measured on the harness: overall accuracy ~86%.

## Business justification

Governance records that just accumulate are compliance theatre; turned into KPIs
and a maturity score, they tell leadership whether change management is working —
and the recommendations tell operators exactly where the process is slow or risky.
Forecast validation matters because acting on a *wrong* forecast wastes
infrastructure spend or under-provisions into an outage; measuring accuracy and
gating recommendations on it means capacity decisions are trustworthy by evidence,
not by hope.

## Current state → gap → design

**Gap (P1):** the governance platform *recorded* everything but *analysed*
nothing — no turnaround, rollback-rate, churn, compliance, or maturity views, and
no process recommendations.
**Design:** `GovernanceAnalytics` reads `governance.changes` and computes the KPIs.
A subtle but important correctness point: a rolled-back change is no longer counted
as `applied`, so **rollback rate uses "ever applied" (applied + rolled_back)** as
the denominator — otherwise reverting a change would perversely drop it out of the
base and hide instability (a real bug caught and fixed during testing). Compliance
blends separation-of-duties + justification + stability; maturity blends compliance
with churn/backlog/risk-discipline. Emergency activation counts come from a new
additive `motse_config_emergency_total` counter in ConfigService, keeping analytics
pure. `recommend()` emits ranked, evidence-cited recommendations.

**Gap (P2):** the planner predicted, but nothing measured whether the predictions
held.
**Design:** `ForecastAccuracy.backtest(field)` does hold-out validation over the
planner's history; `stability()` measures slope variance/drift across sub-windows;
`report()` aggregates accuracy across fields and calibrates the planner's stated
confidence against measured accuracy. The `recommendation_gate` exposes whether
overall accuracy clears the threshold — the evidence gate the mission requires.

## Alternatives considered

- **Waiting for real horizons to elapse (P2):** impossible for 30–365-day
  forecasts; backtesting is the standard, honest substitute and works on the
  history the planner already keeps.
- **A statistics library / ARIMA (P2):** rejected as speculative complexity — the
  planner uses least-squares, so backtesting the same model is the apples-to-apples
  validation; a richer model is a future step once data justifies it.
- **Persisting analytics to the Store (P1):** rejected — analytics are derived on
  demand from the source records, so they can never drift from the truth; exporting
  to a warehouse for long-horizon trends is a documented extension.
- **Counting emergency activations from the audit log (P1):** rejected in favour of
  a one-line metric counter — cheaper and keeps analytics decoupled from audit.

## Trade-offs & risks

- Analytics are over the **process-lifetime** governance records (bounded log) and
  the planner's in-memory history; cross-pod/long-horizon aggregation happens at the
  Prometheus/dashboard layer over the emitted gauges.
- Backtest accuracy on a **flat** series is trivially ~100% (nothing to get wrong) —
  the report is honest about this via the calibration and stability fields, so
  operators don't over-trust a high number on a quiet system.
- Compliance/maturity scores are **composite heuristics** with documented weights;
  they are directional indicators for trend, not absolute grades. The component
  sub-scores are exposed so the number is explainable.
- Recommendations are advisory and confidence-scored; low-confidence items are
  labelled.

## Security, compliance & operational impact

Read-only; no new inbound surface; all routes reuse the `platform_admin(platform)`
L3 guard. The governance analytics report *is* the compliance artefact —
separation-of-duties ratio, justification ratio, approval trail — ready for audit.
New gauges (`motse_governance_compliance_score`, `_maturity_score`,
`_rollback_rate`, `motse_forecast_accuracy`) and the `governance` Grafana dashboard
make governance effectiveness and forecast quality first-class operational signals.
`/v1/admin/overview` now surfaces compliance/maturity/rollback-rate and forecast
accuracy at a glance.

## Testing strategy & validation results

- **Unit (`tests/governance-forecast-analytics.test.js`, 41):** governance KPIs by
  risk/status, approval turnaround, rollback rate (with the ever-applied
  denominator), rejection reasons, success rate, churn, service impact, compliance
  + maturity, emergency counts, all four recommendation signals + healthy; forecast
  backtest (linear = high accuracy, trend-reversal = low), insufficient-data guards,
  small-split clamping, stability/drift, calibration with and without stated
  confidence, metric gauge, real-platform integration; admin API + overview.
- **Chaos (harness W18/W19):** governance records become quantified analytics with
  in-range compliance/maturity and evidence-backed recommendations; forecast
  accuracy is measured by backtesting with per-field results and an accuracy-gated
  recommendation flag.
- **Results:** motse suite **735 green** (was 710; +25), root 131 green, harness
  **106/106 PASS** full + smoke. Gates: foundation 99.4/94.7, config 97.0/91.1,
  govdr 97.0/90.0, business 95.8/92.8, **analytics 96.3/91.4** — all ≥95/95/90.

## Rollback plan

Fully reversible. Both are new read-only modules plus wiring and two `/overview`
fields; the only change to existing code is two additive counter lines in
ConfigService (behaviour-neutral). Removing the analytics changes no governance,
config, or forecasting behaviour. Reverting the commit is clean — no schema/state
migration.

## Future enhancements & lessons learned

Persist analytics snapshots for long-horizon governance trends; feed governance
recommendations that are themselves config changes into the approval queue;
richer forecasting models once backtest data shows linear is insufficient;
seasonal decomposition in forecast accuracy. **Lesson:** the ever-applied
rollback-rate denominator bug shows why analytics must be tested against
constructed scenarios with known answers, not just "does it run."

## Definition of success & final assessment

✅ Governance records are **continuously transformed into actionable analytics and
measurable KPIs** (compliance + maturity scores, rollback/approval/churn metrics,
evidence-backed recommendations). ✅ Capacity forecasts are **validated against
actual data via backtesting**, with accuracy measured, calibration checked, and
recommendations **gated on measured accuracy**. ✅ All existing guarantees intact
(transactions, idempotency, observability, governance, backward compatibility);
coverage gate added, none weakened; CI enforces it. The platform now measures how
well it governs itself and how much to trust its own predictions.
