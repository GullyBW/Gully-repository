# Enhanced Recovery Framework (Stabilization Part 8)

Human-governed recovery now compares **multiple strategies** rather than looking up one playbook.
Each strategy is evaluated on Recovery Time Objective, Recovery Point Objective, operational
disruption, resource requirements, data integrity and business continuity
(`src/twin2/recovery-strategies.js`).

Gated by `APP-FIT-RECOVERY-STRATEGIES`. Live: `POST /api/recovery/strategies/evaluate` ·
`POST /api/recovery/strategies/{id}/authorize`.

> **Advisory until authorized.** A recommendation is a recommendation. `selected()` throws until a
> **named human authority** authorizes a strategy with a written rationale — fail-closed, the same
> discipline as recovery execution itself.

## The strategy catalogue

| Strategy | RTO | RPO | Disruption | Resource efficiency | Data integrity | Continuity |
|---|---|---|---|---|---|---|
| Restore from verified backup | 240 m | 60 m | 0.2 | 0.9 | 0.9 | 0.3 |
| Promote warm standby | 30 m | 5 m | 0.5 | 0.5 | 0.8 | 0.7 |
| Shift traffic between active regions | 5 m | 0 m | 0.8 | 0.2 | 0.9 | 0.95 |
| Rebuild read models from the event log | 90 m | 0 m | 0.4 | 0.8 | **1.0** | 0.5 |
| Operate in degraded mode | 10 m | 0 m | 0.9 | 0.95 | 1.0 | 0.4 |
| Isolate the affected zone and rebuild | 480 m | 15 m | 0.9 | 0.4 | 0.95 | 0.2 |

Qualitative dimensions are 0..1 where **1 is best** (least disruption, least resource need, highest
integrity, highest continuity).

## The trade-offs, stated

Every strategy names the thing that makes it a bad idea in the wrong situation:

- **Restore from backup** — cheapest and simplest, but the whole RPO window of work is lost and
  service is down for hours. Requires a *restore-verified* backup (`INFRA-FIT-DR-BACKUP-RESTORE`).
- **Warm standby** — fast and affordable, but replication lag defines the data loss, and promotion is
  a one-way door under pressure.
- **Active-active** — near-zero interruption and the most expensive posture; cross-region consistency
  must never breach zone isolation.
- **Rebuild from events** — highest integrity because the hash-chained log *is* the source of truth,
  but it recovers derived state only, never the log itself.
- **Degraded mode** — keeps the constitutional path (anonymous reporting) alive within minutes at the
  cost of most other capability.
- **Isolate and rebuild** — the only safe answer to a suspected compromise, and the most disruptive.
  Containment beats availability here, and custody and audit chains are preserved *before* isolation.

## Evaluation

Weights are **data**, so an incident commander can re-weigh and the report shows exactly how:

```
default weights: rto 0.25 · rpo 0.25 · disruption 0.15 · resources 0.10 · integrity 0.15 · continuity 0.10
```

Objectives are normalised against the worst value in the catalogue; each result carries its six
per-dimension contributions, so a ranking can always be argued with rather than merely accepted.
Constraints (`maxRtoMinutes`, `maxRpoMinutes`, `minDataIntegrity`) mark violating strategies with a
reason and push them below every compliant one — they are never silently dropped, because "why was
that option not offered?" is the first question in a post-incident review.

Evaluation is deterministic: the same inputs always produce the same ranking.

## Authorization

```
recommend()  →  advisory, requiresHumanAuthorization: true
authorize()  →  named human authority + written rationale (both mandatory)
                may authorize an ALTERNATIVE over the recommendation — and that is recorded
selected()   →  throws until authorized (failClosed)
```

Every step is audited. The evaluator can recommend, compare and explain; it can never choose.
