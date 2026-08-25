# Cross-Domain Correlation Governance (Stabilization Part 13)

Correlating signals across domains is exactly how a privacy-preserving system stops being one. So
cross-domain intelligence is **governed, not merely available**: correlation is **default-deny**, and
each permitted correlation is a complete governance record naming its purpose, retention, overseer
and accountable authority (`src/intelligence/correlation-governance.js`).

Gated by `APP-FIT-CORRELATION-GOVERNANCE`. Live: `GET /api/intelligence/correlation-governance` ·
`POST /api/intelligence/correlations`.

## Permitted correlations

| Correlation | Domains | Purpose | Retention | Oversight | Accountable |
|---|---|---|---|---|---|
| `platform-reliability` | engineering + operations | Explain reliability incidents in terms of engineering health | 1 yr | ORB | Office of the CTO |
| `security-operations` | security + operations | Correlate security posture with operational degradation | 1 yr | ISRB | National CIRT |
| `assurance-compliance` | engineering + compliance | Trace compliance coverage to the controls that produce it | 5 yr | ARB | Office of the Chief Architect |
| `governance-effectiveness` | governance + compliance | Assess whether human governance keeps pace with platform change | 5 yr | OB | Oversight Board Secretariat |
| `legislative-traceability` | legislation + compliance | Trace legal mandates to the controls implementing them | 10 yr | OB | Attorney General Chambers |
| `continuity-posture` | resilience + infrastructure | Assess recoverability against the state of the estate | 1 yr | ORB | National Disaster Management Office |
| `service-quality` | service-delivery + operations | Explain service outcomes in terms of operational performance | 2 yr | SDB | Ministry of Public Administration |
| `privacy-assurance` | privacy + engineering | Verify privacy controls are implemented and holding | 5 yr | OB | Data Protection Commissioner |

## Prohibited correlations

Named explicitly, with the reason recorded. A prohibition that exists only as an omission is one
feature request away from gone.

| Prohibited | Domains | Why |
|---|---|---|
| `reporter-linkage` | privacy + service-delivery | Joining reporter-facing signals with service records is the shortest path to re-identifying an anonymous reporter. The anonymity boundary is a constitutional invariant. |
| `case-content-demographics` | service-delivery + legislation | Correlating case content with demographic or legal-status attributes enables profiling of communities; no permitted purpose requires it. |
| `staff-performance-profiling` | governance + operations | Correlating individual actor activity with governance outcomes turns operational telemetry into staff surveillance. Aggregate process mining already answers the legitimate question. |
| `security-to-privilege` | security + governance | Threat intelligence may only **lower** trust. Correlating it into a governance signal risks it becoming a privilege source. |

## How the control works

```
authorize({ domains, purpose, requestedBy })
  prohibited pair            → refused, by name, with the reason      (failClosed)
  unregistered pair          → refused — default-deny                  (failClosed)
  no purpose / no requester  → refused                                 (failClosed)
  purpose ≠ registered purpose → refused — purpose limitation          (failClosed)
  otherwise → authorization with oversight, accountable authority and expiresAt

guard(authorizationId, { purpose })   ← enforced at USE time, where purpose creep happens
  wrong purpose → refused    ·    past retention → refused    ·    otherwise permitted (and counted)
```

**Refusals are audited too.** An attempt to run a prohibited correlation is itself
governance-relevant information, and it appears in the trail alongside the authorizations.

## Accountability, oversight and auditability

Every authorization carries the overseeing board and the accountable authority from the
[ownership model](./governance-ownership.md), so a correlation always has a name attached to it.
Retention is bound at authorization and enforced at use; `retentionDue()` lists correlations whose
window has elapsed. The register itself is validated on every build: a permitted correlation without
a purpose, a retention period, an overseer or an accountable authority fails the gate, as does any
pair that appears in both the permitted and prohibited registers.
