# Administration Portal Guide

Open `/admin` on the Motse core service. The portal is a self-contained page (no
external assets, satisfies the strict CSP) that drives the `/v1/admin` API.

## Getting access

1. **Bootstrap the first admin** (deploy-time, once):
   ```bash
   curl -X POST $HOST/v1/admin/bootstrap \
     -H 'X-Bootstrap-Token: <MOTSE_ADMIN_BOOTSTRAP_TOKEN>' \
     -H 'Idempotency-Key: bootstrap-1' -H 'Content-Type: application/json' \
     -d '{"msisdn":"+267..."}'
   ```
   In non-production the token defaults to `dev-bootstrap-token`. In production the
   endpoint is disabled unless `MOTSE_ADMIN_BOOTSTRAP_TOKEN` is set.
2. Sign in at `/admin` with that phone number (OTP; sandbox shows the code inline).
3. Further admins: Identity tab → user detail → grant role `platform_admin` /
   scope `platform`, or "Verify institution" for L3.

Admin sessions use the same short-lived, device-bound tokens as everyone else;
suspending a user (or revoking sessions) kills their tokens immediately.

## Modules

- **Dashboard** — active users by level, pending approvals (milestones, flagged
  heritage, fraud reviews, failed payouts), escrow totals + stuck/frozen counts,
  daily transactions + trial balance, governance events, election activity,
  heritage statistics, API health, system alerts.
- **Identity** — search users; view verification history (the hash-chained audit
  trail), devices, sessions, roles; set level L0–L3 (reason required, audited);
  suspend/reinstate; revoke sessions; verify institutions; OTP audit (hashes only).
- **Governance** — create councils; grant seats (bogosi/association/elected) which
  carry the custodian role; **Ring-3 freeze/unfreeze**; open/close elder elections
  with published turnout; escalate/resolve disputes; trust resolution history with
  quorum tracking.
- **Ledger** — journal browser (filter by ref/purpose), trial balance, general
  ledger with live balances, escrow balances, split templates, reconciliation runs
  with variance alerts, failed postings, idempotency history. **Strictly read-only
  by construction: no write endpoint exists under `/v1/admin/ledger`.**
- **Heritage** — flagged-content review queue, consent history (with revocations),
  deletion requests with 14/90-day deadlines and signed completion receipts, run
  the deletion sweep, restricted-content metadata view. Viewing restricted metadata
  is itself written to the audit log, titles/media are withheld even from admins,
  and **no export path for the restricted class exists anywhere in the API**.
- **Finance** — escrow monitoring incl. stuck escrows, milestones awaiting
  approval/release, payment intents with operator re-verification, failed payouts
  (funds already auto-reversed), retry-queue drain, daily reconciliation trigger,
  fraud review queue.
- **Audit** — object history with hash-chain verification, per-entry inclusion
  proofs, user history, JSON/CSV export (entries carry digests, never content).
  There is no mutation surface for audit records.
- **Security** — secret inventory (names/versions only) with one-click rotation,
  authorization denial log, live permission audit (every role grant), notification
  delivery stats, search reindex.
