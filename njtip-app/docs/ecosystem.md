# NJTIP v1.5 — National Digital Governance Ecosystem

v1.5 evolves the platform into an **ecosystem** for governing long-lived, multi-agency,
event-driven, intelligent government services — introduced entirely through **additive**
bounded-context extensions behind stable ports. The frozen architecture, domain model, and
business logic are unchanged; every capability is independently testable and gated by the
Digital Engineering Twin (architecture + application + infrastructure).

> **Discipline preserved.** Zero runtime dependencies · synthetic data only · deterministic ·
> fail-closed · privacy by design · human governance. 🔒 cryptography/keys stay human-built;
> AI/graph inference is **advisory-only, never autonomous**; threat intel **can only lower
> trust**; compliance/readiness/maturity **never authorize**. **Evidence ≠ authorization.**

## What v1.5 added (Phases 26–40)

| Phase | Capability | Module | Guarantee |
|---|---|---|---|
| 26 | Event governance | `eventsourcing/event-governance.js` | Contracts governed; breaking evolution refused |
| 27 | Workflow simulation | `orchestration/workflow-simulator.js` | A version must pass before activation |
| 28 | Enterprise event bus | `fabric/event-bus.js` | PII-free pub/sub, ordering, replay, DLQ, federation |
| 29 | Twin 3.0 | `twin2/monte-carlo.js` | Deterministic Monte-Carlo; predictive readiness human-gated |
| 30 | Semantic search | `search/semantic.js` | Concept expansion, explainable; identity never indexed |
| 31 | Graph intelligence | `graph/intelligence.js` | Inference advisory + human-approval mandatory |
| 32 | Metadata platform | `fabric/metadata.js` | Classification, stewardship, quality, versioning |
| 33 | Decision support | `ai/decision-support.js` | Predictive, advisory, human-gated |
| 34 | Federated collaboration | `tenancy/federation.js` | Isolation default; federation explicit + SoD |
| 35 | Privacy engineering | `privacy/privacy-engineering.js` | PIA, differential privacy, anonymisation metrics |
| 36 | Threat intelligence | `security/threat-intel.js` | Enriches trust downward only; never overrides governance |
| 37 | API governance | `apigov/registry.js` | Contract validation, lifecycle, rate limiting |
| 38 | Capability model | `capability/model.js` | Capability map + live heat map |
| 39 | Developer platform | `devplatform/sdk.js` | Deterministic SDK/mock/harness from OpenAPI |
| 40 | Maturity intelligence | `maturity/maturity.js` | Capped at automation level 6; human-gated |

## Assurance

`npm run twin` runs the combined gate — **14 twin + 30 app + 8 infra = 52 invariants** — plus
123 tests. Each new context added at least one fitness function
(`APP-FIT-EVENT-GOVERNANCE`, `-WORKFLOW-SIMULATION`, `-EVENTBUS-FEDERATION`,
`-SEMANTIC-GRAPH-ADVISORY`, `-PRIVACY-ENGINEERING`, `-THREAT-INTEL-BOUNDED`,
`-API-GOVERNANCE`, `-PLATFORM-INTELLIGENCE`).

## Commands

```bash
npm test            # 123 tests
npm run twin        # combined gate: 52 invariants (twin + app + infra)
npm run evidence    # signed, reproducible assurance package (by review domain)
npm run readiness   # human-gated readiness (never authorizes)
npm run health      # engineering-health score + trend
npm run devsecops   # SAST + secret scan + SBOM + SCA + IaC + release evidence
```

Prior increments: [`national-platform.md`](./national-platform.md) (v1.4) ·
[`enterprise-operations.md`](./enterprise-operations.md) (v1.3).
