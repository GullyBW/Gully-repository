# Observability by Domain and Audience (Stabilization Part 12)

One "national dashboard" serves nobody. An architect, a security officer, an SRE, an oversight board
member, a service owner and an infrastructure operator need **different questions answered at
different cadences**. Observability is therefore split into six domains, each with a named audience,
the governance board that consumes it, and the question it exists to answer
(`src/observability/dashboards.js`).

Gated by `APP-FIT-OBSERVABILITY-DOMAINS`. Live: `GET /api/observability/dashboards` ·
`GET /api/observability/dashboards/{domain}`.

| Domain | Audience | Board | Cadence | The question it answers |
|---|---|---|---|---|
| **Engineering Health** | Architects and engineering leads | ARB | per build | Is the architecture still true, and is the platform still buildable? |
| **Security Posture** | Security officers and the SOC | ISRB | continuous | Is the platform defensible right now, and is anything degrading? |
| **Operational Performance** | SREs and operations managers | ORB | live | Are we meeting our objectives, and how much error budget is left? |
| **Governance Effectiveness** | Oversight board members and governance officials | OB | weekly | Are humans actually deciding, and is every decision traceable? |
| **Citizen Service Delivery** | Service owners and the service delivery board | SDB | daily | Is the public actually being served, and where is the service failing them? |
| **Infrastructure Health** | Infrastructure operators and the data centre authority | ORB | continuous | Is the estate compliant, current and recoverable? |

Each domain carries six widgets resolved from live sources by dotted path — for example
Engineering Health shows invariants held, failing invariants, architecture-of-record validity,
boundary crossings under contract, open invariant failures and the maturity grade; Governance
Effectiveness shows decisions recorded, human governance density, recommendations awaiting approval,
ledger integrity, owned subsystems and compliance coverage.

## Rules every dashboard obeys

- **Identity is refused, not redacted.** A source value that looks like an identifier renders as
  `status: refused` with the reason — the widget shows nothing rather than something.
- **Small cells are suppressed** at the dashboard, using the same `K_ANON` rule as analytics. A
  dashboard is not a way around the privacy model.
- **A missing source degrades visibly** (`status: unavailable`) instead of rendering a misleading
  zero. "We don't know" and "it is zero" are different answers, and conflating them in operations
  costs incidents.
- **Deterministic.** The same sources always render the same dashboard.
- **`informationalOnly: true`, `authorizes: false`** on every domain. No dashboard, in any audience,
  authorizes an action.

## Validation

`APP-FIT-OBSERVABILITY-DOMAINS` fails the build if a domain has no named audience, no question, no
cadence, fewer than four widgets, a board that is not in the ownership model, a duplicate widget, a
ratio without a denominator — or if **two domains share an audience**, because then they are one
dashboard, not two.
