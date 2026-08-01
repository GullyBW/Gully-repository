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
npm test           # 237 tests (vertical slice + API + adapters + domain + fitness + assurance)
npm start          # serve the app + UI at http://localhost:8087
npm run twin       # combined gate: 85 invariants (14 twin + 62 app + 9 infrastructure)
npm run slice      # end-to-end vertical slice through the real composition root (deterministic)
npm run contracts  # deterministic, signed integration-contract snapshot + OpenAPI fragment
npm run perf       # load + soak + chaos resilience harness (Phase 5)
npm run evidence   # deterministic, signed assurance evidence package (Phase 9)
npm run readiness  # human-gated operational readiness assessment (Phase 10 — never authorizes)
npm run devsecops  # SAST + classified secret scan + SBOM + SCA + IaC
npm run health     # engineering-health score + transparent trend (Phase 8)
# container (build context = repo root, so it can copy the Twin it validates against):
docker build -f njtip-app/Dockerfile -t njtip-app . && docker run -p 8087:8087 njtip-app
# reference Kubernetes + pilot manifests (HA, autoscaling, zone-isolation, canary):
ls deploy/k8s/ deploy/pilot/
```

> **v1.9 — Production engineering & stabilization.** The architecture is **frozen** at
> [Architecture Baseline v1.7](./docs/ARCHITECTURE-BASELINE-v1.7.md); no new government domain and no
> new bounded context. v1.9 hardens what exists: a verified [context map](./docs/context-map.md) that
> owns every source module, an [institutional ownership model](./docs/governance-ownership.md),
> [stable integration contracts](./docs/integration-contracts.md) that refuse silent breaking changes,
> a [component migration roadmap](./docs/component-migration-roadmap.md) with rollback per subsystem,
> [infrastructure assurance](./docs/infrastructure-assurance.md), a classified DevSecOps scanner,
> [legislative impact analysis](./docs/legislative-impact.md), a
> [recovery strategy framework](./docs/recovery-framework.md), the
> [National Data Exchange](./docs/data-exchange.md),
> [process governance mining](./docs/process-governance.md), a
> [quantum migration roadmap](./docs/quantum-migration-roadmap.md),
> [audience-specific dashboards](./docs/observability-dashboards.md),
> [correlation governance](./docs/cross-domain-governance.md) and
> [user validation](./docs/user-validation-report.md).
> Combined gate: **85 invariants**, 237 tests. Full summary: [`docs/stabilization.md`](./docs/stabilization.md) ·
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
