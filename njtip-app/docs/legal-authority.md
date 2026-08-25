# Legal authority assurance

**Audience:** reviewer · legal informatics · Attorney General's Chambers
**Status:** governed documentation — every claim below is verified against the implementation on
every build by `APP-FIT-DOCUMENTATION-ASSURANCE`.

Recorded by [ADR-0010](./adr/0010-institutional-intelligence-legal-authority-and-the-six-clause-invariant.md).
Closes a debt recorded by [ADR-0009](./adr/0009-adaptive-governance-and-the-four-clause-invariant.md):
*nothing records what legally authorises case investigation or service recovery.*

---

## What this answers

Every other governance register in this platform answers **"what must we comply with?"** — the
legislative registry, the compliance intelligence, the obligation lifecycle. None of them answered a
different and prior question:

> **What legally permits this capability to exist at all?**

A capability whose statute is repealed stops being lawful at the moment of repeal. There is no
outage, no failing control, and no dashboard turning red. `src/legislation/legal-authority.js` is the
register that can see it.

## The register ships EMPTY

This is the most important thing on this page.

**No statutory claim is seeded.** Declaring that a particular Act authorises a particular capability
is a legal assertion about the Republic of Botswana. It is not a fact this repository can derive, and
a plausible-looking statute name in a governed register is *worse* than an empty one: an auditor
would read it, an engineer would cite it, and nobody would discover it was invented until it
mattered.

So the framework is executable and the instruments are the institution's to record. Today every
critical capability reports its legal basis as `unknown`, and `GET /api/legislation/legal-authority`
says so.

## The five kinds of authority

Ordered by what it takes to remove them, because that is what actually distinguishes them — a
constitutional mandate and a departmental policy are both "authority" until somebody wants to remove
one.

| Kind | Withdrawn by |
|---|---|
| `constitutional` | A constitutional amendment. |
| `legislation` | An Act of Parliament. |
| `delegated-authority` | The delegating authority, at will. |
| `regulation` | The regulator, by instrument. |
| `policy` | The issuing body, by decision. |

Delegated authority that does not name what it was delegated *from* is refused: a delegation with no
source cannot be traced to a legal basis.

## The six states

`unknown` is not `absent`. One means nobody has looked; the other means somebody looked and found
nothing, and they need different people to act.

| State | Authorized | Blocks readiness | Meaning |
|---|---|---|---|
| `unknown` | no | yes | No declaration exists. |
| `declared` | no | yes | A declaration exists and has not been reviewed by the approving organization. |
| `reviewed` | **yes** | no | Declared and reviewed within its schedule, by the approving organization itself. |
| `expired` | no | yes | The declaration passed its expiry. |
| `overdue` | no | yes | The review schedule was missed. |
| `withdrawn` | no | yes | The instrument was repealed, amended away, or the delegation ended. |

### A declaration is not a review

A declaration is `declared` until the **approving organization named in it** reviews it. A review by
anybody else is somebody reading a document, and `review()` refuses it. This is checked by
`APP-FIT-LEGAL-AUTHORITY` and by the invariant's legal clause in `APP-FIT-GLOBAL-INVARIANT`.

### Seven required fields

A partial legal declaration reads as a complete one to everybody downstream, so all seven are
mandatory and each states what its absence would mean: `kind`, `instrument`, `approvingOrganization`,
`reviewEveryDays`, `expiresAt`, `evidence`, `scope`.

## The legal dependency graph

`src/graph/enterprise-graph.js` walks:

```
capability → legal authority → policy → ADR → control → evidence → readiness
```

With the register empty, **every critical capability is blocked at the first hop**, and the report
names the hop rather than reporting a generic failure. Read it at
`GET /api/graph/legal-dependencies`, checked by `APP-FIT-LEGAL-DEPENDENCY-GRAPH`.

## The invariant clause

`undocumented-legal-authority` is one of the six clauses of the global invariant
(`src/governance/institutional-resilience.js`). It reports:

- `unknown` when no register is supplied or no declaration exists — and unknown is not documented;
- not-holding but **not** unknown when a declaration exists and nobody has reviewed it;
- holding only when the state is `reviewed`.

An expired authority stops satisfying it with nobody withdrawing anything.

## HTTP surface

| Method | Route | Role | What it does |
|---|---|---|---|
| GET | `/api/legislation/legal-authority` | oversight-board | The register's report over every critical capability |
| POST | `/api/legislation/legal-authority` | oversight-board | Declare an authority — a **human** legal assertion |
| POST | `/api/legislation/legal-authority/{capability}/review` | oversight-board | Review one, by the approving organization |
| GET | `/api/graph/legal-dependencies` | oversight-board | The capability → readiness chain |
| GET | `/api/governance/global-invariant` | oversight-board | All six clauses, per capability |

Declaring and reviewing are POSTs by a named person because neither can be performed by the platform.

## What would tell you this framework failed

A declaration in the register that no instrument supports. That is sunset criterion 2 of ADR-0010,
and the correct response is to withdraw the framework rather than patch it.

## Where it lives

- `src/legislation/legal-authority.js` — the register, the kinds, the states, the fields
- `src/governance/institutional-resilience.js` — the invariant clause
- `src/graph/enterprise-graph.js` — the legal dependency graph
- `verification/app-fitness.js` — `APP-FIT-LEGAL-AUTHORITY`, `APP-FIT-LEGAL-DEPENDENCY-GRAPH`,
  `APP-FIT-GLOBAL-INVARIANT`

Run the checks with `npm run assurance`.
