# Phase 2 · 12 — Representative Implementation Artifacts

**Implements:** the implementation-artifacts mandate · **Inputs:** Design `../design/*`, Domain
`../06`, Work items `11`.

> **Representative, engineering-ready samples** for the MVP slice — enough to seed the repo and
> anchor conventions. They are **not** the exhaustive set: the full per-context OpenAPI, schemas,
> IaC, and runbooks are generated during engineering, each behind the Readiness Gate (`05`) and,
> for 🔒 subsystems, expert review. Every sample below embodies the invariants (no identity, zone
> isolation, minimization, audit).

---

## 1. OpenAPI (excerpt) — Confidential Reporting intake & status

> Note: intake is served on the **metadata-resistant endpoint** (DDR-11), not the public gateway;
> this contract documents shape only. **No identity fields exist.** 🔒

```yaml
openapi: 3.1.0
info: { title: NJTIP Confidential Reporting API, version: 0.1.0 }
paths:
  /reports:
    post:
      summary: Submit an anonymous report (client-encrypted)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [content_cipher, content_key_ref, category, client_integrity_hash]
              properties:
                content_cipher: { type: string, description: client-side E2E ciphertext }
                content_key_ref: { type: string }
                category: { type: string, enum: [police, courts, prosecution, prison, official, regulatory, other] }
                evidence_refs: { type: array, items: { type: string } }
                client_integrity_hash: { type: string }
              # NO reporter identity, NO IP, NO device id — by design (D-02, ID-1)
      responses:
        "201":
          description: Accepted
          content:
            application/json:
              schema:
                type: object
                properties:
                  case_code: { type: string, description: high-entropy, client-verifiable, server-unlinkable to identity }
  /reports/{case_code}/status:
    get:
      summary: Retrieve status by case code (no identifier required)
      parameters: [{ name: case_code, in: path, required: true, schema: { type: string } }]
      responses:
        "200": { description: Status + follow-up thread refs }
        "404": { description: Unknown code (uniform response; no enumeration oracle) }
components:
  securitySchemes:
    anonymousCaseCode: { type: apiKey, in: header, name: X-Case-Code }
```

## 2. Event schema (excerpt) — `ReportRouted` (PII-free, cross-zone)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ReportRouted",
  "type": "object",
  "required": ["specversion","type","source","id","time","data"],
  "properties": {
    "specversion": {"const": "1.0"},
    "type": {"const": "njtip.reporting.ReportRouted.v1"},
    "source": {"const": "zone:independent/reporting"},
    "id": {"type": "string"},
    "time": {"type": "string", "format": "date-time"},
    "data": {
      "type": "object",
      "required": ["case_code","recipient_id","coi_status"],
      "properties": {
        "case_code": {"type": "string"},
        "recipient_id": {"type": "string"},
        "coi_status": {"type": "string", "enum": ["clear","recused-rerouted"]}
      },
      "additionalProperties": false
    }
  }
}
```
> Registry rule (`07 §4`): a cross-zone event schema containing any identity/PII field is
> **rejected at registration** (machine-checked) — enforcing DD-1 and the zone boundary.

## 3. Database migration (excerpt) — report, custody, field_policy

```sql
-- Zone: independent. NO reporter-identity columns exist by design (D-02, DDR-05).
CREATE TABLE report (
  case_code            TEXT PRIMARY KEY,           -- high-entropy, client-generated
  category             TEXT NOT NULL,
  created_at_coarse    TIMESTAMPTZ NOT NULL,        -- coarsened (anti-correlation)
  content_cipher       BYTEA NOT NULL,              -- client E2E ciphertext
  content_key_ref      TEXT NOT NULL,               -- envelope key ref (HSM/KMS)
  status               TEXT NOT NULL DEFAULT 'received'
);

-- Append-only custody ledger (DDR-06). No UPDATE/DELETE grants.
CREATE TABLE custody_event (
  event_id     BIGSERIAL PRIMARY KEY,
  object_hash  TEXT NOT NULL,
  actor_ref    TEXT NOT NULL,
  role         TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  ts_trusted   TIMESTAMPTZ NOT NULL,
  prev_hash    TEXT NOT NULL
);

-- Every column must have a governing policy row (CI-enforced, DDR-05).
CREATE TABLE field_policy (
  table_name    TEXT NOT NULL,
  column_name   TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  legal_basis   TEXT NOT NULL,
  sensitivity   TEXT NOT NULL,
  zone          TEXT NOT NULL,
  encryption    TEXT NOT NULL,
  retention     TEXT NOT NULL,
  deletion      TEXT NOT NULL,
  PRIMARY KEY (table_name, column_name)
);
-- CI check: every (table,column) in information_schema has a field_policy row, else build fails.
```

## 4. Infrastructure as Code (excerpt) — zone isolation + KMS

```hcl
# Each zone is an isolated network + own KMS. No cross-zone DB routes (DDR-04).
module "zone" {
  for_each = toset(["independent", "executive", "judiciary"])
  source   = "./modules/zone"
  name     = each.key
  # separate VPC/subnets, separate admin IAM root, separate backups
}

resource "kms_key" "zone_kek" {
  for_each             = module.zone
  description          = "KEK for ${each.key} zone (HSM-backed)"
  hsm_backed           = true
  rotation_enabled     = true
  # threshold policy for de-anon-capable operations attached out-of-band (DDR-10) 🔒
}

