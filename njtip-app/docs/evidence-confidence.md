# Evidence Confidence, Readiness & Engineering Metrics (Phase 11, Parts 14–16)

By Phase 10 the platform produced a great deal of evidence, and presented all of it as equally
trustworthy. A fitness function that ran two seconds ago and a configuration file somebody declared
last year both rendered as "evidence". They are not the same thing, and a board reading a dashboard
had no way to tell (`src/assurance/evidence-confidence.js`).

Gated by `APP-FIT-EVIDENCE-CONFIDENCE`, `APP-FIT-READINESS-MODEL` and `APP-FIT-ENGINEERING-METRICS`.
Live: `GET /api/assurance/evidence-confidence` · `GET /api/assurance/readiness-model` ·
`GET /api/assurance/engineering-metrics`.

---

## Part 14 — Evidence confidence

> **Confidence is computed. Supplying one is an error, not an override.** `assess({ confidence })`
> throws, fail-closed. There is no code path that accepts a hand-entered score.

```
confidence = sourceWeight × completeness × freshness
freshness  = 1 at verification, decaying linearly to 0 at the source kind's maximum age
```

| Source kind | Weight | Max age | Why it is worth that |
|---|---|---|---|
| `executable-check` | **1.00** | 1 day | Re-runs on every build |
| `derived-computation` | 0.90 | 1 day | Recomputed deterministically from state |
| `recorded-decision` | 0.85 | 1 year | Immutable, hash-chained |
| `declared-configuration` | 0.60 | 90 days | Validated structurally, never exercised |
| `human-attestation` | 0.50 | 180 days | A person asserting what no machine can check |
| `external-report` | 0.40 | 1 year | A third party's assertion on their authority |
| `absent` | **0.00** | — | No evidence at all |

The ordering *is* the argument: something a machine re-derives on every build beats something a
person wrote down once. Bands: `high ≥ 0.85 · moderate ≥ 0.60 · low ≥ 0.30 · unusable`, where
unusable means *treat as absent* — absent evidence is safer than evidence you trust wrongly.

Every assessment records its source, completeness, freshness, last verification, the method, and
**the calculation itself**, so a reader can check the number rather than take it.

### Aggregation is weakest-link

```
aggregate confidence = min(confidence of every input)
```

Not the mean. A conclusion is only as sound as the least trustworthy thing under it, and averaging
is precisely how one unusable input disappears behind nine good ones.

---

## Part 15 — Multi-dimensional readiness

Ten **independent** dimensions. Independence is the point: a single readiness percentage lets a
strong dimension mask a broken one, and the question a board actually asks is never "how ready
overall?" but *"which of these is not ready, and who owns it?"*

| Dimension | Owner | Question |
|---|---|---|
| Technical | assurance | Do the architecture and its invariants hold? |
| Security | security | Is the posture verified and are findings closed? |
| Privacy | privacy | Do identity minimisation and the anonymity boundary hold? |
| Operational | infrastructure | Can the platform be run, observed and recovered? |
| Reliability | observability | Are the SLOs met with budget to spare? |
| Data | data-fabric | Is every record traced and its quality measured? |
| Governance | governance-oversight | Is accountability complete and does nobody approve themselves? |
| Legal | legislation | Is every mandate implemented by a holding control? |
| Supply chain | supply-chain | Is every artifact attested, trusted and license-clean? |
| Organisational | governance-oversight | Is somebody available and accountable for every governance object? |

### Signals are declared, not inferred

Each dimension declares the signals it reads and what each must satisfy — `must-be-true`,
`ratio-at-least`, `count-at-most`. This replaced an earlier scorer that inferred polarity from a
value's shape, which read `credentialFindings: 0` as *a score of zero*: confidently wrong, in the
direction that looks safe. Declaring the signals removes the guess.

A dimension is ready only when **every signal holds AND the evidence behind it is usable**. Full
marks on evidence with confidence below 0.30 is not readiness.

