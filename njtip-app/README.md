# NJTIP — Product (Anonymous Reporting → Governance)

A **production-track implementation** of the National Justice Transparency & Integrity Platform: a
complete, runnable **anonymous-reporting → governance-decision** platform that exercises every major
architectural subsystem, with the [Digital Engineering Twin](../njtip-twin/README.md) as the permanent
quality gate.

> **SYNTHETIC ONLY.** No production systems/data. **Zero runtime dependencies** (Node built-ins).
> Production concerns sit behind **stable ports**; in-repo **reference drivers** are synthetic and
> labelled, and **production drivers** are documented drop-ins (the
> [component transition matrix](./docs/component-transition-matrix.md) and
> [`docs/production-adapters.md`](./docs/production-adapters.md) govern the swap). **Evidence supports
> human decisions; it never replaces them.**

## Run it

```bash
cd njtip-app
npm test                     # 332 tests
npm start                    # serve the app + UI at http://localhost:8087
npm run twin                 # combined gate: 100 invariants (14 twin + 77 app + 9 infrastructure)
npm run assurance            # 16 assurance domains → signed deployment authorization package
npm run production-readiness # …plus the six items only a named human can close
npm run chaos                # resilience: load/stress/spike/soak/recovery + 7 fault injections
npm run slice                # end-to-end vertical slice through the real composition root
npm run contracts            # deterministic, signed integration-contract snapshot
npm run evidence             # deterministic, signed assurance evidence package
npm run readiness            # human-gated operational readiness assessment (never authorizes)
npm run devsecops            # SAST + classified secret scan + SBOM + SCA + IaC
npm run perf                 # load + soak + chaos performance harness
# container (build context = repo root, so it can copy the Twin it validates against):
docker build -f njtip-app/Dockerfile -t njtip-app . && docker run -p 8087:8087 njtip-app
# reference Kubernetes + pilot manifests (HA, autoscaling, zone-isolation, canary):
ls deploy/k8s/ deploy/pilot/
```

> **v1.14 — adaptive governance, strategic decision support & advanced institutional resilience.** The
> architecture stays **frozen** at [Baseline v1.7](./docs/ARCHITECTURE-BASELINE-v1.7.md)
> ([ADR-0009](./docs/adr/0009-adaptive-governance-and-the-four-clause-invariant.md)).
> Phase 13 asked whether the institution could survive losing one of anything. Phase 14 asks the
> harder question — *a capability can pass that test and still be fragile* — and widens the invariant
> to four clauses: **no critical institutional capability may depend upon an unvalidated assumption,
> an unverified dependency, an undocumented governance relationship, or a single point of
> organizational failure**. It does not hold, which is again the point; `evidence-custody` satisfies
> all four under evidenced conditions, so the bar is reachable rather than decorative.
> Also: an [assumption dependency graph](./docs/assumptions.md) where invalidating one belief cascades
> to everything necessarily resting on it — and where ASM-0006 turns out to carry seven of the nine;
> [six-dimension twin confidence](./docs/operations-twin.md) derived rather than assigned;
> [temporal mission impact](./docs/business-observability.md) across five horizons, where unknown
> impact never becomes no impact; [diagram assurance](./docs/documentation-assurance.md) in which
> every node and arrow must resolve against the implementation;
> [strategic scenario planning](./docs/strategic-planning.md) for funding cuts, restructures,
> legislation and emergencies; [governance optimization](./docs/adaptive-governance.md) that may never
> reduce the distinct authorities in a decision; [capacity planning](./docs/adaptive-governance.md)
> that returns `null` rather than a plausible number; [cross-agency coordination](./docs/adaptive-governance.md)
> across 27 derived institutions where a declared relationship is never a working one;
> [institutional learning](./docs/strategic-planning.md) that distinguishes correcting from learning;
> and [public trust indicators](./docs/business-observability.md) that state on every row that they do
> **not** measure trust — because the people whose trust matters most are the ones who considered
> reporting and decided not to, and nothing here can reach them.
> Combined gate: **161 invariants**, 874 tests. Full summary: [`docs/strategic-planning.md`](./docs/strategic-planning.md) ·
> v1.13: [`docs/institutional-assurance.md`](./docs/institutional-assurance.md) ·
> v1.12: [`docs/predictive-governance.md`](./docs/predictive-governance.md) ·
> v1.11: [`docs/adaptive-assurance.md`](./docs/adaptive-assurance.md) ·
> v1.10: [`docs/high-assurance.md`](./docs/high-assurance.md) ·
> v1.9: [`docs/stabilization.md`](./docs/stabilization.md) ·
> production migration: [`docs/migration-guidance.md`](./docs/migration-guidance.md) ·
> v1.8: [`docs/ecosystem-intelligence.md`](./docs/ecosystem-intelligence.md) ·
> v1.7: [`docs/autonomous.md`](./docs/autonomous.md) · v1.6: [`docs/sovereign.md`](./docs/sovereign.md) ·
> v1.5: [`docs/ecosystem.md`](./docs/ecosystem.md) · v1.4: [`docs/national-platform.md`](./docs/national-platform.md) ·
> v1.3: [`docs/enterprise-operations.md`](./docs/enterprise-operations.md).

