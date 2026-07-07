# Operations Manual & Runbooks (Phase 2, WS10)

The operator's surface is the admin portal (`/admin` → Ops/Security/Analytics
tabs) or the same endpoints via curl. Everything below is audited.

## Monitoring (WS4)

- Scrape `/metrics`; import `deploy/motse/observability/dashboards/*.json`
  (System, Payments, Ledger, Escrow, Governance, Search, Notifications,
  Offline Sync, Authentication, USSD — regenerate with
  `node deploy/motse/observability/generate-dashboards.js`).
- Load `deploy/motse/observability/prometheus-alerts.yaml`. The two
  non-negotiable pages: `LedgerImbalance` and `ReconciliationVariance` (Sev-1).
- `/health/ready` is the canary gate; `GET /v1/admin/ops/health-report` is the
  human-readable roll-up.

## Runbooks

### Sev-1: reconciliation variance (auto-opens an incident)
1. Portal → Ops → the incident is already open. Acknowledge it.
2. Ledger tab → Reconciliation runs → inspect unmatched lines.
3. Missing-from-statement: `POST /v1/admin/finance/payments/{id}/verify` to
   poll the operator. Unknown statement lines: contact the operator; **never
   hand-edit the ledger** — post a correcting entry through a service if the
   operator confirms.
4. Resolve the incident with the finding. Postmortem within 5 working days (§16).

### Sev-1: trial balance nonzero
This should be impossible (double-entry is enforced at commit). Treat as data
corruption: enable maintenance mode, snapshot immediately
(`POST /v1/admin/ops/backups`), page engineering, restore-drill on a fresh
instance to isolate, compare `balance_mismatches`.

### Maintenance window
1. Ops tab → Start maintenance (or `POST /v1/admin/ops/maintenance {on:true,message}`).
   Member mutations 503 (`MAINTENANCE`, retryable — offline clients just queue);
   reads, operator webhooks and the admin surface stay up.
2. Do the work. 3. End maintenance. Queued client outboxes drain automatically.

### Backup & restore drill (quarterly, calendared — §16)
1. `POST /v1/admin/ops/backups {note:"drill"}` → note the manifest checksum.
2. `POST /v1/admin/ops/backups/{id}/verify` → must be `valid:true`.
3. On a staging instance, run the restore (`backups.restore(id, platform)` — the
   `ops.test.js` DR suite is exactly this drill, automated): success requires
   trial balance re-derived from postings to match, zero balance mismatches,
   and every audit chain verifying.
4. File the drill record with the two checksums.

### Security hold on a member (ATO / impossible travel)
1. Security report shows `active_holds`; the member cannot receive payouts.
2. Verify with the member out-of-band (their kgotla can attest identity).
3. `POST /v1/admin/security/holds/{userRef}/release` (audited) — or let the
   24h hold lapse.

### Credential rotation
Automated weekly by policy (90 days per webhook secret). Manual:
`POST /v1/admin/security/rotation/run`. The PREVIOUS version stays
verify-valid for exactly one rotation — share the new secret with the operator
before rotating twice.

### Capacity review (every 5× growth step, §15.2)
`GET /v1/admin/ops/capacity` — when `users_vs_year1_pct` crosses each 5× step,
schedule the architecture review; extraction candidates are pre-identified
(heritage feed fan-out, Puo threads).

## Performance & load

```bash
npm run motse:bench            # in-process hot paths + trial-balance assertion
npm run motse:start &
npm run motse:load -- http://127.0.0.1:4100 30 50   # 30s, 50 workers
```

The load mix mirrors production (reads + USSD). Failure budget: >1% 5xx exits
nonzero. Chaos option: set provider faults (`provider.faults.*`) mid-run to
watch the retry queue and dead-letter behaviour under fire.

## Pilot operations (WS7)

See [PILOTS.md](PILOTS.md) for the full rollout guide. Daily ops: Pilots tab →
per-pilot Health (residents by level, letsema activity) and Report
(stage history + PII-free usage).
