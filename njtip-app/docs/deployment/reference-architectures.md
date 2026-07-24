# Deployment Reference Architectures (Part 8)

Evaluated options and reference designs. **No production deployment occurs until the readiness gates
pass (a human Oversight Board decision).** All designs preserve the three-zone Constitutional
Architecture and operator-in-threat-model.

## Option evaluation
| Model | Residency / sovereignty | Compelled-access resistance | Ops maturity | Resilience | Fit |
|-------|-------------------------|-----------------------------|--------------|-----------|-----|
| **Air-gapped** | ●●● | ●●● (no external reach) | ○ | ◐ | High-sensitivity zones (judiciary/evidence); reference twin/eval |
| **Government data centre** | ●●● | ◐ (domestic legal process) | ◐ | ◐ | Judiciary + PII-bearing zones (residency) |
| **Hybrid cloud (RECOMMENDED)** | ●●● (sensitive in-country) | ●● (threshold split across jurisdictions) | ●● | ●●● | Blueprint D-03/DDR-02 |
| **Public cloud only** | ○ | ◐ | ●●● | ●●● | DR + public transparency (ciphertext/aggregate only) |

**Recommendation:** hybrid — judiciary/PII/evidence + threshold key shares in-country (gov DC /
air-gapped enclave); ciphertext-only DR + public aggregates offshore; per-zone isolation throughout.

## Reference design (hybrid, containerized)
```
[ Citizens / Officials ] → WAF/DDoS (public surfaces only; NOT the intake path)
        │                         └─ intake: metadata-resistant enclave (onion/isolated)
        ▼
[ API Gateway + IdP (OIDC/FIDO2, ABAC) ]
        ▼   (per-zone network isolation; no cross-zone DB route)
┌─ Independent zone ─┐ ┌─ Executive zone ─┐ ┌─ Judiciary zone ─┐
│ reporting,gov,audit│ │ investigation,pros│ │ adjudication,arch │
│ + threshold custody│ │                   │ │  (in-country)     │
└─────────┬──────────┘ └─────────┬─────────┘ └─────────┬─────────┘
   per-zone DB/KMS(HSM)    per-zone DB/KMS       per-zone DB/KMS
        └──── event backbone (PII-free) · anchored audit · observability (privacy-budgeted) ────┘
```

## Containers & Kubernetes
- Immutable images; minimal base; non-root; read-only rootfs; the **anonymity-critical intake** on
  dedicated nodes / confidential-computing, tiny dependency surface.
- **Namespaces per zone** with NetworkPolicies enforcing **no cross-zone DB routes** (mirrors
  `FIT-ZONE-ISOLATION`); PodSecurity restricted; secrets from a manager (never in images); mTLS
  (service mesh optional). Policy-as-code admission (OPA/Gatekeeper) enforces the invariants at deploy.

## High availability, DR, backup
- HA: multi-replica stateless services; intake **degrades to minimal** (never loses accepted data).
- DR: per-zone, tested **RTO/RPO**; **ciphertext-only** offshore copies; **keys never co-located** with
  ciphertext. Backups integrity-checked (mirrors `FIT-BACKUP`, SIM-30/35). Regular restore drills.

## Observability
Privacy-budgeted metrics/logs/traces (no PII/IP/content); intake path emits **aggregate health only**;
tamper-evident anchored audit; SIEM. (Blueprint phase7/07.)

## Air-gapped variant
The Twin and reference eval run fully offline (zero deps). Production air-gapped zones use one-way
transfer for aggregate transparency exports and signed evidence; no inbound external connectivity.
