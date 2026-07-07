# Pilot Rollout Guide (Phase 2, WS7)

Doc §16's rule made operational: **pilots are a flag, not a build**. All ten
layers ship dark; a community lights up per-ward when it is ready.

## Onboarding a community, step by step

1. **Create the pilot** (portal → Pilots, or `POST /v1/admin/pilots`):
   name, district, and a *flag profile* — the module set this pilot enables,
   e.g. `{ "module.mmino": true }`.
2. **Register villages** (`POST /v1/admin/pilots/{id}/villages`): creates the
   ward, and — when a headman msisdn is given — provisions the headman's
   office (L3 + `headman_office(ward)` role). The office can immediately
   endorse residents to L2, which is the trust root for everything else
   (§5.1). Enrolling the ward applies the flag profile at `ward:` scope.
3. **Assign pilot administrators** (`POST .../admins`; must be L3) — they get
   `pilot_admin(pilot:X)`.
4. **Advance the stage**: `planned → onboarding → live`. Going **live is
   gated**: at least one enrolled ward AND one administrator, enforced in
   code, not in a checklist.
5. **Watch health** (`GET .../health`): residents by verification level,
   letsema activity, notices — the field signal that adoption is real.
6. **Report** (`GET .../report`): stage history + PII-free usage for
   stakeholders (VDCs, dikgosi, funders).
7. Scale (`live → scaled`) or pause (`⇄ paused`) — pausing a pilot leaves its
   data intact; only rollout state changes.

## Feature flags & remote configuration

- Scopes and precedence: `user > ward > morafe > global > default`.
- Booleans gate modules (`module.mmino`); JSON configs tune clients remotely
  (`config.data_budget_kb` — the P8 budget knob).
- Clients bootstrap with `GET /v1/flags` (their resolved snapshot).
- Every change is audited (`flag:<key>` chain) and evented — a rollout is a
  readable history.

## Field UAT gate (doc §17)

Pilot-ward acceptance with real elders and headman offices is a formal release
gate for Phases 2–4 of the blueprint. The pilot report is the artifact you
bring to that review; findings are triaged with engineering-defect rigour.
