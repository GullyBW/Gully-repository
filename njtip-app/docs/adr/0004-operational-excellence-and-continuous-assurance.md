# ADR-0004: Operational excellence, continuous assurance, and the expanded ADR schema

- **Status:** Accepted · **Date:** 2026-08-02
- **Deciders:** Chief Architect, DevSecOps Lead, SRE Lead, Cybersecurity Architect, ARB, ISRB
- **Review required:** ARB + ISRB (security-critical subsystems: Zero Trust, formal policy verification, supply-chain attestation)

## Context

Architecture Baseline v1.7 is frozen (ADR-0002) and v1.9 stabilized the platform against it. The
remaining risk is no longer structural — it is **operational**: can the platform prove, continuously
and mechanically, that it is secure, reliable, recoverable, governed and legally compliant?

Phase 10 answers that with fifteen capabilities added **inside existing bounded contexts**. Two
things made this an ADR rather than routine work:

1. **Security-critical subsystems changed.** Zero Trust introduces workload identity and short-lived
   credentials on the authorization path; formal policy verification becomes a build gate; supply-chain
   attestation becomes a release gate. Each needs ISRB sign-off.
2. **The ADR schema itself changed.** Part 11 requires every ADR to record business justification,
   risk, four impact classes, rollback, migration, cost, success metrics, owner and approval history —
   and that requirement has to apply to something, starting somewhere.

## Decision

1. **Add fifteen operational capabilities inside existing contexts.** No new bounded context, no
   boundary change, no change to the frozen structure. The context map is updated in the same commit
   as each capability, as `APP-FIT-CONTEXT-MAP` requires.
2. **Expand the ADR schema** (`src/architecture/adr-governance.js`) with the twelve fields above, and
   **apply it from ADR-0004 onward**. ADRs 0001–0003 are held to the legacy schema.
3. **Every capability ships with executable fitness functions**, and each fitness function must
   demonstrate it *can* fail — the checker is fed an input that must break it.
4. **Continuous assurance becomes the deployment gate**: sixteen assurance domains, fail-closed, with
   a deployment authorization package that is prepared for a human authority and never replaces one.

## Consequences

- **Backward compatibility:** fully preserved. Every existing API, port, contract and test is
  unchanged; all additions are additive. `APP-FIT-INTEGRATION-CONTRACTS` would have failed the build
  otherwise.
- **Twin impact:** the gate grows from 85 to 100 invariants. It stays green throughout; each batch was
  verified before commit.
- **Threats/risks:** reduces TH-PRIV-ESCALATION (continuous re-evaluation, short-lived credentials),
  TH-SUPPLY-CHAIN (attestation gate), TH-AVAILABILITY (SRE gate, chaos in CI, multi-region), and
  TH-AUDIT-SUPPRESSION (continuous assurance evidence).
- **Trade-offs (named):** the build is slower — formal verification explores ~11,900 states and the
  chaos suite runs twelve checks on every commit. Accepted: a verification that runs quarterly is a
  document, not a control.

## Alternatives considered

- **Ship the capabilities without ADR governance changes** — rejected: Part 11 exists because reviewers
  could not see risk, rollback or cost in the previous format.
- **Retrofit the expanded schema onto ADRs 0001–0003** — rejected: rewriting decision history to
  satisfy a later standard destroys the record of what was actually known at the time.
- **Run formal verification and chaos nightly rather than per commit** — rejected: a gate that does not
  block a merge does not hold a line.
- **Adopt Cedar/OPA and Alloy/TLA+ directly** — rejected *for now*: it would break the zero-dependency
  stance. The specifications are written so those tools are drop-ins.

## Business justification

Botswana's justice transparency commitments require the platform to demonstrate integrity to
oversight bodies and the public on demand, not annually. Continuous assurance converts that from a
periodic audit exercise into a build artifact, and it is the precondition for any pilot deployment
conversation: no oversight board will authorize go-live on the basis of a review that is six months
old.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A fitness function passes vacuously and gives false assurance | medium | **high** | Every new fitness function is required to demonstrate failure on a crafted input |
| Slower builds erode developer discipline and gates get disabled | medium | high | Chaos runs at light volumes by default (`--full` on demand); all checks are deterministic so none is flaky |
| Zero Trust re-evaluation adds latency on the authorization path | low | medium | The PDP is pure in-process evaluation; SLO latency objectives cover it and the release gate would catch a regression |
| Formal specifications drift from the code they describe | medium | high | The checker evaluates the **real** `authz` and policy modules, not a copy |
| Synthetic signing identity mistaken for production signing | low | **critical** | Every attestation is labelled 🔒 synthetic; `NJTIP_KMS=kms` fails closed |

