# Institutional intelligence

**Audience:** reviewer · Oversight Board · Architecture Review Board
**Status:** governed documentation — every claim below is verified against the implementation on
every build by `APP-FIT-DOCUMENTATION-ASSURANCE`.

Recorded by [ADR-0010](./adr/0010-institutional-intelligence-legal-authority-and-the-six-clause-invariant.md).
Companion to [legal-authority.md](./legal-authority.md) and
[institutional-resilience.md](./institutional-resilience.md).

---

## 1. Control effectiveness — a green build is not evidence

Every governance report in this platform is derived from the fitness gate. The gate says a control
**ran** and **passed on a synthetic counterexample**. It says nothing about whether that control has
ever detected a real condition, how long it took, whether anybody acknowledged it, or how many
conditions it missed.

`src/assurance/control-effectiveness.js` measures the difference. Seven dimensions, each against a
declared threshold, with the overall state the **weakest** of them:

| Dimension | Why it can fail alone |
|---|---|
| `detectionLatency` | A control that takes longer than a working day to fire is a post-mortem tool. |
| `acknowledgementLatency` | A control nobody acknowledges is a control nobody acts on. |
| `remediationLatency` | A week to clear a detected condition is a capacity problem, not a monitoring one. |
| `falsePositiveRate` | Above one in five, people start ignoring it; above half, it is noise. |
| `falseNegativeRate` | A missed detection is the failure the control exists to prevent. |
| `historicalReliability` | How often it caught what it was there for. |
| `operationalAvailability` | A control is needed exactly when things are going wrong. |

### Unknown is not effective, and it is never averaged in

A control with no observations is `unknown` — not effective, not ineffective, and **excluded from the
effectiveness rate** rather than counted as working. Today that is every control on this platform:
`GET /api/assurance/control-effectiveness` reports `effectivenessRate: null` and `measurable: false`
over the whole estate, and states why.

An empty observation register also leaves the `controlEffectiveness` assurance domain **unmeasured**,
not failing. Controls nobody has watched are not controls known to be bad, and reporting them as
failing puts the wrong repair on somebody's desk.

### False negatives are only recordable by a human

The `false-negative` outcome exists so that somebody can record that a condition occurred and the
control said nothing. Nothing in the platform can observe that. If only detected incidents are ever
recorded, the false-negative rate is structurally zero and the figure means nothing — which is
sunset criterion 3 of ADR-0010.

Checked by `APP-FIT-CONTROL-EFFECTIVENESS`.

## 2. Cross-government readiness — five aspects, weakest link

`src/governance/cross-agency.js` assesses each institutional relationship on five aspects. A
relationship is only as ready as its **weakest** aspect; the five are never averaged.

| Aspect | What it asks |
|---|---|
| `communication` | Can each institution reach the other, and how directly? |
| `legalInteroperability` | What legally permits one institution to rely on the other? |
| `governanceInteroperability` | Do their recorded governance rules agree about what may cross? |
| `operationalCoordination` | Have these two ever actually acted together? |
| `dependencyResilience` | If the relationship fails, does anything else carry the load? |

Institutions, their constitutional zones and their relationships are all **derived** from the
accountability record and the architecture — nothing here is a list of partners, so an agency that is
renamed or dissolved changes the analysis automatically.

### Unknown is counted apart from blocked

At the aspect level, the pair level and the estate level. "Nobody has looked" and "we looked and two
rules conflict" need different people to act, and merging them into one number loses the distinction
that decides who is called.

`blocked` ranks below `unknown` so the weakest-link aggregation surfaces a recorded conflict first,
but neither is ready, and both are listed by name on every pair.

### What the analysis found

Nothing is ready — 0 of 39 institutional pairs — because no joint act and no legal instrument is on
record. Three findings nothing had previously looked for:

- **The Information Security Review Board cluster is disconnected from the governance graph.** Six
  institutions holding identity, cryptography, platform security and incident response share no forum
  with any other institution and appear in no other institution's escalation chain, at any distance.
- **Onward-disclosure conflicts**, where data a context may only share under governance flows into a
  context permitted to share it openly.
- **Classification downgrades** across institutional boundaries.

Read it at `GET /api/governance/cross-government`, checked by `APP-FIT-CROSS-GOVERNMENT`.

### Why a `no-sharing` context is not a finding

The `collaboration` constraint on a bounded context governs what may be passed **outward** to another
body. An internal architectural dependency on a `no-sharing` context is the architecture working as
designed, not a breach. Reading it the other way fired on 35 of 39 pairs, and a control that fires on
almost everything teaches everybody to ignore it. The check now looks only at where data **lands**.

## 3. Constitutional zone governance

All 30 bounded contexts declare a zone, a trust boundary, a data residency policy, a classification,
a failover policy, a collaboration constraint and a written rationale, in
`src/architecture/context-map.js`. `contextMap.validate()` **refuses to compose the platform** on any
undeclared or unknown value, so a new context cannot be added without a constitutional decision about
where it sits.

The four zones are `independent`, `executive`, `judiciary` and `cross-zone`. An institution
accountable for contexts in more than one zone is itself a constitutional crossing point, whatever
its own letterhead says.

Read it at `GET /api/architecture/zone-governance`, checked by `APP-FIT-ZONE-GOVERNANCE`.

## 4. Institutional sustainability — seven dimensions, seven horizons

`institutionalSustainability` in `src/assurance/institutional.js` asks whether the institution can
still operate in five years, which is a different question from whether it can operate today and
often has a different answer.

