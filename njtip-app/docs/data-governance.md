# Enterprise Data Governance (Phase 10, Part 7)

The data fabric extends from catalogue and lineage into full lifecycle governance: retention
policies, legal holds, purpose-limitation validation, consent lifecycle, metadata governance,
data-quality monitoring, classification, reference data and master data — with **cross-domain
lineage** (`src/fabric/data-governance.js`).

Gated by `APP-FIT-DATA-GOVERNANCE`. Live: `GET /api/data-governance` ·
`GET /api/data-governance/{dataset}/trace`.

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
