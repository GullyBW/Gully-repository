# Enterprise Data Governance (Phase 10, Part 7 · Phase 11, Part 7)

The data fabric extends from catalogue and lineage into full lifecycle governance: retention
policies, legal holds, purpose-limitation validation, consent lifecycle, metadata governance,
data-quality monitoring, classification, reference data and master data — with **cross-domain
lineage** (`src/fabric/data-governance.js`).

Gated by `APP-FIT-DATA-GOVERNANCE` and `APP-FIT-DATA-QUALITY`. Live: `GET /api/data-governance` ·
`GET /api/data-governance/{dataset}/trace` · `GET /api/data/quality`.

> **The guarantee every record must satisfy:**
> `Origin → Transformations → Consumers → Retention → Deletion`
> A record that cannot answer all five is not governed, and `traceRecord()` says so rather than
> returning a partial answer.

## Retention policies (with their legal basis)

| Class | Retention | Disposition | Basis |
|---|---|---|---|
| `case-record` | 7 years | archive | Public records retention from closure |
| `evidence` | 10 years | archive | Evidentiary retention, subject to legal hold |
| `audit-log` | 10 years | archive | Auditability of governance decisions |
| `governance-decision` | **permanent** | never destroyed | Institutional memory |
| `exchange-agreement` | 5 years | delete | Data-sharing accountability |
| `analytics-derivative` | 1 year | delete | Derived aggregates are re-computable |
| `telemetry` | 90 days | delete | Operational necessity only |

A dataset registered without a valid retention class is **refused** — every record has a policy or
it does not exist.

## Deletion is fail-closed in three directions

```
legal hold in force        → refused   (a hold beats the retention schedule)
retention not yet elapsed  → refused   (early deletion is destruction of evidence)
permanent record class     → refused   (governance decisions are never destroyed)
```

Placing or releasing a legal hold each require a **named authority and a rationale**. Deletion does
too — and it records both.

## Purpose limitation across domains

A dataset declares its purpose at registration. `addConsumer()` **refuses** a consumer whose declared
purpose differs, which is where purpose creep actually happens: not at collection, but the third time
a dataset is useful for something else.

## Cross-domain lineage

`lineageGraph()` returns nodes annotated with their domain and edges annotated with whether they
**cross a domain boundary** — `case-records → oversight-aggregates` (Justice → Insight) and
`case-records → audit-chain` (Justice → Governance) are the two that matter, because a cross-domain
edge is where governance usually leaks.

## Consent lifecycle — and its honest scope

Consent applies to identified data subjects, which the anonymous reporting path **never has**. The
module says so explicitly: `scope: 'staff-and-partner-data-only'`. Subjects are role-coded and
identity fields are refused. Consent is purpose-bound, expiring and withdrawable, and
`consentValid()` checks all three.

## Data quality, reference data and master data

Quality is observed across completeness, validity, consistency, timeliness and uniqueness; an
unobserved dataset reports `measured: false` rather than a fabricated score. Reference data is a
controlled vocabulary per set with a named authority; master data names one authoritative source and
one steward per entity, so "which system is right about agencies?" has an answer.

---

# Data Quality Governance (Phase 11, Part 7)

## Eight dimensions — two of which nobody can type in

| Dimension | Source | Measures |
|---|---|---|
| Completeness | observed | Required fields present |
| Validity | observed | Values inside the controlled vocabulary |
| Consistency | observed | Read model agrees with event replay |
| Timeliness | observed | Records carry usable timestamps |
| Uniqueness | observed | No duplicate keys |
| Accuracy | observed | Hash chains verify |
| **Lineage completeness** | **derived** | Origin, retention, disposition, declared consumers, governed upstreams |
| **Metadata completeness** | **derived** | Origin, classification, retention class, owner, domain, purpose, fields |

The last two are **refused as observations**. The platform already knows whether a dataset's
lineage and metadata are complete, so accepting a hand-entered figure would be accepting a claim in
place of a fact it can check. `observeQuality()` throws if you try.

## Three rules the module exists to enforce

