# Testing Guide

```bash
npm run motse:test        # all 12 suites / 126 tests (~3 s, no external services)
npm test                  # Tirelo suites (unchanged, 131 tests)
npx jest --config motse/jest.config.js --coverage \
  --collectCoverageFrom='src/payments/**' --collectCoverageFrom='src/admin/**/*.js' \
  --collectCoverageFrom='src/notifications/**' --collectCoverageFrom='src/monitoring/**' \
  --collectCoverageFrom='src/security/**' --collectCoverageFrom='src/search/**' \
  --collectCoverageFrom='src/ai/**' --rootDir=motse
```

Phase-1 coverage on new components: **91.7% statements / 95.1% lines** (target ≥90%).

## Suites

| Suite | What it proves |
| --- | --- |
| `ledger` | zero-sum property tests, idempotent replay, exact splits, reconciliation with malformed/duplicated provider files, payout lifecycle |
| `identity-governance` | level accrual, device binding, refresh rotation, Ring-3 freezes, elections, audit chain tamper detection + inclusion proofs |
| `heritage` | consent gates, restricted fail-closed (search/packs/exports/URLs), deletion contract with clock advance |
| `kgetsi` / `loeto-puo` | escrow invariants, dual approval, medical rules, dispute freezes, atomic splits, correction payouts, trust quorum |
| `sync-parity` | 7-day outbox replay exactly-once, per-aggregate ordering, reconciliation cards, USSD/SMS/app parity |
| `api` | gateway conventions: idempotency, problem details, pagination, field masks, device binding |
| `payments` | full lifecycle × 3 providers, webhook forgery/replay/duplicate/amount defences, secret rotation, retry/dead-letter, reconciliation variance, fraud hooks, refund matrix |
| `admin-api` | authorization boundary, dashboard, identity admin (suspend kills tokens), governance over HTTP, read-only ledger explorer, audited restricted view, audit exports, secret rotation |
| `notifications` | event-driven delivery, preferences, quiet hours, civic-emergency exemption, failing transports, Sev-1 paging |
| `monitoring-security` | metrics + histograms, trace-id logs, stuck escrows, readiness degradation, rate limiting, device trust blocking payouts, security headers, denial auditing |
| `search-ai` | fail-closed indexing (restrict/withdraw drop items), inherited lesson restrictions, member-scoped circles, AI safety gate (no-training flag, restricted refs), capability registry |

## Conventions

- Deterministic time: everything uses the injectable `Clock`; tests advance it for
  backoff, TTLs, quiet hours, deletion deadlines, token expiry.
- Sandbox providers simulate the operator, including signed webhooks
  (`provider.sandboxResolve(ref, outcome)`), statements and fault injection
  (`provider.faults.*`).
- `tests/helpers.js` builds the standard world (ward, headman, L1/L2 members,
  funded wallets, provider clearing) — use it instead of hand-rolling fixtures.
- Money tests must end with `trialBalance().balanced === true`.
