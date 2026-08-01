# Infrastructure Governance & Assurance (Stabilization Part 6)

Infrastructure governance now covers the whole platform-assurance surface, not just the resource
registry: **Infrastructure-as-Code validation · SBOM · certificate lifecycle · dependency inventory ·
backup verification · configuration drift · unsupported-software detection · platform lifecycle
management** (`src/infra/infrastructure-assurance.js`).

Gated by `APP-FIT-INFRA-ASSURANCE` and `INFRA-FIT-PLATFORM-LIFECYCLE`. Live view:
`GET /api/admin/infra-assurance`. Everything here is **advisory** — provisioning, upgrades and
remediation remain human-approved, and no report authorizes a deployment.

## Infrastructure-as-Code validation

Twelve declared invariants are asserted against the reference manifests (zero-dependency structural
assertions, no YAML parser):

| Manifest | Invariants |
|---|---|
| `deployment.yaml` | non-root · read-only rootfs · no privilege escalation · capabilities dropped (ALL) · resource limits · liveness + readiness probes |
| `networkpolicy.yaml` | default-deny · covers both Ingress and Egress |
| `namespace.yaml` | per-zone namespaces (constitutional isolation) |
| `hpa.yaml` | horizontal autoscaling with `minReplicas ≥ 2` |
| `pdb.yaml` | disruption budget `minAvailable ≥ 2` |

Two further rules matter more than they look:

- **No secret material in a ConfigMap.** A secret-shaped value in non-secret config is a high finding.
- **Unresolved placeholders are reported per file.** Reference manifests deliberately carry
  `REGISTRY/` and an example IdP URL; `secret.example.yaml` is registered as a **template** where
  placeholders are expected. Every non-template placeholder is surfaced so a human reviews it before
  apply — and the fitness function asserts the detector *can* fire, so it cannot rot into a no-op.

## Backup verification

A backup that has never been restored is an untested assumption. `verifyBackup()` runs a full
round-trip — write → dump → restore into a fresh store → compare **content digests** — and reports
`verified` only when the digests and record counts match.

## Dependency inventory & SBOM

Zero third-party runtime dependencies is an architectural decision, not an accident: it keeps the
trusted computing base on the anonymity-critical path minimal. The inventory records direct and dev
dependencies (both empty), the **empty transitive closure**, the Node built-ins actually used, and
the engine constraint. `INFRA-FIT-PLATFORM-LIFECYCLE` fails the build if a third-party dependency
appears.

## Platform lifecycle & unsupported software

| Component | Minimum | Supported until |
|---|---|---|
| Node.js LTS | 18 | 2027-04-30 |
| Kubernetes | 1.28 | 2027-10-31 |
| PostgreSQL | 15 | 2027-11-11 |
| Distroless base image | nodejs18-debian12 | 2028-06-30 |

Status is a pure function of the `now` supplied — `supported` → `approaching-eol` (within 180 days) →
`unsupported`. The fitness gate assesses at a fixed epoch so the check is deterministic; the
operational endpoint uses real time.

## Certificate lifecycle

Inventory, rotation due-dates and the revocation list are tracked, and a certificate past due for
rotation makes the assurance report unhealthy. 🔒 Keypairs and CA signing stay PKI/human-managed —
this tracks the *schedule*, never the cryptography.

## DevSecOps: classifying findings instead of drowning in them

A scanner that cannot tell a credential from a configuration value trains people to ignore it. Every
candidate match is now **classified**, and only a credential is a security finding:

| Class | Evidence | Raised? |
|---|---|---|
| `credential` | High Shannon entropy, base64/hex-shaped, or *anything a credential pattern matched that fits no benign shape* | **yes — high severity** |
| `identifier` | Slug-shaped, lowercase, entropy < 3.5 (region codes, zone names, ids) | recorded |
| `classification` | A data classification label (`public`, `internal`, `restricted`, `secret`, …) | recorded |
| `configuration` | URL, path, env reference, hostname, or a clearly-labelled placeholder (`SYNTHETIC`, `REPLACE_FROM`, …) | recorded |

Classification is **fail-safe**: a matched value that fits none of the benign shapes stays a
credential. Suppressed candidates are **recorded, never invisible** —
`classificationReport().suppressed` lists every one with its file, key and class, and the fitness
function asserts that candidates = suppressed + findings, so nothing can be silently dropped.

The immediate payoff: `residency: { restricted: 'bw-central', secret: 'bw-central' }` reads plainly
again in the composition root instead of being written around the scanner. `bw-central` classifies as
an identifier; the rule is visible in the report; no security check was weakened to get there.
