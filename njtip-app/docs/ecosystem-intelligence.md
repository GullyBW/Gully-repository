# NJTIP v1.8 — National Digital Ecosystem Intelligence Platform

v1.8 extends NJTIP from governing *government systems* to governing the *entire national
digital ecosystem* — introduced entirely through **additive** bounded-context extensions
behind stable ports. The frozen architecture, domain model, and business logic are unchanged;
every capability is independently testable and gated by the Digital Engineering Twin
(architecture + application + infrastructure).

> **Discipline preserved.** Zero runtime dependencies · synthetic data only · deterministic ·
> fail-closed · privacy by design · human governance. 🔒 cryptography/keys stay human-built;
> AI/inference is advisory + governance-approved; crisis/recovery **recommend but never execute
> without human authorization**; marketplace/legislation publication and every strategic
> projection are **advisory and human-approved**. **Evidence ≠ authorization.**

## What v1.8 added (Phases 61–70)

| Phase | Capability | Module | Guarantee |
|---|---|---|---|
| 61 | Ecosystem federation | `tenancy/ecosystem-federation.js` | Typed members; explicit, SoD, time-boxed, human-approved |
| 62 | Digital asset governance | `governance/asset-governance.js` | Every asset lifecycle-traceable |
| 63 | National crisis management | `twin2/crisis.js` | Deterministic sims; ops need human authorization |
| 64 | Service portfolio management | `portfolio/service-portfolio.js` | Services as products; advisory optimization |
| 65 | Supply-chain governance | `supplychain/supply-chain.js` | No deployment bypasses it (fail-closed gate) |
| 66 | Adaptive governance | `governance/adaptive.js` | Continuous improvement; adoption human-approved |
| 67 | Knowledge & decision repository | `knowledge/repository.js` | Immutable, hash-chained institutional memory |
| 68 | Capability marketplace | `devplatform/capability-marketplace.js` | Publication certified + human-approved |
| 69 | Sustainability & lifecycle | `sustainability/lifecycle.js` | Decades-long stewardship; advisory |
| 70 | Strategic Twin 5.0 | `twin2/strategic-twin.js` | Long-term projections; never authorizes |

## Assurance

`npm run twin` runs the combined gate — **14 twin + 48 app + 8 infra = 70 invariants** — plus
161 tests. Each new context added at least one fitness function (`APP-FIT-ECOSYSTEM-ASSETS`,
`-CRISIS-PORTFOLIO`, `-SUPPLY-CHAIN-GOVERNANCE`, `-KNOWLEDGE-CAPABILITY`,
`-SUSTAINABILITY-STRATEGIC`). Two v1.6 **fail-closed startup gates** remain (formal workflow
proof + policy validation), and supply-chain governance adds a fail-closed deployment gate.

## Commands

```bash
npm test            # 161 tests
npm run twin        # combined gate: 70 invariants (twin + app + infra)
npm run evidence    # signed, reproducible assurance package (by review domain)
npm run readiness   # human-gated readiness (never authorizes)
npm run health      # engineering-health score + trend
npm run devsecops   # SAST + secret scan + SBOM + SCA + IaC + release evidence
```

Migration to production drivers: [`migration-guidance.md`](./migration-guidance.md).
Prior increments: [`autonomous.md`](./autonomous.md) (v1.7) · [`sovereign.md`](./sovereign.md)
(v1.6) · [`ecosystem.md`](./ecosystem.md) (v1.5) · [`national-platform.md`](./national-platform.md)
(v1.4) · [`enterprise-operations.md`](./enterprise-operations.md) (v1.3).
