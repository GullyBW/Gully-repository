# National Rollout Guide (Phase 3, WS13)

## Multi-region & high availability

- Primary region `europe-west1`; enable a warm secondary with
  `terraform apply -var enable_secondary_region=true` (see `terraform/multiregion.tf`):
  standby GKE Autopilot cluster, a **failover-target Cloud SQL read replica** of the
  Ledger (PITR + cross-region, RPO ≤ 5 min preserved), a global load balancer, and a
  dual-region CMEK bucket for restricted media durability.
- The base cluster already runs 3+ replicas with a PodDisruptionBudget and HPA to 20×
  (civic-alert peak, doc §15.2), so single-node and zonal failures are absorbed
  automatically.

## Zero-downtime upgrades

- **Rolling** (default): `maxUnavailable: 0, maxSurge: 1`, readiness-gated on
  `/health/ready` (which reflects ledger balance, provider registration, dead letters).
- **Blue/Green**: deploy `motse-green` alongside `motse-blue` with
  `-f values-prod-green.yaml`; verify on `green.api.motse.bw`; promote by swapping the
  ingress host; rollback = point the host back at blue (still running).
- **Canary**: stage weights 5% → 50% → 100% with automated rollback on SLO burn
  (error-budget / p95 alerts from `observability/prometheus-alerts.yaml`).

## Feature rollout by ward & regional configuration

- Modules light up per-ward and per-morafe via the flag service; a pilot's `flag_profile`
  applies automatically on ward/morafe enrollment (see [PILOTS.md](PILOTS.md)). Rollback
  unwinds every override and pauses the pilot without touching community data.
- Regional/remote configuration is remote-config flags (`config.*` JSON values), tunable
  live per scope.

## Localization (WS13)

Setswana-first with English fallback and per-morafe language packs
(`src/i18n/i18n.js`). The notification service renders civic messages in the recipient's
declared language (`titleKey` + params); literal-title callers are unaffected. Add a pack
at runtime with `i18n.addPack(locale, messages)`.

## Disaster recovery & backups

Quarterly restore drills are automated: `scripts/resilience-test.js` runs a failover
restore into a fresh platform and asserts the trial balance re-derives from postings and
every audit chain re-verifies. Backups are 6-hourly, checksummed, and verifiable
(`POST /v1/admin/ops/backups/{id}/verify`). Full runbook in [OPERATIONS.md](OPERATIONS.md).

## Go-live checklist

1. `terraform apply` per region; secrets materialised from Secret Manager.
2. Set `MOTSE_SECRET`, `MOTSE_ADMIN_BOOTSTRAP_TOKEN`, provider + PayPal keys, AI keys.
3. `helm upgrade` prod; confirm `/health/ready` and the ops center are green.
4. Bootstrap the first admin; create the pilot; enroll a ward with its headman office.
5. Schedule the cron jobs (retry drain, reconcile, deletion sweep, backup, rotation).
6. Import Grafana dashboards + alert rules; verify the two Sev-1 pages fire in staging.
7. Run `npm run motse:resilience`, `motse:ai-eval`, `motse:security-scan`,
   `motse:secret-scan` as release gates.
