# Design 04 — Security Architecture (Zero Trust)

**Implements:** D-01, D-02, D-06 · **Inputs:** Threat `../08`, Trust `../09`, ERA `01`, Data `02`.

> The zero-trust security architecture: identity & access, cryptography & key management
> (including the **threshold custody** that makes operator-in-threat-model real), the
> metadata-resistant intake path, secrets, and incident-response / DR / BCP. This is the most
> `🔒 HUMAN-EXPERT-REVIEW-REQUIRED` document in the set.

---

## 1. Zero-trust model

Every request authenticated, authorized (ABAC), encrypted, and logged — regardless of origin.
No network-location trust; no standing privilege. Policy enforced at the gateway **and** at each
service (defense in depth).

### DDR-09 — Zero-trust access: phishing-resistant MFA, ABAC, zero standing privilege
| Field | Content |
|-------|---------|
| **Context** | State-empowered adversary (TA-1), insiders (TA-2), operator in threat model (D-01). |
| **Decision** | All privileged humans use **FIDO2/WebAuthn hardware keys** (phishing-resistant). Authorization is **ABAC** on `{principal, role, zone, matter, purpose, risk}`. **Zero standing privilege**: sensitive scopes are granted **just-in-time**, time-boxed, and **dual-authorized** for the most sensitive; **separation of duties** so no single role spans investigate+adjudicate or disclose+seal. Reporters use anonymous, client-generated, non-attributable credentials (no identity to phish). |
| **Alternatives** | Passwords/TOTP — rejected (phishable, S-3). RBAC-only — rejected (too coarse for matter/zone scoping). Standing admin — rejected (E-1). |
| **Threats mitigated** | S-3, S-5, E-1, E-3 |
| **Privacy implications** | Reporter side deliberately identity-free (NR-1); official side strongly identified (R-3 accountability). |
| **Trade-offs** | ⚠️ hardware-key logistics; JIT friction for staff (accepted for safety). |
| **Future review trigger** | New privileged role; auth standard change. |

**Access tiers**

| Tier | Who | Controls |
|------|-----|----------|
| Anonymous | Reporters | Client-generated case code; no identity; capture-resistant |
| Identified external | Lawyers, defenders, legal aid | OIDC + FIDO2; matter-scoped ABAC |
| Identified official | Investigators, prosecutors, judiciary, oversight | FIDO2; zone+matter+purpose ABAC; SoD |
| Privileged operator | SRE/SecOps/DBA | **Zero standing privilege**; JIT + dual control + session recording + full audit |
| Governance custodian | Trust members | Threshold (M-of-N) for de-anon-capable or safety-override ops |

## 2. Cryptography & key management

### DDR-10 — Threshold (M-of-N) key custody + HSM; envelope encryption everywhere
| Field | Content |
|-------|---------|
| **Context** | Operator-in-threat-model + technical-inability-to-de-anonymize (D-01/D-02); compelled disclosure is the top risk (I-1/RK-01). |
| **Decision** | **HSM-backed KMS per zone**; **envelope encryption** (per-object data keys wrapped by zone KEKs). Any operation capable of **de-anonymizing** or **overriding safety** requires an **M-of-N threshold** of independent governance custodians (Shamir/threshold scheme, keys in HSMs, ideally split across jurisdictions per DDR-02) — so **no single operator, and no single compelled party, can do it**. **Crypto-agility**: algorithm identifiers versioned; rotation supported; post-quantum migration path planned. Reporter-facing content is **end-to-end** from client to the authorized-recipient boundary. |
| **Alternatives** | Single KMS admin — rejected (E-1, I-1 compliable). Operator-held master key — rejected (defeats D-01/D-02). |
| **Threats mitigated** | I-1, I-4, E-1, RK-01 |
| **Privacy implications** | Compelled party holds ciphertext + insufficient shares ⇒ cannot de-anonymize. |
| **Legal implications** | "Technical inability to comply" posture — **must be reviewed by Botswana legal** (contempt/obstruction exposure vs lawful design) (NC-2). 🔒 |
| **Trade-offs** | ⚠️ threshold ops are slow and require custodian availability; key-loss risk (mitigated by N>M redundancy + governed recovery). |
| **Future review trigger** | Crypto break/deprecation; custodian jurisdiction change; PQC readiness. |

**Crypto primitives (baseline — subject to cryptographer review 🔒):** AES-256-GCM (data),
RSA-3072/ECDH + HKDF or hybrid PQC (key exchange), Ed25519 (signatures), SHA-256/SHA-3 (hashing),
Argon2id (any passphrase KDF), RFC 3161 / transparency-log timestamps. **Crypto-agility** wrapper
so primitives can be swapped without redesign.

