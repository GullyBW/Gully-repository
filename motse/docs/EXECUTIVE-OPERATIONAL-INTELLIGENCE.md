# FINAL Phase 3 — Executive Operational Intelligence

The platform already produces a dozen analytics surfaces; leadership should not
have to read a dozen dashboards to know whether the business is safe. This slice
**fuses every existing signal into one executive briefing** that answers the
seven questions leadership actually asks — and a single, **sourced**
operational-confidence score. It is pure analytics over subsystems that already
exist: additive, read-only, and validated — **8 unit tests + 3 new chaos-harness
checks (W22), all green (115/115 total)**.

- **Executive intelligence** — `src/observability/executive.intelligence.js`
- **Wiring** — `container.js` (over business, health, governance, forecast, recommendation-effectiveness, reconciliation, DR, ops-intelligence)
- **Control plane** — `/v1/admin/executive`, folded into `/overview`
- **Tests / gate** — `tests/executive-intelligence.test.js`, `motse:coverage:executive` (≥95/95/90)
- **Validation** — harness `W22`
- **Dashboard** — `deploy/motse/observability/dashboards/executive.json`

---

## Executive summary

`ExecutiveIntelligence.report()` composes the analytics the platform already
computes — **business KPIs** (value, events, customers reached, SLA breaches),
**operational health** (readiness + dependency states), **governance**
(compliance + maturity + rollback), **forecast accuracy**, **recommendation
quality** (precision/recall/trust/incidents-prevented), **business validation**
(telemetry-vs-ledger data confidence + financial exposure), **DR readiness**, and
**compliance** — into one briefing. It normalises every advisory (operational
intelligence, reconciliation discrepancies, governance recommendations) into a
single **ranked risk list**, and answers the seven executive questions:

1. **What happened?** — the headline state (SLA breaches, discrepancies, degraded deps, open risks).
2. **Why?** — the primary driver's root cause, with its source.
3. **Who was affected?** — customers affected (from capability impact + discrepancies) and reached.
4. **How much business value was affected?** — value at risk (financial exposure + SLA-breach value).
5. **What is recommended?** — the top-ranked risk's remediation.
6. **How confident is that recommendation?** — its confidence, **recalibrated** from the recommendation-effectiveness history.
7. **What happens if nothing is done?** — the top risk's projected operational/business impact.

It also computes one **operational-confidence** score — a weighted blend of the
platform's own measured confidence signals (data confidence, operational health,
governance compliance, forecast accuracy, recommendation trust, DR readiness).
Components with no evidence yet are **omitted and the weights renormalised**, and
**every component cites its source**, so the number is honest about what it knows
and auditable end to end.

## Business justification

A mature platform's problem is no longer "can we see it?" but "can leadership act
on it without a war room?" Twelve dashboards is not intelligence; one briefing that
says *what happened, why, who's affected, how much money is at stake, what to do,
how sure we are, and what happens if we don't* — over live, sourced metrics — is.
Fusing the signals into a single confidence score, and recalibrating the headline
recommendation through the effectiveness tracker, is exactly the FINAL objective:
the platform continuously **increases operational confidence using measurable
evidence** and **explains itself** to the people who fund it.

## Current state → gap → design

**Gap:** the analytics existed but were siloed — no single view answered the
executive questions, and no composite told leadership how much to trust the
platform overall. **Design:** `ExecutiveIntelligence` reads each subsystem at
report time (the same on-demand, read-only pattern as governance analytics and
reconciliation), extracts a small sourced summary from each, fuses the advisories
into one ranked risk list (recalibrating the top risk's confidence through
`recommendationEffectiveness.calibratedConfidence`), and synthesises the
seven-question briefing. `operational_confidence` is a weighted mean over only the
**present** components — `Σ(value·weight)/Σ(weight)` — so a platform with no DR run
or no recommendation history reports a confidence over what it actually measured,
and lists the `missing_evidence` explicitly.

## Alternatives considered

- **A Grafana-only executive dashboard (no service):** rejected — Grafana can lay
  gauges side by side but cannot *rank* risks, recalibrate a recommendation's
  confidence, or answer "why / what if nothing is done" in prose. The service
  produces the narrative; the dashboard visualises its gauges.
- **A fixed-weight confidence that always includes all six components:** rejected —
  scoring absent evidence as zero would understate confidence on a young platform
  and violate "no unsupported metrics." Renormalising over present components is the
  honest choice.