**1. Unmeasured is not clean.** A dataset with no observation reports `measured: false`, never meets
its threshold, and carries `readinessImpact: 1` — exactly the same penalty as a *poor* dataset. An
entirely unobserved estate scores **0** quality readiness.

**2. Empty is not good.** A dataset holding zero records has no defects, but that is not an
achievement. It is banded `not-applicable` with zero readiness impact, so it can never be mistaken
for quality.

**3. Poor quality reduces governance readiness.** This is the whole point of Part 7. The score is
not a report beside the assurance framework, it is an *input to it*: `s.data.qualityAcceptable`
feeds the `dataGovernance` assurance domain, and a degraded estate fails it.

```
qualityReadiness = 1 − Σ readinessImpact / datasets
good/acceptable → 0 · degraded → 0.5 · poor or unmeasured → 1
```

## What the lineage check found

Applied to the platform's own estate, `lineageCompleteness` immediately flagged four governed
datasets — `audit-chain`, `evidence-refs`, `governance-decisions`, `platform-telemetry` — with **no
declared consumer**. They all have real ones. A dataset nobody is recorded as reading is a dataset
whose retention nobody can reason about, so the gap was in the *record*, not in the check, and the
seed was corrected rather than the check weakened.

## Alerts and remediation

Every alert routes to the dataset's **accountable owner** — an unrouted quality alert is an unowned
dataset. A remediation ticket requires a named human and a due date within 365 days; closing one
requires a named human **and evidence of the fix**. An overdue remediation blocks governance
readiness on its own.

## Measuring the platform's own estate

`measurePlatformQuality()` computes every observed dimension from live state — the read model, the
hash chains, the controlled vocabularies. Nothing is supplied, which is the only reason the figures
mean anything. Two properties fall out of that:

- A broken event or custody chain **zeroes** accuracy. Chain integrity has no partial credit.
- `oversight-aggregates` inherits its source's quality **dimension by dimension**. A derived
  dataset can never look cleaner than what it was derived from; an aggregate that does is the
  aggregation hiding the defect.

---

# Executive Quality Intelligence (Phase 12, Part 7)

`executiveQualityDashboard()` exists because the board's question is not *"what is the completeness
of `oversight-aggregates`?"* — it is **"can I rely on what this platform tells me?"** A dashboard
that presents eight dimensions across a dozen datasets and leaves the reader to work out which of
them matters has answered a question nobody asked.

So the dashboard states the question, answers it in a sentence, and only then shows the working:

| Field | What it is |
|---|---|
| `question` / `answer` | The board's question, and a one-sentence answer that changes when the estate changes |
| `qualityReadiness` | The readiness figure the rest of governance consumes — not a separate number |
| `acceptable` | The verdict. `false` while any blocker stands |
| `blockers` | Never-measured datasets, poor-band datasets, overdue remediations — named individually |
| `byDomain` | Per-domain score and status (`sound` · `at-risk` · `unmeasured`), **worst domain first** |
| `byOwner` | Every dataset grouped under its accountable steward |
| `worstDataset` | Named, because an average hides exactly the thing a board needs to see |

## Unmeasured is not sound

The dashboard carries this sentence verbatim, because it is the one a quality dashboard usually
omits:

> A dataset with no quality observation is reported as **unmeasured**, not as sound. Absence of a
> measurement is not evidence of quality.

An estate that has never been measured therefore produces `acceptable: false` and a blocker per
dataset — not a blank scorecard that reads like a clean one. This is the same rule the readiness
model applies: an unmeasured dataset reduces readiness exactly as a poor one does.

## The answer moves, not just a number

Degrading a single dataset flips `answer` from *"Yes, for every measured dataset"* to *"Not fully.
The blockers below must be closed before a figure derived from them is quoted."* A dashboard whose
prose is constant regardless of the estate is decoration; this one is wired to the same
`governanceReadiness()` that gates the build.

`informationalOnly: true`, `authorizes: false`. The dashboard can **block** a figure from being
quoted. It cannot approve anything.

Live: `GET /api/data/quality/executive` (oversight-board).
