# Phase 6 · WS3 — Executable Contracts

**Traces:** Interoperability `../phase2/07`, Integration `../design/03`, per-context specs `02`.
**Provides** representative OpenAPI, AsyncAPI, JSON Schema, event catalog, DB schema, IAM policy,
error catalogue, and versioning strategy. Contracts are **API-first**: written before/with code and
enforced by contract tests. (Extends the samples in `../phase2/12`.)

---

## 1. OpenAPI (Confidential Reporting — excerpt)

```yaml
openapi: 3.1.0
info: { title: Reporting API, version: 1.0.0 }
paths:
  /reports:
    post:
      operationId: submitReport
      requestBody:
        content: { application/json: { schema: { $ref: '#/components/schemas/ReportSubmission' } } }
      responses:
        "201": { content: { application/json: { schema: { $ref: '#/components/schemas/CaseHandle' } } } }
        "400": { $ref: '#/components/responses/Problem' }
        "429": { $ref: '#/components/responses/Problem' }   # anonymity-preserving rate limit (S-4)
components:
  schemas:
    ReportSubmission:
      type: object
      required: [content_cipher, content_key_ref, category, client_integrity_hash]
      properties:
        content_cipher: { type: string }
        content_key_ref: { type: string }
        category: { type: string, enum: [police,courts,prosecution,prison,official,regulatory,other] }
        evidence_refs: { type: array, items: { type: string } }
        client_integrity_hash: { type: string }
      additionalProperties: false     # reject unknown fields (no smuggling identity)
    CaseHandle: { type: object, properties: { case_code: { type: string } } }
  responses:
    Problem: { content: { application/problem+json: { schema: { $ref: '#/components/schemas/Problem' } } } }
```

## 2. AsyncAPI (event backbone — excerpt)

```yaml
asyncapi: 3.0.0
info: { title: NJTIP Events, version: 1.0.0 }
channels:
  reporting.report-routed:
    address: njtip.reporting.ReportRouted.v1
    messages: { ReportRouted: { $ref: '#/components/messages/ReportRouted' } }
operations:
  onReportRouted: { action: receive, channel: { $ref: '#/channels/reporting.report-routed' } }
components:
  messages:
    ReportRouted:
      payload:
        type: object
        required: [case_code, recipient_id, coi_status]
        properties:
          case_code: { type: string }
          recipient_id: { type: string }
          coi_status: { type: string, enum: [clear, recused-rerouted] }
        additionalProperties: false   # PII-free invariant (registry-enforced)
```

## 3. Event catalog (MVP subset)

| Event | Producer | Consumers | Zone-cross? | PII |
|-------|----------|-----------|-------------|-----|
| `ReportSubmitted.v1` | Reporting | (internal) | no | none |
| `ReportRouted.v1` | Reporting/Governance | Investigation, Oversight | yes (Ind→Exec) | none |
| `ReportReceived.v1` | Investigation | Oversight | yes | none |
| `EvidenceIngested.v1` | Evidence | Inv/Pros/Adj | scoped | none |
| `EvidenceAccessed.v1` | Evidence | Audit | no | none |
| `AuditRecordAppended.v1` | Audit | anchor svc | no | none |

**Registry rule (CI):** any cross-zone event schema with an identity/PII field is **rejected**
(DD-1, `../phase2/07 §4`).

## 4. Database schema (excerpt) & migration discipline

See `../phase2/12 §3` for `report`, `custody_event`, `field_policy` DDL. **Rules:** every column
needs a `field_policy` row (CI); `report` has **no identity column** (CI); `custody_event` and
`audit_record` are **append-only** (no UPDATE/DELETE grants). Migrations are versioned, reviewed,
and forward-only where possible.

## 5. IAM policy (ABAC — excerpt, policy-as-code)

```rego
package njtip.authz
default allow = false
allow {                                   # matter-scoped, purpose-bound, zone-aware
  input.principal.zone == input.resource.zone
  some g; g := input.principal.grants[_]
  g.scope == input.action
  g.matter == input.resource.matter
  time.now_ns() < g.expiry_ns             # JIT, no standing privilege
  not sensitive_needs_dual(input.action, g)   # dual-control check for sensitive
}
```

## 6. Error catalogue (representative)

| Code | HTTP | Meaning | Notes |
|------|------|---------|-------|
| `NJ-VALIDATION` | 400 | Schema/constraint failure | no sensitive echo |
| `NJ-UNAUTHENTICATED` | 401 | No/invalid session | uniform |
| `NJ-FORBIDDEN` | 403 | ABAC deny | fail-closed default |
| `NJ-NOT-FOUND` | 404 | Unknown case_code/resource | **uniform** (no enumeration oracle) |
| `NJ-RATE-LIMITED` | 429 | Anti-abuse | anonymity-preserving |
| `NJ-INTEGRITY` | 409 | Evidence hash mismatch | raises alert (T-5) |
| `NJ-POLICY-CLOSED` | 503 | Policy engine unavailable | fail-closed |

## 7. Versioning strategy

- **SemVer** for APIs and event schemas; **major** = breaking; **minor** = additive only.
- Backward-compatible within a major; consumer-driven contract tests; deprecation with dual-run +
  published sunset (`../phase2/07 §3`).

## 8. Quality gate

- **Traces to:** `../phase2/07`, `../design/03`, `02`; DD-1, T-4/T-5, S-4.
- **Preserves:** PII-free events, no-identity schema, fail-closed authz, zone isolation.
- **Residual risks:** contracts are representative; full set generated per context; schema drift
  (mitigated: contract tests).
- **Trade-offs:** ⚠️ strict schemas (additionalProperties:false, uniform 404) reduce flexibility —
  bought for anonymity/security.
- **Acceptance criteria:** contracts validate; contract tests green; registry rejects PII cross-zone;
  error responses leak nothing sensitive.
- **🔒 Required review:** ARB (contracts), privacy (schemas/events), ISRB (authz policy).

*Next: `04-engineering-standards.md`.*
