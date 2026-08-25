# National Data Exchange (Stabilization Part 9)

The capability formerly called the *National Data Marketplace* is the **National Data Exchange**
(ADR-0003). The rename is a governance correction, not cosmetics.

## What the review found

The implementation provides: a dataset registry with declared, non-identifying schema fields; human
approval before listing; classification enforcement (`restricted`/`secret` never publicly listed); and
recorded usage agreements requiring an explicit purpose and a named approver.

It provides **no** pricing, settlement, billing, licensing marketplace, brokerage or commercial
counterparty model — and it never will. "Marketplace" therefore described a governance model the
platform does not have and, in a government transparency platform, implied that public data is a
tradable commodity. That is a material misdescription of the accountability model.

**Its purpose is: secure inter-agency exchange and controlled sharing** — with open government data
and aggregate analytics as narrower cases of the same governed release.

## Purpose taxonomy (closed)

| Permitted purpose | Description | Named approver required |
|---|---|---|
| `inter-agency-exchange` | Transfer between public bodies for a statutory function of the receiving body | yes |
| `controlled-sharing` | Scoped, time-bound sharing under a recorded agreement (e.g. a joint investigation) | yes |
| `open-government-data` | Publication of non-identifying, public-classification data for transparency | no |
| `analytics` | Aggregate statistical analysis producing non-attributable outputs | yes |

| Prohibited purpose | Why |
|---|---|
| `commercial-exchange` / `commercial` | Public data is not a tradable commodity; there is no pricing, settlement or brokerage model and there will not be one |
| `profiling` | Building profiles of individuals from exchanged data is outside every permitted purpose |
| `law-enforcement-fishing` | Exchange requires a stated, specific statutory function — not speculative search |

The taxonomy is **closed**: an unknown purpose is refused exactly like a prohibited one.

## Strengthened controls

- **Purpose limitation is declared, not implied.** A dataset registered with no permitted purpose is
  refused. It can then be exchanged *only* for a purpose it declared.
- **Purpose limitation at use time.** `checkUse({ agreementId, purpose })` refuses a purpose the
  agreement does not cover — the control survives the moment of transfer, which is where purpose
  creep actually happens.
- **Privacy validation unchanged and absolute.** A dataset whose schema declares an identity field is
  refused at registration.
- **Classification enforcement.** `restricted`/`secret` datasets are never publicly discoverable and
  always require a named approver.
- **Approval workflow.** Dataset approval and (for every purpose but open data) exchange approval each
  require a **named human** and a written justification.
- **Retention bound to the agreement.** Every agreement carries `expiresAt`; after it elapses, use is
  refused and the agreement appears in `retentionDue()`. Revocation requires a named human and a reason.
- **Purpose-aware discovery.** A consumer sees only datasets they could actually receive for the
  purpose they state.
- **Unified audit.** One trail across registration, approval, exchange and revocation, merging the
  registry's audit with the exchange's.

## Implementation continuity

`DataMarketplace` (`src/fabric/marketplace.js`) is **unchanged** and remains the registry underneath.
`NationalDataExchange` (`src/fabric/data-exchange.js`) wraps it and adds the governance above. No
existing caller, test or endpoint breaks; the class keeps its name because renaming it would break
consumers for no governance gain, and the governance lives in the facade. Gated by
`APP-FIT-DATA-EXCHANGE-PURPOSE`. Live: `GET /api/data-exchange` ·
`POST /api/data-exchange/agreements`.
