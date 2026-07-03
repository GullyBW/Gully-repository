# Workflow Engine (Phase 3, WS4)

Approval flows are **data, not code**. Administrators reconfigure steps, thresholds,
timeouts and escalation without a deploy (`POST /v1/admin/workflows`).

## Definition shape

```json
{
  "key": "escrow_milestone_release",
  "steps": [
    { "id": "dual_approval", "type": "approval", "approvals_required": 2,
      "min_level": "L3", "roles": [{ "role": "platform_admin", "scope": "platform" }],
      "timeout_ms": 604800000, "on_timeout": "escalate",
      "escalate_to": { "role": "platform_admin", "scope": "platform" } },
    { "id": "release", "type": "action", "action": "kgetsi.release_milestone" }
  ]
}
```

Step types: `approval` (N-of-M distinct approvers, role-scoped via `scope_from` reading
the instance context), `action` (invokes a registered handler that bridges to a domain
service), `timer` (waits `timeout_ms`, resolved by `tick()`).

Features: conditional routing (`condition: {field, op, value}` — op ∈ eq/ne/gt/gte/lt/lte/in),
parallel groups (`parallel_group` — all members activate at once, all must complete),
timeouts with `on_timeout` ∈ escalate/reject/auto_approve, delegation, audit + notification
integration on every transition. New definition versions supersede; running instances keep
their version.

## Seeded flows

Eight flows ship pre-loaded, mirroring the platform's existing hardcoded rules as data:
`identity_verification`, `heritage_publication`, `custodian_appointment`,
`ring3_succession`, `escrow_milestone_release`, `trust_resolution`, `election`,
`dispute_resolution`.

## Backward compatibility

The existing hardcoded flows in Kgetsi/Governance/Heritage are **untouched and remain the
source of truth** — the engine is an opt-in orchestration layer. Action handlers call the
same domain services, which still enforce their own invariants (e.g.
`kgetsi.release_milestone` records the two distinct L3 approvals at the kgetsi layer before
releasing). Defence in depth: the engine orchestrates, the domain service enforces.

## API

```
POST /v1/admin/workflows                              define/version a workflow
GET  /v1/admin/workflows | /workflows/instances
POST /v1/admin/workflows/{key}/start                  {context, object_ref}
POST /v1/admin/workflows/instances/{id}/steps/{s}/decide   {decision: approve|reject}
POST /v1/admin/workflows/instances/{id}/steps/{s}/delegate {to_ref}
POST /v1/admin/workflows/tick                         resolve timers/timeouts (scheduler)
```
