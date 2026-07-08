# NJTIP — Phase 6: Engineering Execution & Reference Implementation (Index)

**Status:** DRAFT — Engineering Execution Framework. **No production deployment; no production data;
synthetic datasets only.** **Do not redesign approved architecture/governance.**
**Immutable baseline:** Discovery `../01`–`../12`, Design `../design/*`, Phases 2–5 `../phase2..5/*`.
**Last updated:** 2026-07-07

> Phase 6 turns the approved blueprint into **implementation-ready engineering specifications** —
> an architecture repository, per-context specs, executable contracts, engineering standards, a
> reference-implementation design, a V&V framework, engineering work packages, systems-engineering
> reviews, DevSecOps guidance, and engineering governance. It **engineers**; it does not redesign.
> Consumable directly by software/DevSecOps/QA/platform/security engineers and PMs.

## The autonomy boundary (carried from `../design/07 §6`, reaffirmed by WS10)

**[DECISION]** AI may generate specifications, scaffolding, tests, docs, and **non-security-critical**
code on synthetic data. AI **must not** autonomously build, finalize, or auto-merge the
`🔒 CRITICAL SUBSYSTEMS`: **anonymity, cryptography & key custody, digital chain of custody,
metadata-resistant intake, zone-egress/ABAC policy, and AI-assistance boundaries.** Those receive
**interface + test specifications here**, and their implementation is **human-expert-built and
ISRB-signed** (CI `HUMAN` gate). This document keeps that line explicit so engineering velocity
never erodes the reporter-safety guarantees.

## Documents (10 workstreams)

| WS | File | Scope |
|----|------|-------|
| 1 | [Architecture Repository](./01-architecture-repository.md) | Living, traceable repo of requirements↔DDRs↔components↔APIs↔events↔data↔threats↔tests↔evidence↔metrics |
| 2 | [Per-Context Engineering Specs](./02-per-context-engineering-specs.md) | Spec template + worked MVP contexts (Reporting, Evidence, IAM) |
| 3 | [Executable Contracts](./03-executable-contracts.md) | OpenAPI, AsyncAPI, JSON Schema, event catalog, DB schemas, IAM policy, errors, versioning |
| 4 | [Engineering Standards](./04-engineering-standards.md) | Coding, API, logging, observability, testing, docs, infra, deps, secrets, crypto handling, release |
| 5 | [Reference Implementation](./05-reference-implementation.md) | Repo layout, local dev env, CI/CD, infra, monitoring, synthetic data, demo workflows |
| 6 | [Verification & Validation](./06-verification-validation.md) | V&V framework: requirement→decision→task→test→review→acceptance→evidence |
| 7 | [Engineering Work Packages](./07-engineering-work-packages.md) | Epics/Features/Stories/Tasks, acceptance, test cases, DoD, sprint sequencing |
| 8 | [Systems Engineering Reviews](./08-systems-engineering-reviews.md) | SRR/PDR/CDR/TRR/ORR/PRR with entry/exit/approval |
| 9 | [DevSecOps Engineering](./09-devsecops-engineering.md) | IaC, CI/CD, security testing, supply chain, SBOM, signing, deploy, rollback, DR validation |
| 10 | [Engineering Governance](./10-engineering-governance.md) | Alignment to governance; AI autonomy boundary; gate enforcement |

## Engineering principles (inherited, enforced)

Preserve approved architecture/governance · full enterprise traceability (`../phase5/11`) ·
security & privacy by design · Zero Trust · event-driven + domain-driven · IaC + immutable infra
where apt · open standards · **test-first** · observability by default · **fail-closed** for
security-critical controls · **human approval for all production-impacting decisions**.

## Synthetic-data requirement (absolute)

**[FACT]** All development, testing, demonstration, and validation use **synthetic datasets** until
the governance, legal, privacy, operational, and production-readiness gates are independently
approved (`../phase2/05`, `../phase3/07/08`, `../phase5/06`). **No production integrations or live
justice-sector data.** CI enforces this (`../design/07 §3`).

*Read `01`→`10`.*
