# Phase 7 · WS2 — Golden Paths & Reference Patterns

**Traces:** Design `../design/*`, Contracts `../phase6/03`, Standards `../phase6/04`. **Purpose:**
approved, opinionated implementation patterns that encode the architecture decisions so teams reuse
proven, compliant building blocks instead of re-deriving (and mis-implementing) them. Each pattern
lists the DDRs/threats it satisfies and its secure-by-default behavior.

---

## 1. Golden paths (each = template + example + tests + docs)

| Pattern | Secure-by-default behavior | DDR / threat | 🔒 |
|---------|----------------------------|--------------|----|
| **REST API** | Contract-first (OpenAPI); problem+json; uniform 404 (no enumeration); `additionalProperties:false`; rate limit; ABAC enforced | `../phase6/03`; S-4 | — |
| **Event-driven service** | Outbox + schema registry; **PII-free events**; idempotent consumers; zone-egress gateway for cross-zone | DDR-07; DD-1, I-6 | — |
| **Authentication** | OIDC + **FIDO2** for privileged; anonymous capture-resistant credential for reporters (no identity) | DDR-09; S-3, NR-1 | partial 🔒 (anon) |
| **Authorization** | ABAC {principal,role,zone,matter,purpose,risk}; **zero standing privilege**; fail-closed | DDR-09; E-1/E-3 | — |
| **Messaging** | Mode-appropriate; deniable for reporters; E2E where required | Secure Messaging ctx; NR-1 | 🔒 |
| **Observability** | Structured logs (no PII/IP), RED/USE metrics, sampled traces (no sensitive payloads) | `07`; DT-2, I-2 | — |
| **Data persistence** | Zone-isolated store; per-field policy required; envelope encryption; **no identity columns** | DDR-04/05; I-4/I-6/ID-1 | 🔒 (keys) |
| **Secure file handling** | Client hash + metadata-strip; envelope encrypt; append-only custody; integrity re-verify | DDR-06; T-1/T-2 | 🔒 |
| **Infrastructure** | Per-zone IaC; immutable images; no cross-zone DB route; drift detection | DDR-04; I-6 | — |
| **Testing** | Test-first; contract + privacy + invariant tests preincluded | `../phase6/06`; — | — |

## 2. Anatomy of a golden path

```
golden-path-<name>/
├─ template/           # scaffold: code skeleton + config (secure defaults)
├─ example/            # working example on synthetic data
├─ tests/              # unit + contract + privacy + invariant tests
├─ docs/               # when to use, decisions referenced, anti-patterns
└─ path.yaml           # DDR/threat/standard refs; zone-compatibility; 🔒 flag
```

## 3. Pattern governance

- **[DECISION]** Golden paths are **approved by ARB** (+ ISRB for 🔒 patterns) and versioned; changes
  go through the policy lifecycle (`../phase2/02`).
- **Deviation is allowed but governed:** a team may deviate with an ARB-approved exception (audited);
  deviating from a **security/privacy invariant** is not an "exception" — it needs OB super-majority
  (`../phase2/02 §5`).
- **Anti-patterns documented:** each path lists forbidden shortcuts (e.g., "don't log the IP",
  "don't add a national-ID field", "don't call across zones directly").

## 4. Why golden paths matter here specifically

**[FACT]** For a platform whose core promise is reporter safety, an inconsistent hand-rolled service
is a risk — one team logging an IP, adding an identity field, or crossing a zone can break the whole
guarantee. Golden paths make the **compliant implementation the default**, and governance automation
(`03`) makes the **non-compliant one fail CI**. ⚠️ Golden paths reduce but don't remove risk on 🔒
paths — those still require expert build + ISRB.

## 5. Quality gate

- **Traces to:** `../design/*`, `../phase6/03/04`; DDR-04/05/06/07/09.
- **Preserves:** every invariant, as a default in reusable form.
- **Threats mitigated:** I-6, ID-1, DD-1, S-3, T-1/T-2 — by construction across all services.
- **Residual risks:** patterns can lag architecture (mitigated: versioning + ARB review); 🔒 paths
  still need expert build.
- **Trade-offs:** ⚠️ opinionated paths constrain team autonomy — bought for consistency and safety.
- **Acceptance criteria:** each path has template+example+tests+docs+refs; ARB-approved; 🔒 paths
  ISRB-approved; anti-patterns documented and CI-checked.
- **🔒 Required review:** ARB (all paths), ISRB (auth/messaging/persistence-keys/file 🔒), privacy.

*Next: `03-governance-automation.md`.*