## Performance impact

The gate grows by roughly the cost of ~11,900 model-checking states plus twelve resilience checks;
both are in-process and dependency-free. Runtime request latency is unchanged: the PDP adds
in-process evaluation only, and no new I/O is introduced on any request path. The SRE release gate
would block a merge if latency objectives regressed.

## Security impact

Materially positive, and ISRB sign-off is required. Continuous authentication (stale auth is not
auth), workload identity with attestation, credentials capped at 15 minutes with refusal rather than
clamping, declared trust boundaries with default-deny, formal proof of authorization / SoD /
residency properties, and supply-chain attestation on every release. No control was weakened; the
DevSecOps scanner became *more* precise without losing sensitivity (fail-safe classification).

## Operational impact

New operational surfaces: reliability and error-budget reporting, audience dashboards, telemetry
failure analysis, the resilience suite, multi-region failover simulation and the continuous assurance
dashboard. All are read-only and advisory. Runbooks are updated in `docs/operations/`. The one real
operational obligation added: **the release gate can block a merge**, and clearing it requires a
named human to accept the risk with a rationale.

## Compliance impact

Legislative mandates now trace to fitness functions with three states — implemented and holding,
implemented and failing (a live breach), or unimplemented (a compliance gap) — and
`SPEC-LEGISLATIVE-COMPLIANCE` proves the property on every build. Data governance adds retention with
a stated legal basis, legal holds that beat retention, and purpose limitation across domains. Data
residency is now formally verified *and* enforced in multi-region routing.

## Rollback strategy

Each capability is additive and independently removable: delete the module, its fitness function, its
tests and its context-map entry, in one commit. Nothing else depends on any of them — the existing
domain modules were not modified. The gates that can block a build (formal policy, SRE release gate,
supply-chain verification, chaos) are individually removable from `scripts/assure.js` and CI without
touching business logic. There is no data migration to reverse.

## Migration strategy

Delivered in five batches, each independently green and pushed: (1) Zero Trust, threat model, formal
policy; (2) SRE, telemetry, chaos; (3) data governance, supply chain, multi-region; (4) AI governance,
ADR governance, consumer contracts, RACI; (5) executive dashboard and continuous assurance. Forward
references to fitness functions from later batches were trimmed and restored per batch so every
commit passed its own gate — no batch depended on a future one to be green.

## Estimated implementation cost

Reference implementation: ~5 engineer-days equivalent, delivered in one program. Production
realisation of the capabilities that need infrastructure — SLSA level 3 (hardened hosted build),
real multi-region provisioning, an external policy evaluator, an OpenTelemetry collector — is
estimated at 2–3 engineer-months plus infrastructure spend, and is tracked in the
[migration roadmap](../component-migration-roadmap.md) rather than claimed here.

## Success metrics

| Metric | Baseline (v1.9) | Target | Where measured |
|---|---|---|---|
| Combined gate invariants | 85 | ≥ 100 | `npm run twin` |
| Assurance domains continuously verified | 0 (ad hoc) | 16 | continuous assurance dashboard |
| Formal policy properties proven per build | 0 | ≥ 10 | `APP-FIT-FORMAL-POLICY` |
| Threats with a verified control | untracked | 100% | threat model traceability |
| Resilience checks executed per commit | 0 | ≥ 12 | `npm run chaos` |
| Manually entered executive metrics | unknown | **0** | executive dashboard evidence trace |

## Decision owner

**Office of the Chief Architect** (responsible), approved by **ARB** with **ISRB** sign-off on the
security-critical subsystems. Operational ownership of the new gates sits with the Assurance
Engineering Team; escalation follows the paths in the [ownership model](../governance-ownership.md).

## Approval history

| Date | Body | Outcome | Basis |
|---|---|---|---|
| 2026-08-02 | ARB | Accepted | Additive within Baseline v1.7; context map and contracts updated in the same commits; gate green at every step |
| 2026-08-02 | ISRB | Sign-off on Zero Trust, formal policy verification and supply-chain attestation | No control weakened; 🔒 key material remains human-built and synthetic identities are labelled |
| 2026-08-02 | OB | Noted — no constitutional invariant changed | Anonymity boundary, zone isolation and human accountability are untouched and re-verified |

## Human review

Production go-live, procurement of the infrastructure that SLSA L3 and multi-region need, and any
acceptance of a blocked release remain human decisions. Nothing in this ADR authorizes a deployment.