## v1.2 — operational production platform (ports & adapters)

Production concerns are implemented **behind stable ports**, selected only at the composition root
(`src/app.js`) so business logic never changes when a driver is swapped:

- **Persistence** — `memory` · `file` · `sql` (PostgreSQL; per-zone schemas/roles, no identity column).
- **Encryption at rest** 🔒 — KMS port (reference = Twin envelope crypto; real KMS/HSM is human-built).
- **Evidence object storage** — ciphertext-only (plaintext refused); S3/MinIO/GCS drop-ins.
- **Messaging** — PII-free transactional outbox; Kafka/RabbitMQ/NATS drop-ins.
- **Federated auth** — OIDC/OAuth2 verifier alongside HMAC sessions (server accepts either).
- **Staff notifications** — email/SMS/push with the anonymity boundary enforced.
- **Authorization** — default-deny **RBAC + ABAC** (MFA step-up, zone/matter scoping); see [`docs/authz.md`](./docs/authz.md).
- **Domain lifecycles** — guarded **case** and **evidence** state machines (illegal transitions refused).
- **Assurance** — an **app fitness gate** (8 checks) runs with the Twin gate (14); a signed, deterministic
  **evidence package** and a **human-gated readiness** assessment support independent review.

Every change runs the app tests **and** the combined fitness gate; a non-bundled production driver
**fails closed** rather than silently degrading.

**Config (env):** `NJTIP_MODE` · `NJTIP_PERSISTENCE` (memory|file|sql) · `NJTIP_DATA_DIR` ·
`NJTIP_KMS` · `NJTIP_OBJECT_STORE` · `NJTIP_BROKER` · `NJTIP_OIDC_ISSUER`/`_AUDIENCE`/`_SECRET` ·
`NJTIP_SESSION_SECRET` (from a secrets manager in prod) · `PORT` · `NJTIP_LOG_LEVEL`.
Ops: [`docs/operations/runbook.md`](./docs/operations/runbook.md) · Deploy: [`deploy/k8s/`](./deploy/k8s/).

## The vertical slice (Part 3)

```
Citizen → Anonymous Report → Policy Validation → Evidence Store → Audit Chain →
Investigator Review → Oversight Dashboard → Governance Decision → Evidence Generation → Twin Validation
```

| Step | Subsystem exercised | Endpoint |
|------|---------------------|----------|
| Anonymous report (no identity accepted) | Policy engine · Reporting store · CoI routing · Audit | `POST /api/reports` |
| Status by code only | Reporting projection | `GET /api/reports/{code}/status` |
| Secure evidence | Evidence store · Chain of custody · Audit | `POST /api/reports/{code}/evidence` |
| Investigator review | IAM (JIT + FIDO2 + matter-scoped) · Audit | `POST /api/investigator/{code}/review` |
| Case lifecycle (guarded) | RBAC+ABAC · case state machine | `POST /api/investigator/{code}/transition` |
| Evidence lifecycle (guarded) | Evidence state machine · custody | `POST /api/investigator/{code}/evidence/{id}/transition` |
| Oversight | Analytics (aggregate, non-attributable) | `GET /api/oversight/dashboard` |
| Governance decision (human-only) | Governance ledger (append-only, hash-chained) | `POST /api/governance/decisions` |
| Evidence generation | Deterministic digest + Ed25519 signature | `GET /api/evidence/bundle` |
| **Twin + app validation** | Combined architecture fitness gate | `GET /api/twin/validate` |
| Assurance package / readiness (admin) | Signed evidence · human-gated readiness | `GET /api/assurance/evidence-package` · `/readiness` |

Contract: [`docs/api`](./docs/api/) · OpenAPI served at `GET /openapi.json`. UI prototype: `ui/index.html`.

## What's real vs synthetic

The workflow, policy default-deny, no-identity enforcement, conflict-of-interest routing, zero
standing privilege, chain of custody, append-only audit, RBAC+ABAC authorization, guarded case/evidence
lifecycles, and human-only governance recording are **real, tested behaviour** — as are the port
*contracts* the production adapters must satisfy (ciphertext-only storage, PII-free events, no identity
column, anonymity boundary, no implicit privilege), each verified by an app fitness function.
Cryptography/keys, the concrete storage/broker/IdP backends, and auth tokens are **synthetic reference
drivers**; production drivers are documented drop-ins (the
[transition matrix](./docs/component-transition-matrix.md) and
[`docs/production-adapters.md`](./docs/production-adapters.md) govern the swap). The 🔒
anonymity/crypto/key-custody subsystems remain human-expert-built and are never autonomously generated.

## Continuous assurance

Every change runs the app tests **and** the Twin fitness gate (`.github/workflows/njtip-app.yml`).
Architecture violations fail CI. See [`docs/`](./docs/) for the Architecture Baseline v1.0, ADRs,
engineering platform, deployment reference architectures, NFR validation, and review-readiness.
