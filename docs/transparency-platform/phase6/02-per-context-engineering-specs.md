# Phase 6 · WS2 — Per-Context Engineering Specifications

**Traces:** Domain `../06`, Design `../design/*`. **Provides** the fixed spec template for every
bounded context, plus **worked specs for the MVP contexts** (Confidential Reporting, Evidence, IAM).
Non-MVP contexts follow the same template during their phase. 🔒 subsystems are specified here but
implemented by human experts under ISRB sign-off.

---

## 1. Per-context spec template (mandatory sections)

`Responsibilities · Public APIs · Internal APIs · Events (pub/sub) · Commands · Queries · Domain
model (aggregates/invariants) · Validation rules · Security controls · Trust boundaries · Failure
modes · Monitoring · Scaling strategy · Deployment model · DDR/threat/risk refs · Acceptance
criteria.`

---

## 2. Context: Confidential Reporting 🔒 (Zone: Independent)

- **Responsibilities:** accept anonymous reports (client-encrypted), issue case codes, manage
  anonymous follow-up threads, hand off to routing. **Holds no reporter identity (D-02).**
- **Public APIs:** `POST /reports`, `GET /reports/{case_code}/status`, `POST
  /reports/{case_code}/messages` (contracts in `03`). Served on the metadata-resistant intake path
  (DDR-11), **not** the public gateway.
- **Internal APIs:** `emit ReportSubmitted/ReportRouted`; request envelope-encryption from KMS.
- **Events:** pub `ReportSubmitted`, `ReportRouted`, `ReportReceived`; sub none identifying.
- **Commands / Queries:** `SubmitReport`, `AddFollowUpMessage` / `GetStatusByCaseCode`.
- **Domain model:** `Report{ case_code(VO, high-entropy), category, created_at_coarse,
  content_cipher, content_key_ref, status }`. **Invariant:** no identity field may exist (CI-tested).
- **Validation:** category ∈ enum; ciphertext present + integrity hash; case_code entropy ≥ threshold.
- **Security controls:** client-side E2E; envelope encryption (DDR-10); no IP logging (DDR-11);
  capture-resistant credentials; anti-abuse preserving anonymity (S-4).
- **Trust boundaries:** untrusted client → intake enclave → Independent zone; threshold custody for
  any de-anon-capable op (there should be none in normal flow).
- **Failure modes:** intake degrade-to-minimal (D-1/D-4); KMS unavailable → fail-closed (no plaintext
  store); routing directory unsigned → reject (T-4).
- **Monitoring:** intake availability (Tier-1), submission success, **de-anon incidents = 0**
  (guardrail); no PII in telemetry.
- **Scaling:** stateless, horizontal; queue-backed submission.
- **Deployment:** isolated nodes/enclave; tiny dependency surface (T-3).
- **DDR/threat/risk:** DDR-03/05/10/11; ID-1,I-1,I-2,DT-1,S-1,S-2; RK-01/02/07.
- **Acceptance:** FR-001..006 pass; T-FR001/003 pass; ISRB + crypto sign-off. 🔒

## 3. Context: Evidence 🔒 (Zone: shared, zone-scoped keys)

- **Responsibilities:** ingest evidence, maintain **Digital Chain of Custody** (DDR-06), enforce
  access + integrity.
- **Public/Internal APIs:** `POST /evidence`, `GET /evidence/{id}` (authz + purpose), `GET
  /evidence/{id}/custody`; internal `AppendCustodyEvent`, `VerifyIntegrity`.
- **Events:** pub `EvidenceIngested`, `EvidenceAccessed`(→Audit).
- **Domain model:** `EvidenceObject{ id, content_hash(VO), cipher_ref, matter_ref, key_ref }`,
  `CustodyEvent{ object_hash, actor, role, purpose, ts_trusted, prev_hash }` (append-only).
- **Validation:** hash present + recomputed on ingest; size/type limits; sandboxed scan.
- **Security controls:** envelope encryption per-matter key; append-only hash-chained ledger;
  external anchoring; **integrity re-verify on every access**.
- **Trust boundaries:** custodian-of-record per matter; least privilege + dual control for sensitive
  access.
- **Failure modes:** hash mismatch → deny + alert (T-5); timestamp authority down → queue, never
  accept unstamped as final.
- **Monitoring:** integrity-check pass = 100%; anchor cadence; access audited.
- **DDR/threat/risk:** DDR-06/10; T-1,T-2,T-5,I-4; RK-08.
- **Acceptance:** FR-008 pass; custody reconstructable; forensics + crypto sign-off. 🔒

## 4. Context: Identity & Access (IAM) 🔒 (Zone: shared, zone-aware policy)

- **Responsibilities:** authN (FIDO2/OIDC), authZ (ABAC), zero standing privilege, JIT + dual
  control, session/audit.
- **APIs:** `POST /sessions` (WebAuthn), `POST /access-grants` (JIT, dual-approve), policy-decision
  endpoint for enforcement points.
- **Domain model:** `Principal{ roles[], entitlements[] }`, `AccessGrant{ scope, expiry, approvals[]
  }`. **Invariant:** sensitive scope requires JIT + (some) dual control; no standing grant.
- **Security controls:** phishing-resistant MFA (DDR-09); ABAC on {principal,role,zone,matter,
  purpose,risk}; SoD; every decision logged.
- **Failure modes:** policy engine unavailable → **fail-closed** (deny); malformed policy → deny.
- **Monitoring:** standing sensitive grants = 0; auth failures; privileged access alerts (SIEM).
- **DDR/threat/risk:** DDR-09; S-3,S-5,E-1,E-3; RK-06.
- **Acceptance:** SR-002/003 pass; 0 standing grants; ISRB sign-off. 🔒

## 5. Non-MVP contexts (spec later, same template)

Investigation, Prosecution, Adjudication, Defence, Corrections, Customary Justice, Governance,
Oversight, Transparency/Analytics, Notification, Secure Messaging, Audit, Digital Archive, AI
Assistance, SecOps — each gets a full spec at its phase, respecting zone ownership (D-06) and the
four-modes rule.

## 6. Quality gate

- **Traces to:** `../06`, `../design/02/04`; DDR-03/05/06/09/10/11; RK-01/06/08.
- **Preserves:** zone isolation, no-identity, chain-of-custody, zero standing privilege.
- **Residual risks:** MVP specs complete; non-MVP deferred (intentional); 🔒 impl pending expert build.
- **Trade-offs:** ⚠️ full per-context detail is large — sequenced by phase.
- **Acceptance criteria:** each MVP context spec covers all template sections + refs + acceptance;
  🔒 contexts marked review-required.
- **🔒 Required review:** ARB, ISRB + crypto (Reporting/Evidence/IAM), forensics (Evidence).

*Next: `03-executable-contracts.md`.*
