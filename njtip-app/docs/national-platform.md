# NJTIP v1.4 — National Digital Governance Platform

v1.4 evolves the enterprise system into a **national digital governance platform** supporting
multiple agencies, nationwide analytics, and operational intelligence — introduced entirely
through **new bounded contexts, ports, and adapters**. The frozen architecture, domain model,
and business logic are unchanged; every capability is additive, independently testable, and
gated by the Digital Engineering Twin (architecture + application + infrastructure).

> **Discipline preserved.** Zero runtime dependencies · synthetic data only · deterministic ·
> fail-closed · privacy by design · human governance. 🔒 cryptography/keys stay human-built;
> the AI layer is **advisory-only and never autonomous**; **evidence ≠ authorization**.

## New bounded contexts

| Phase | Capability | Module | Key guarantee |
|---|---|---|---|
| 11 | Event Sourcing + CQRS | `src/eventsourcing/` | Immutable, hash-chained log; replay = projection; PII-free events |
| 12 | Policy-as-data ABAC/PBAC | `src/iam/policy-engine.js` | Default-deny, deny-overrides, configurable without code |
| 19 | Zero Trust | `src/iam/zero-trust.js` | Trust scoring, continuous authz, break-glass with SoD |
| 22 | Multi-tenant platform | `src/tenancy/tenant.js` | Structural cross-tenant isolation (fail-closed) |
| 23 | Knowledge graph | `src/graph/graph.js` | Relationships only; refuses identifying properties |
| 13 | Advisory AI | `src/ai/` | Advisory-only, explainable, human-approval-gated |
| 20 | Workflow orchestration | `src/orchestration/` | Workflows as data; guards, approvals, SLA, versioning |
| 15 | Geographic intelligence | `src/geo/gis.js` | Coarsened geohash; heatmap small-cell suppression |
| 16 | Signed chain of custody | `src/custody/ledger.js` | Signed, timestamped, tamper-evident, archivable |
| 25 | Compliance automation | `src/compliance/` | Maps controls → standards; human-gated |
| 17/24 | Twin 2.0 + resilience | `src/twin2/simulation.js` | Capacity/failure/recovery/deploy/failover sims |
| 14 | Government data fabric | `src/fabric/registry.js` | Schema/service registries, canonical model, lineage |
| 21 | Executive intelligence | `analytics.executiveScorecard` | Governance-level, privacy-preserving scorecards |
| 18 | DevSecOps | `scripts/devsecops.js` | SAST, secret scan, SBOM, SCA, IaC, release evidence |

## Assurance

`npm run twin` runs the combined gate — **14 twin + 22 app + 8 infra = 44 invariants** — plus
99 tests. Each new context added at least one fitness function:

- `APP-FIT-EVENT-SOURCING` · `APP-FIT-POLICY-AS-DATA` · `APP-FIT-TENANT-ISOLATION` ·
  `APP-FIT-GRAPH-PRIVACY` · `APP-FIT-AI-ADVISORY-ONLY` · `APP-FIT-CUSTODY-SIGNED-CHAIN` ·
  `APP-FIT-GEO-PRIVACY` · and `INFRA-FIT-DEVSECOPS`.

## Commands

```bash
npm test            # 99 tests
npm run twin        # combined gate: 44 invariants (twin + app + infra)
npm run devsecops   # SAST + secret scan + SBOM + SCA + IaC + release evidence
npm run evidence    # signed, reproducible assurance package (by review domain)
npm run readiness   # human-gated readiness (never authorizes)
npm run health      # engineering-health score + trend
```

## Selected API surface (additive; backward compatible)

Event sourcing `/api/reports/{code}/events`, `/api/admin/events/verify`,
`/api/admin/readmodel/rebuild` · IAM `/api/authz/evaluate`, `/api/admin/policies`,
`/api/breakglass` · AI `/api/ai/recommend/{code}`, `/api/ai/decide/{id}` · Orchestration
`/api/orchestration/{start,fire,analytics}` · Custody `/api/custody/record`,
`/api/admin/custody/{verify,archive}` · GIS `/api/geo/heatmap` · Compliance
`/api/compliance/assess` · Executive `/api/executive/scorecard` · Twin 2.0
`/api/twin2/simulate` · Fabric `/api/fabric/catalog`.
