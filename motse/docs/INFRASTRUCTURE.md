# Infrastructure Architecture (Phase 2, WS3)

Everything lives under `deploy/motse/`:

```
deploy/motse/
├── Dockerfile                 production image (multi-stage, non-root, HEALTHCHECK)
├── k8s/                       raw manifests (deployment+service+HPA+PDB, platform.yaml)
├── helm/motse/                chart + values-{dev,staging,prod}.yaml
├── terraform/                 GCP: GKE Autopilot, Cloud SQL (ledger), Memorystore,
│                              Artifact Registry, Secret Manager, KMS, GCS buckets
└── observability/             Grafana dashboard generator + 10 dashboards + alerts
```

## Environments (doc §16)

| | dev | staging | prod |
| --- | --- | --- | --- |
| Data | synthetic | **synthetic only — cultural content never leaves prod** | real |
| Replicas | 1, no HPA | 2, HPA→6 | 3, HPA→20 (20× civic-alert peak, §15.2) |
| Cron jobs | drain only | all | all |
| Deploys | on merge | on merge behind flags | canary 5%→50%→100%, auto-rollback on SLO burn |

## Deployment pipeline

1. CI (`.github/workflows/motse-ci.yml`): tests → coverage gates (95/95/90) →
   dependency scan (fails on high/critical) → Docker build + boot smoke test.
2. Image pushed to Artifact Registry, tag pinned (never `:latest`).
3. `helm upgrade motse deploy/motse/helm/motse -f values-<env>.yaml --set image.tag=<sha>`
   — rolling update with `maxUnavailable: 0`; readiness probe `/health/ready`
   blocks promotion (it reflects ledger balance, provider registration, and
   dead-letter state).
4. Secrets: `motse-secrets` is materialised from GCP Secret Manager by the
   pipeline (`MOTSE_SECRET`, bootstrap token, provider keys). Nothing sensitive
   is in the chart, the manifests, or Terraform state (secret *containers* only).

## Provisioning

```bash
cd deploy/motse/terraform
terraform init -backend-config=env/<env>-backend.hcl
terraform apply -var-file=environments/<env>.tfvars
```

Key resources and why:
- **Cloud SQL Postgres + PITR** — the Ledger system of record (RPO ≤ 5 min, §16).
- **Two media buckets** — general, and restricted with CMEK (90-day key rotation)
  + `public_access_prevention: enforced`; the §6.4 isolation is infrastructural,
  not just code.
- **Backups bucket** with a 90-day lifecycle aligned to the purge contract.
- **Memorystore** — rate limits, sessions, USSD hot paths (§15.1).

## Verification status in this repository

The Dockerfile, manifests, chart and Terraform are code-reviewed and
YAML/HCL-sane, but this authoring environment has **no Docker daemon, helm, or
terraform binaries**, so they have not been applied here. The CI workflow runs
the Docker build + boot smoke on every push; run `helm template` and
`terraform validate` as the first adoption step.

## Scheduled jobs (k8s CronJobs / Helm-managed)

| Job | Schedule | Endpoint |
| --- | --- | --- |
| Payment retry drain | every minute | `POST /v1/admin/finance/retries/drain` |
| Provider reconciliation | 02:15 nightly | `POST /v1/admin/finance/reconcile` ×3 providers |
| Deletion sweep (14/90-day contract) | 03:00 daily | `POST /v1/admin/heritage/deletion-sweep` |
| Backups | 6-hourly | `POST /v1/admin/ops/backups` |
| Credential rotation check | weekly | `POST /v1/admin/security/rotation/run` |