### The invariant

> **`authorizationStatus` is a constant string: `NOT AUTHORIZED`.**

It is not a dimension, it is never derived, and `derivedFromReadiness: false` says so on every
response. Ten green dimensions still print it, and the fitness gate proves no input changes it.
Authorization is a recorded decision by the approving authority for a specific deployment — nothing
on this page can produce one.

---

## Part 16 — Engineering metrics intelligence

DORA metrics plus the quality and assurance measures the platform can actually derive.

| Metric | Elite | High | Medium | Low |
|---|---|---|---|---|
| Deployment frequency | on demand | ≥ weekly | ≥ monthly | < monthly |
| Lead time | < 1 day | < 1 week | < 1 month | > 1 month |
| Change failure rate | 0–5% | 5–10% | 10–15% | > 15% |
| MTTR | < 1 hour | < 1 day | < 1 week | > 1 week |

Alongside: test counts by type, invariants by layer, coverage, mutation score, MTTD, and trends for
technical debt, risk and assurance — each stating its own **polarity** (`better: 'falling'` for debt
and risk, `'rising'` for assurance), so a direction is never read the wrong way round.

> **An unmeasured metric reports `null`, never `0`.** Zero is a measurement; null is an admission.
> The report enumerates exactly what is unmeasured.

### Maturity cannot inflate

```
5 Optimising    elite across DORA, mutation testing, debt AND risk both falling
4 Measured      every DORA metric measured, coverage and mutation score known
3 Automated     deployment frequency and change failure rate measured
2 Instrumented  tests and invariants counted by type and layer
1 Initial       something is measured
```

**An unmeasured metric cannot raise a level** — that is how maturity models usually inflate. Every
level below the top names what is blocking the next one. And, as everywhere: `authorizes: false`.

---

# Verification History, Confidence Trend & Provenance (Phase 12, Part 14)

A confidence figure is a snapshot. `0.91` tells you where the evidence stands; it does not tell you
that it was `0.99` four verifications ago and has fallen every time since. **A high band with a
falling trend is a control on its way out, not a control that is working** — and the band alone
cannot show it.

## Verification history

Every `record()` appends an observation: `{ at, verifiedAt, source, completeness, freshness,
confidence, band }`. The current value is still the latest one; what changed is that the earlier
ones are no longer discarded.

**Re-recording an identical observation does not create a second history point.** Without that rule
a caller could manufacture any trend simply by calling `record()` in a loop, which would make the
trend a measure of how often the function was called.

## Confidence trend

`confidenceTrend(id)` reports `improving` · `stable` · `degrading` · `insufficient-data`, plus:

- `consecutiveFalls` — because endpoints lie. Evidence that fell, recovered and fell again has a
  flat delta and a real problem.
- `bandChanged`, `fromBand`, `toBand` — a move from `high` to `moderate` matters more than the same
  delta inside one band.

**A trend needs at least two verifications.** One observation is a value, not a direction, and
reporting "stable" from a single point would be an assertion nothing supports.

## Provenance reports

`provenanceReport(id)` traces one figure end to end: source kind and what that kind is worth,
completeness, freshness, age against its horizon, the reproducible calculation, the full
verification history, and the trend. Two fields exist to close the gaps a provenance report usually
leaves:

| Field | Says |
|---|---|
| `derivationNote` | Confidence is computed and **cannot be supplied** — `assess()` refuses a caller-provided value and fails closed |
| `doesNotEstablish` | *That the thing the evidence describes is correct, approved, or authorized. Evidence supports a human decision; it is never one* |

Evidence that was never recorded reports `known: false` with *"absence of a record is not evidence
of anything"* — it does not fall through to a default.

`provenance()` gives the register-wide view: everything degrading, everything untrended, the
weakest-link aggregate, and a digest over the whole set.

Live: `GET /api/assurance/evidence-provenance` · `GET /api/assurance/evidence-provenance/:id`
(admin).