# Network policy: deny cross-zone DB egress (constitutional invariant, tested in CI EP1-S2)
resource "network_policy" "no_cross_zone_db" {
  for_each = module.zone
  default  = "deny"
  rule { from = module.zone[each.key].app; to = module.zone[each.key].db; action = "allow" }
  # no rule permits app-in-zone-X -> db-in-zone-Y
}
```

## 5. CI/CD gate (excerpt) — security + constitutional invariant

```yaml
# .ci/pipeline.yml (excerpt) — see design/07
stages: [test, security, policy, invariant, review, deploy]
security:
  script: [ "run sast", "scan secrets", "sbom-diff --fail-on-new-unpinned", "verify-provenance" ]
policy:
  script: [ "conftest test ./infra ./policy" ]     # zone isolation, no-secret, controls present
invariant:
  script:
    - "assert-no-cross-zone-db-path"               # EP1-S2 / SR-005
    - "assert-every-column-has-field-policy"       # PR-001
    - "assert-no-identity-column-in-report"        # FR-001
review:
  rules:
    - if: '$CHANGED_PATHS matches CRITICAL_PATHS'   # anonymity/crypto/custody/metadata/ai
      require: [ "ISRB_signoff_token" ]             # 🔒 human expert gate; blocks auto-merge
deploy:
  rules:
    - if: '$ORG_GATE != "GREEN"'                    # Operational Readiness Gate (05)
      when: never                                   # prod deploy blocked until gate GREEN
```

## 6. Operational runbook (excerpt) — suspected reporter de-anonymization (top severity)

```
RUNBOOK: RB-SEC-01  Suspected reporter de-anonymization  (Sev-1)
Owner: SecOps on-call → Incident Review Board
1. CONTAIN: isolate affected component; freeze relevant privileged access (JIT revoke).
2. PRESERVE: snapshot audit chain segment; do NOT alter; verify anchor.
3. ASSESS REACH: what could have leaked? (metadata? content? routing?) — assume worst case.
4. THRESHOLD CHECK: confirm no de-anon-capable op executed without M-of-N (DDR-10).
5. NOTIFY: via safe channel, the affected class (never via an identifying channel).
6. GOVERNANCE: convene IRB; inform Oversight Board; consider warrant-canary implications.
7. LEGAL: engage counsel (compelled-access? breach-notification duties? NC-2).
8. POST-MORTEM: root cause; corrective actions tracked to closure; Trust Index updated.
NEVER: attempt to "look up who the reporter is" to assess impact — identity is not held (D-02).
```

## 7. Test plan (excerpt) — acceptance tests for critical requirements

| Test ID | Requirement | Type | Given/When/Then | Pass |
|---------|-------------|------|-----------------|------|
| T-FR003 | Metadata-resistant intake | Security | Given a submitted report, When inspecting server/network logs, Then no client IP is retained anywhere | 0 IP records |
| T-SR005 | Zone isolation | Invariant/CI | Given the deployed topology, When scanning DB routes, Then no app in zone X can reach a DB in zone Y | 0 cross-zone paths |
| T-SR001 | Threshold custody | Security | Given a de-anon-capable op, When fewer than M custodians approve, Then the op cannot complete | blocked < M |
| T-FR001 | No identity collected | Data/CI | Given the report schema, When checked, Then no C0 identity column exists | 0 identity cols |
| T-FR008 | Chain of custody | Forensic | Given an evidence object, When tampered, Then integrity check fails and alerts | tamper detected |
| T-FR004 | Honest risk UX | Usability | Given target users, When shown the risk notice, Then comprehension ≥ published bar | ≥ bar |

## 8. Quality gate

- **Traces to:** RTM `04`; DDR-05/06/10/11/13/15; D-02/D-05/D-06.
- **Threats mitigated (by these artifacts):** ID-1/I-1 (no-identity schema), I-2/DT-1 (intake +
  test T-FR003), I-6/E-3 (zone IaC + CI), T-1/T-2 (custody), T-3 (supply-chain CI).
- **Residual risks:** samples are representative, not exhaustive; real endpoints need full
  threat-review; effort/coverage grows in engineering.
- **Trade-offs:** ⚠️ fail-closed CI gates can block delivery on policy errors — accepted.
- **Success criteria:** samples compile/lint in the engineering repo; CI gates enforce the three
  invariants shown; runbook drilled (G7).
- **🔒 Required review:** security + crypto (intake, KMS, threshold), privacy (schema, events),
  forensics (custody), SRE (IaC/CI) — before any of these run against real data.

---

## ⛔ OPERATIONAL READINESS GATE — Phase 2 stop

Phase 2 is complete: **governance-as-a-system (`01`–`03`), full traceability (`04`), the readiness
gate (`05`), the phased roadmap (`06`), interoperability (`07`), chain-of-custody procedures
(`08`), Public Trust Index (`09`), Justice Analytics (`10`), MVP work items (`11`), and
representative artifacts (`12`).**

Per the brief, **no implementation work may proceed until the Operational Readiness Gate (`05`)
is satisfied.** Development against **synthetic data** may begin now (Phase 0/1 build); **production
go-live is blocked** until G1–G10 are GREEN with Oversight Board sign-off.

**Requested of you:**
1. **Approve Phase 2** as the governance & implementation basis, or **flag changes** (name the
   section).
2. Choose the next action: **(a)** begin **Phase 0/1 build** on synthetic data (I can generate the
   full per-context specs, complete OpenAPI/schemas, and IaC/CI-CD for the security foundation);
   **(b)** deepen **governance** (charters, RACI, policy catalog) toward satisfying the gate; or
   **(c)** expand the **work-item backlog** into a full sprint/milestone plan with estimates.

*🔒 subsystems remain human-expert-review-required regardless of approval.*
