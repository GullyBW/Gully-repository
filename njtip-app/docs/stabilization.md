# NJTIP v1.9 — Production Engineering & Stabilization

v1.9 is the increment where the platform **stops growing outward and starts hardening**. The
architecture is frozen at [Architecture Baseline v1.7](./ARCHITECTURE-BASELINE-v1.7.md); no new
government domain and no new major bounded context was introduced. Everything added is *descriptive,
governance or assurance* work inside existing boundaries — and all of it is verified by the Digital
Engineering Twin rather than asserted in prose.

> **Discipline preserved.** Zero runtime dependencies · synthetic data only · deterministic ·
> fail-closed · privacy by design · human governance. 🔒 cryptography and keys stay human-built.
> **Evidence ≠ authorization** — no fitness result, readiness score, dashboard, recommendation or
> transcript authorizes a deployment.

## What v1.9 added (Parts 1–15)

| Part | Deliverable | Module / doc | Guarantee it added |
|---|---|---|---|
| 1 | Bounded-context map | `architecture/context-map.js` · [context-map.md](./context-map.md) | Every source module is owned by exactly one context; the graph is acyclic |
| 2 | Architecture Baseline v1.7 (frozen) | [ARCHITECTURE-BASELINE-v1.7.md](./ARCHITECTURE-BASELINE-v1.7.md) · ADR-0002, ADR-0003 | Structure changes only via ADR, verified in the same commit |
| 3 | Stable integration contracts | `contracts/integration-contracts.js` · [integration-contracts.md](./integration-contracts.md) | A breaking change is refused without a major version and a sunset |
| 4 | Component migration roadmap | `migration/roadmap.js` · [component-migration-roadmap.md](./component-migration-roadmap.md) | No synthetic component migrates without rollback, risks and real validations |
| 5 | Production vertical slice | `scripts/slice.js` (`npm run slice`) | The whole path runs through the real composition root, deterministically |
| 6 | Infrastructure assurance | `infra/infrastructure-assurance.js` · [infrastructure-assurance.md](./infrastructure-assurance.md) | IaC, SBOM, certificates, backups, drift, EOL — all gated |
| 7 | Legislative impact analysis | `legislation/impact.js` · [legislative-impact.md](./legislative-impact.md) | A legal change is simulatable, and a mandate with no control is a visible gap |
| 8 | Recovery strategy framework | `twin2/recovery-strategies.js` · [recovery-framework.md](./recovery-framework.md) | Strategies compared on RTO/RPO; selection needs a named human |
| 9 | National Data Exchange | `fabric/data-exchange.js` · [data-exchange.md](./data-exchange.md) | Purpose-limited at request **and** use; commercial exchange refused by name |
| 10 | Process governance mining | `orchestration/process-governance.js` · [process-governance.md](./process-governance.md) | Governance deviation and fraud signals, correlated with the controls |
| 11 | Quantum migration roadmap | `adapters/quantum-transition.js` · [quantum-migration-roadmap.md](./quantum-migration-roadmap.md) | No module outside the crypto registry names an algorithm |
| 12 | Observability by audience | `observability/dashboards.js` · [observability-dashboards.md](./observability-dashboards.md) | Six domains, six audiences; identity refused, small cells suppressed |
| 13 | Correlation governance | `intelligence/correlation-governance.js` · [cross-domain-governance.md](./cross-domain-governance.md) | Correlation is default-deny; prohibitions are named and audited |
| 14 | Governance ownership model | `governance/ownership.js` · [governance-ownership.md](./governance-ownership.md) | Every context has an owner; nobody approves their own subsystem |
| 15 | User validation | `ux/usability-validation.js` · [user-validation-report.md](./user-validation-report.md) | Refinement traced to observed behaviour, participants role-coded |

## Assurance

`npm run twin` runs the combined gate — **14 twin + 62 application + 9 infrastructure = 85
invariants** — plus **237 tests**. Thirteen new fitness functions were added, and each one was
written so that it *can* fail: the drift detector is shown detecting drift, the placeholder detector
is shown firing, the EOL check is shown flagging an expired component, the contract registry is shown
refusing a breaking change.

Three fail-closed startup gates now guard composition (the workflow must be formally proven, the
access-control policy set must validate, and the architecture-of-record, ownership model, contract set
and migration roadmap must all be valid), plus the supply-chain deployment gate.

## Commands

```bash
npm test            # 237 tests
npm run twin        # combined gate: 85 invariants (twin + app + infra)
npm run slice       # end-to-end vertical slice through the real composition root
npm run contracts   # deterministic, signed integration-contract snapshot
npm run evidence    # signed, reproducible assurance package
npm run readiness   # human-gated readiness (never authorizes)
npm run devsecops   # SAST + classified secret scan + SBOM + SCA + IaC
npm run health      # engineering-health score + trend
```

## Two findings worth carrying forward

- **Decision → evidence traceability is a usability blocker.** The data is hash-chained and complete;
  the *path* from a recorded decision back to its originating events is not there for an auditor.
- **A participant read "readiness" as approval.** The platform says *evidence is not authorization* in
  code, in prose and in every response payload — and a user still misread it. Governance language has
  to survive contact with people who are in a hurry.

Both are recorded in the [user validation report](./user-validation-report.md) and traced to the
context that would have to change. Neither is fixed by architecture.

## Prior increments

[ecosystem-intelligence.md](./ecosystem-intelligence.md) (v1.8) · [autonomous.md](./autonomous.md)
(v1.7) · [sovereign.md](./sovereign.md) (v1.6) · [ecosystem.md](./ecosystem.md) (v1.5) ·
[national-platform.md](./national-platform.md) (v1.4) ·
[enterprise-operations.md](./enterprise-operations.md) (v1.3) ·
[migration-guidance.md](./migration-guidance.md) (production migration).
