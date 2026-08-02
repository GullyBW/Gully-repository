# NJTIP v1.10 — Operational Excellence & Continuous Assurance

Phase 10 turns the stabilized platform into a **continuously verified** one. The architecture stays
frozen at [Baseline v1.7](./ARCHITECTURE-BASELINE-v1.7.md): no new bounded context, no boundary
change, every capability added *inside* an existing context with the context map updated in the same
commit. Recorded as [ADR-0004](./adr/0004-operational-excellence-and-continuous-assurance.md).

> **Discipline preserved.** Zero runtime dependencies · synthetic data only · deterministic ·
> fail-closed · privacy by design · human accountability. 🔒 cryptography and keys stay human-built.
> **Evidence ≠ authorization** — sixteen green assurance domains still do not authorize a deployment.

## What Phase 10 added

| Part | Capability | Module | The guarantee |
|---|---|---|---|
| 1 | Zero Trust architecture | `iam/zero-trust-architecture.js` · [doc](./zero-trust.md) | PAP→PDP→PEP; every request re-evaluated; nothing cached |
| 2 | Enterprise threat model | `security/threat-model.js` · [doc](./threat-model.md) | Threat → Control → Evidence → Verification → Owner, mechanically |
| 3 | Formal policy verification | `iam/formal-policy.js` · [doc](./formal-policy.md) | 10 specifications proven over ~11,900 states, with counterexamples |
| 4 | Reliability engineering | `observability/sre.js` · [doc](./reliability-engineering.md) | Release gate **fails when an SLO is violated** |
| 5 | Enterprise observability | `observability/telemetry.js` · [doc](./observability.md) | Zone-isolated topology; down vs degraded; no hand-entered health |
| 6 | Chaos & performance | `twin2/chaos.js` · [doc](./resilience-engineering.md) | 12 resilience checks in CI on every commit |
| 7 | Enterprise data governance | `fabric/data-governance.js` · [doc](./data-governance.md) | Origin → transformations → consumers → retention → deletion |
| 8 | Supply-chain attestation | `supplychain/slsa.js` · [doc](./supply-chain-security.md) | An unattested artifact is not deployable |
| 9 | AI governance | `ai/ai-lifecycle.js` · [doc](./ai-governance.md) | **There is no `apply()`** — the only exit is a human decision |
| 10 | Multi-region resilience | `twin2/multi-region.js` · [doc](./multi-region.md) | Residency-aware failover; read-only beats divergent writes |
| 11 | ADR governance | `architecture/adr-governance.js` | 12-field schema, validated; legacy ADRs not rewritten |
| 12 | Consumer-driven contracts | `contracts/consumer-contracts.js` · [doc](./consumer-contracts.md) | "Who breaks?" answered before the change |
| 13 | Operational governance | `governance/raci.js` · [doc](./operational-governance.md) | 300 RACI rows; no subsystem approves itself; 100% control ownership |
| 14 | Executive dashboard | `observability/executive.js` · [doc](./continuous-assurance.md) | No manually entered metrics — missing evidence stays unavailable |
| 15 | Continuous assurance | `assurance/continuous.js` · [doc](./continuous-assurance.md) | 16 domains, fail-closed; a green package authorizes nothing |

## Assurance

`npm run twin` runs the combined gate — **14 twin + 77 application + 9 infrastructure = 100
invariants** — plus **332 tests**. Fifteen new fitness functions, and each was written so that it
**can fail**: the model checker is fed a policy that must break it, the attestation verifier is fed a
tampered statement, the executive dashboard is fed an empty evidence bundle, the drift detector is
shown detecting drift, the reproducibility check is fed a counter.

```bash
npm test                    # 332 tests
npm run twin                # combined gate: 100 invariants
npm run assurance           # 16 assurance domains → deployment authorization package
npm run production-readiness # …plus the six items only a human can close
npm run chaos               # 12 resilience checks (load/stress/spike/soak/recovery + 7 faults)
npm run slice               # end-to-end vertical slice through the real composition root
npm run contracts           # deterministic, signed contract snapshot
npm run devsecops           # SAST + classified secret scan + SBOM + SCA + IaC
```

## Three things worth carrying forward

- **A verifier that cannot demonstrate failure is not a verifier.** Every new fitness function proves
  its own falsifiability. That discipline caught two real modelling errors during this phase — the
  partition experiment passing for the wrong reason, and a topology that violated zone isolation.
- **"Assured" and "authorized" are different words.** Sixteen green domains, a signed package and a
  readiness score of 1.0 still print `NOT AUTHORIZED`. A user in the v1.9 validation round read
  "readiness" as approval; this phase answers that finding in the wording of every payload.
- **Honest gaps beat complete claims.** SLSA level 2 is claimed because that is what the evidence
  supports; levels 3 and 4 are recorded as gaps with reasons. A posture that claims everything is the
  least credible kind.

## Version

**v1.10.0** — additive and fully backward compatible. No existing API, port, contract or test
changed, so semver says minor, not major, regardless of how much was added.