Every dimension states **its own horizon**, because "sustainable" with no timeframe attached is a
word rather than an assessment:

| Dimension | Horizon |
|---|---|
| `governanceContinuity` | the next board cycle |
| `organizationalResilience` | the next staffing cycle |
| `documentationSustainability` | the next release cycle |
| `assumptionHealth` | the review cadence of the shortest-lived assumption |
| `knowledgePreservation` | a generation of staff |
| `successionReadiness` | the next leadership change |
| `legalContinuity` | the life of the shortest-lived instrument |

An **unmeasured** dimension is not a sustainable one. The estate is sustainable to the shortest
horizon it fails within, and each of the seven can fail on its own.

Read it at `GET /api/assurance/sustainability`, checked by `APP-FIT-INSTITUTIONAL-SUSTAINABILITY`.

## 5. Executive decision support — the conclusion is a constant

A decision package is the most dangerous artefact this platform produces: a recommendation with
enough evidence attached that a board could act on it without going and checking, which is exactly
what makes it capable of substituting for the decision rather than informing it.

**Every package concludes `Human authorization required.`** It is a literal string, nothing computes
it, no input can override it, and `assertAdvisory` refuses to emit a package without it. `authorizes`
is always `false` and `decidedBy` is always `null`.

Eight kinds of evidence are mandatory, each stating what its absence would mean:
`supportingEvidence`, `confidence`, `assumptions`, `affectedControls`, `legalDependencies`,
`institutionalImpacts`, `risks`, `uncertainties`. An empty list is the same absence as a missing
field.

With no evidence supplied the platform assembles **no packages** rather than inventing advice.

Read it at `GET /api/assurance/decision-support`, checked by `APP-FIT-DECISION-SUPPORT`.

## 6. Adaptive governance forecasting

`src/architecture/drift-prevention.js` carries twelve forecast dimensions. Six ask *how well are we
doing*; six ask *how much work is coming*: `governanceWorkload`, `reviewBottlenecks`,
`assumptionVerificationDemand`, `policyMaintenanceEffort`, `auditPreparationEffort`,
`institutionalResilienceTrend`.

Each workload figure is normalised against **declared capacity** rather than reported as a raw count
nobody can act on, and each stays `null` until the record that feeds it arrives — a workload figure
invented with no capacity record would be the worst kind of planning input. A trend needs at least
two recorded periods; one observation is a reading.

Every forecast carries an interval derived from its observation count, and with no observations the
interval is `[0,1]` and constrains nothing.

Read it at `GET /api/governance/adaptive-forecasts`, checked by `APP-FIT-ADAPTIVE-ANALYTICS`.

## 7. The six-clause global invariant

> No critical institutional capability may depend upon an unverified assumption, an undocumented
> legal authority, an ineffective detecting control, an undeclared constitutional relationship, or a
> single point of organizational failure.

| Clause | Evaluated from |
|---|---|
| `unvalidated-assumption` | `src/architecture/assumptions.js` |
| `unverified-dependency` | the detecting control named by each dependency kind |
| `undocumented-governance-relationship` | the ownership record **and** the declared constitutional zone |
| `single-point-of-organizational-failure` | the thirteen dependency kinds across eleven categories |
| `undocumented-legal-authority` | `src/legislation/legal-authority.js` |
| `ineffective-detecting-control` | `src/assurance/control-effectiveness.js` |

A clause with no register behind it reports **unknown** and does not hold. The invariant does not
currently hold, and adopting it while it fails is the point.

`evidence-custody` satisfies all six under fully evidenced conditions — a verified assumption, full
continuity evidence, a reviewed legal instrument and clean observations of every detecting control —
which demonstrates the bar is reachable rather than decorative.

A failing clause may be accepted only by a named authority, with a rationale and an expiry.
Acceptances expire without anybody withdrawing them, which returns the block automatically.

Read it at `GET /api/governance/global-invariant`, checked by `APP-FIT-GLOBAL-INVARIANT`.

## HTTP surface

| Method | Route | Role |
|---|---|---|
| GET | `/api/assurance/control-effectiveness` | admin |
| POST | `/api/assurance/control-observations` | admin |
| GET | `/api/architecture/assumption-maturity` | admin |
| GET | `/api/architecture/zone-governance` | admin |
| GET | `/api/governance/cross-government` | oversight-board |
| GET | `/api/governance/dependency-intelligence` | oversight-board |
| GET | `/api/governance/global-invariant` | oversight-board |
| GET | `/api/governance/adaptive-forecasts` | admin |
| GET | `/api/assurance/sustainability` | oversight-board |
| GET | `/api/assurance/decision-support` | oversight-board |
| GET | `/api/assurance/trust-evidence` | oversight-board |
| GET | `/api/assurance/evidence-onboarding` | admin |

Every one of these reports carries `authorizes: false`. Twenty-two executive panels and twenty-one
assurance domains still print `NOT AUTHORIZED`.

## Where it lives

- `src/assurance/control-effectiveness.js` — the seven dimensions and the observation register
- `src/assurance/institutional.js` — sustainability, decision packages, panels, assurance domains
- `src/governance/cross-agency.js` — cross-government readiness
- `src/governance/institutional-resilience.js` — the six-clause invariant
- `src/architecture/context-map.js` — constitutional zone governance
- `src/architecture/drift-prevention.js` — the twelve forecasts

Run the checks with `npm run assurance`, and the deterministic tests with `npm test`.