- **Duplicating the underlying computations:** rejected as speculative complexity —
  the module calls the existing analytics and never recomputes what they own, so it
  can never disagree with them.
- **Inventing an executive confidence heuristic without provenance:** rejected — every
  component carries a `source`, satisfying the Phase 5 rule that every metric has a
  source (and pre-wiring the evidence-integrity gate).

## Trade-offs & risks

- The briefing is a **point-in-time** composition; trend lines live in the Grafana
  `executive` dashboard over the emitted gauges (`motse_executive_*`) plus the
  domain gauges it references.
- `operational_confidence` and the value/customer aggregates are **composite
  heuristics** with documented weights; the component breakdown and sources are
  exposed so the number is explainable, not a black box.
- Customer-affected and value-at-risk are **upper-bound** estimates (summed across
  degraded capabilities and discrepancies); they answer "how bad could it be,"
  which is the right posture for an executive risk view.
- The gauges are emitted whenever the briefing is computed (admin/overview or a
  scheduled call) — the same cadence model as the other analytics.

## Security, compliance & operational impact

Read-only; no new inbound surface beyond one L3 `platform_admin(platform)`-guarded
route. New gauges (`motse_executive_operational_confidence`,
`_value_at_risk_minor`, `_customers_affected`, `_open_risks`) and the `executive`
Grafana dashboard make platform-wide confidence and business risk first-class
operational signals. `/v1/admin/overview` now surfaces operational confidence, value
at risk, customers affected and open risks at a glance. The briefing *is* the
board-level artefact: what happened, why, who, how much, what to do, how sure, and
the cost of inaction — every figure traceable to its source subsystem.

## Testing strategy & validation results

- **Unit (`tests/executive-intelligence.test.js`, 8):** full fusion (all six
  confidence components present, weights renormalised, every component sourced);
  the seven-question briefing (customers affected, value at risk, recommended
  action, recalibrated confidence, cost of inaction); risk fusion from all three
  advisors with the healthy signal skipped and worst-first ordering; health score
  degrading with failed/degraded deps and collapsing when not ready; missing
  advisors omitted from confidence and the top-risk confidence left un-recalibrated;
  a null recalibration falling back to raw confidence; an empty/ no-arg platform
  being safe (all unavailable, null confidence, nominal briefing); the real
  platform nominal + a real telemetry gap surfacing as the top executive risk; and
  the admin API + overview.
- **Chaos (harness W22):** operational confidence blends only sourced, measured
  components; the briefing answers all seven leadership questions; the fused view
  exposes business-validation and recommendation-quality domains after the earlier
  scenarios drove real activity and outcomes.
- **Results:** motse suite **774 green** (was 766; +8), harness **115/115 PASS**
  full + smoke. Gates: foundation 99.4/94.7, config 97.0/91.1, govdr 97.0/90.0,
  business 95.9/92.8, analytics 96.3/91.4, reconciliation 99.3/99.5, **executive
  99.2/98.9** — all ≥95/95/90.

## Rollback plan

Fully reversible. A single new read-only module plus wiring, one admin route, one
`/overview` field and one Grafana dashboard — no change to any existing subsystem's
code or behaviour. Removing it changes nothing the platform does; reverting the
commit is clean, with no schema or state migration.

## Future enhancements & lessons learned

Persist executive snapshots for board-level trend reporting; add a "what-if"
projection that quantifies the cost of inaction from the capacity forecast;
schedule the briefing on the health cadence so the gauges advance without an
operator call; add per-domain drill-down links from the executive dashboard.
**Lesson:** a fused confidence score is only trustworthy if it is honest about
absent evidence — renormalising over present, sourced components (and naming the
missing ones) is what keeps the headline number from lying on a young platform.

## Definition of success & final assessment

✅ One executive briefing **fuses business KPIs, operational health, governance,
forecast accuracy, recommendation quality, business/financial risk, customer reach,
DR readiness and compliance**, and answers **what happened / why / who / how much
value / what is recommended / how confident / what if nothing is done**. ✅ A single
**operational-confidence** score blends only measured, **sourced** components and is
explainable via its breakdown. ✅ The headline recommendation's confidence is
**recalibrated from measured history**, so the exec view improves as the platform
learns. ✅ All existing guarantees intact (transactions, idempotency, observability,
governance, backward compatibility); a coverage gate was added, none weakened; CI
enforces it. The platform now **explains itself** to leadership in one evidence-
backed view.
