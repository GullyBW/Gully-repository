# Consumer-Driven Contract Testing (Phase 10, Part 12)

The [contract registry](./integration-contracts.md) says what the platform **offers**. This says what
each consumer actually **depends on**, and verifies the provider still satisfies every consumer
expectation before a change ships (`src/contracts/consumer-contracts.js`).

Gated by `APP-FIT-CONSUMER-CONTRACTS`. Live: `GET /api/contracts/consumers` ·
`POST /api/contracts/impact`.

> **The asymmetry that makes it useful:** a provider may **add** freely, but may only **remove or
> tighten** something no consumer depends on.

## Registered consumers

| Consumer | Owner | Criticality | Depends on |
|---|---|---|---|
| Citizen web client | intake | **constitutional** | `api.reports.submit`, `api.reports.status` |
| Investigator console | investigation | critical | `api.investigator.review`, `api.case.transition` |
| Oversight portal | governance-oversight | critical | `api.oversight.dashboard`, `api.governance.decision` |
| Partner agency integration | data-exchange | important | `api.data-exchange.request`, `schema.Case` |
| Analytics pipeline | analytics | important | `event.case.submitted`, `event.case.transitioned` |
| Audit archive | assurance | critical | `schema.EventEnvelope`, `event.governance.decided` |

Each expectation names precisely what the consumer reads, sends, which error codes it handles and the
authentication mode it is built for — so "we didn't know anyone used that" stops being possible.

## Impact analysis — before the change, not after the deploy

```
impactOfChange('api.case.transition', { fields: { required: ['case_code'] } })
→ safe: false
  affectedConsumers: [investigator-console]
  verdict: "BREAKS 1 consumer(s) — publish a new major version with a sunset and migrate them first"
```

A technically-breaking change that no registered consumer depends on is reported as such — precision
matters, because treating every removal as catastrophic is how teams learn to ignore the check.

Breaking the **citizen web client** raises `constitutionalImpact: true` separately, because that
consumer is the constitutional guarantee and deserves to be named, not counted.

## Deprecation and lifecycle

`deprecationReport()` lists every deprecated or sunsetting contract with its **live consumers** —
a deprecated contract with live consumers is a migration obligation, not a retirement.
`unconsumedContracts()` lists the opposite: published surface nobody depends on, which is
maintenance without a beneficiary and a candidate for deprecation.

## Validation

A consumer must name an owning context, a criticality, at least one expectation, at least one handled
error (a consumer that ignores failure is a consumer that fails silently), only canonical error codes,
and an expected authentication mode. The composition root refuses to start if any registered consumer
expectation is unmet.