### DDR-11 — Metadata-resistant intake transport
| Field | Content |
|-------|---------|
| **Context** | Metadata, not content, de-anonymizes (I-2, ID-2, DT-1) — the empirically dominant failure. |
| **Decision** | Reporter intake via a **metadata-resistant channel**: an **onion/hidden-service** endpoint (and/or an isolated intake enclave) that **logs no client IP**, applies **timing/size padding** where feasible, strips client metadata (EXIF) client-side, and carries **no third-party SDKs/analytics** on the anonymity path. Pluggable transports/bridges for censorship resilience (A-TEC-04). Intake is architecturally separate from the ordinary API gateway. |
| **Alternatives** | Plain TLS + "we don't log IP" promise — rejected: operator-in-threat-model can't rely on promises; carrier still sees destination (ID-2). |
| **Threats mitigated** | I-2, ID-2, DT-1 |
| **Privacy implications** | Carrier sees "Tor/enclave," not "the reporting platform"; still cannot beat a global passive adversary (honest residual). |
| **Trade-offs** | ⚠️ COST/UX: onion access is less familiar; performance overhead; requires honest user guidance (U-1). |
| **Future review trigger** | Tor blocked nationally; new transport tech; traffic-analysis research. |

## 3. Secrets management

- Central **secrets manager** (per-zone scoping), dynamic short-lived credentials, automatic
  rotation, no secrets in code/images/logs (enforced in CI, `07`).
- Service identities via mTLS/workload identity; human access to secrets is JIT + audited.

## 4. Network & workload security

- Per-zone network segmentation; default-deny; no cross-zone DB routes (DDR-04).
- Hardened, minimal images; runtime security; the **anonymity-critical intake path runs isolated**
  (dedicated nodes / confidential-computing enclave) with a deliberately tiny dependency surface
  (mitigates T-3, E-2).
- WAF, rate limiting, DDoS scrubbing on public surfaces — configured to **not** undermine
  metadata resistance on the intake path (the D-1 vs I-2 tension, resolved by keeping intake off
  the CDN).

## 5. Incident Response, DR & BCP

**Incident Response (IR):** documented playbooks (SecOps, `06`); severity taxonomy;
**de-anonymization or reporter-safety incidents are the top severity** with a dedicated
runbook (contain → assess reach → safe-channel notification of affected class → governance
disclosure → post-mortem). Warrant-canary process for compelled-access transparency.

**Disaster Recovery (DR):** per-zone, tested **RTO/RPO** targets; ciphertext-only offshore DR
copies (DDR-02); **key shares never co-located with ciphertext**; regular restore drills.

**Business Continuity (BCP):** graceful degradation to a **minimal intake mode** if downstream is
unavailable (reporters can still file); governance-continuity plan (custodian succession, RK-17);
offshore governance fallback against domestic disruption.

| Threat/risk | IR/DR/BCP control |
|-------------|-------------------|
| De-anonymization incident | Top-sev runbook; safe-channel notify; disclose |
| Compelled access | Warrant canary; threshold ensures inability; legal escalation |
| DDoS (D-1/RK-13) | Scrubbing + degrade-to-minimal-intake |
| Data-center loss | Per-zone DR, tested restores |
| Governance disruption (RK-17) | Continuity plan + offshore fallback |

## 6. Security monitoring hooks (detail in `06`)

Every service emits security events to SIEM; anomaly detection on privileged access, cross-zone
egress, evidence access, and threshold operations. Tamper-evident audit (`06`/DDR-13) is the
backstop for insider abuse (T-2/E-1/E-3).

## 7. Quality gate

- **Threats mapped:** S-3/S-5, I-1/I-2/I-4, ID-2, DT-1, E-1/E-2/E-3, T-3, D-1, RK-01/RK-12/RK-13.
- **Residual risks (honest):** global passive adversary (TA-6) vs metadata; compromised reporter
  device; threshold-custodian collusion; successful compulsion if minimization/threshold
  mis-implemented. All carried from `../08 §2.8`.
- **Trade-offs:** documented per DDR (usability/cost vs safety; always resolved for safety).
- **Success criteria:** all privileged access is JIT+MFA (audited, 0 standing grants in prod);
  intake path logs no IP (verified by traffic inspection); threshold op requires M distinct
  custodians (tested); DR restore meets RTO/RPO in drills; no secret in any image (CI scan).
- **Specialist review:** 🔒 cryptographer (DDR-10/11, primitives, PQC), security architect,
  privacy engineer (metadata), Botswana legal (technical-inability posture, NC-2), forensics.

*Next: `05-ai-architecture.md`.*
