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

> **v1.13 — institutional resilience, documentation assurance & organizational continuity.** The
> architecture stays **frozen** at [Baseline v1.7](./docs/ARCHITECTURE-BASELINE-v1.7.md)
> ([ADR-0008](./docs/adr/0008-institutional-assurance-and-the-single-dependency-invariant.md)).
> Phase 13 asks what nothing had asked — *could the institution running this survive losing one of
> anything?* — and adopts a new global invariant: **no critical capability may depend on a single
> person, process, document or system**. It does not currently hold, which is the point of adopting
> it: three constitutional capabilities rest on a single per-zone persistence store, recorded as a
> ratchet so no new single dependency can join them.
> Also: an [executable assumption registry](./docs/assumptions.md) where declared and assessed
> confidence are separate and the gap is named an overclaim;
> [twin confidence](./docs/assumptions.md) capped by calibration, so a simulation nobody has checked
> against reality cannot claim to be trusted;
> [documentation assurance](./docs/documentation-assurance.md) across the whole corpus, with the
> extractor guarding its own yield; [governance rehearsals](./docs/rehearsals-and-memory.md) scored
> against what the runbook promised rather than against effort;
> [decision memory](./docs/rehearsals-and-memory.md) where a decision nobody checked is unevaluated
> rather than successful; [evidence quality](./docs/drift-and-quality.md) in which corroboration
> from the same source kind is not corroboration; and an
> [institutional assurance framework](./docs/institutional-assurance.md) over thirteen domains that
> proves readiness and still prints `NOT AUTHORIZED`.
> Combined gate: **143 invariants**, 742 tests. Full summary: [`docs/institutional-assurance.md`](./docs/institutional-assurance.md) ·
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
