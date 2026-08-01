# ADR-0003: Boundary consolidation and "National Data Exchange" terminology

- **Status:** Accepted · **Date:** 2026-08-01
- **Deciders:** Chief Architect, DDD Lead, National Data Office, Data Governance Board, ARB
- **Review required:** ARB + DGB (terminology and governance model of the exchange)

## Context

The Part 1 boundary review examined every bounded context for purpose, boundary integrity, overlap,
cohesion and coupling. Four findings needed a decision; one of them — the "National Data Marketplace" —
is a governance question, not a naming preference.

**Marketplace analysis.** The capability implements: a dataset registry with declared, non-identifying
schema fields; human approval before a dataset may be listed; classification enforcement
(`restricted`/`secret` never publicly listed); and recorded usage agreements requiring an explicit
purpose and a named approver. It implements **no** pricing, settlement, billing, licensing
marketplace, brokerage, or commercial counterparty model. "Marketplace" therefore describes a
governance model the platform does not have, and — in a government transparency platform — implies
that public data is a tradable commodity. That is a material misdescription of the accountability
model, not a cosmetic issue.

## Decision

1. **The capability is the *National Data Exchange*.** Its purpose taxonomy is explicit and closed:
   `inter-agency-exchange`, `controlled-sharing`, `open-government-data`, `analytics`. **Commercial
   data exchange is a prohibited purpose** and is refused fail-closed.
2. **Implementation continuity:** `DataMarketplace` (`src/fabric/marketplace.js`) is unchanged and
   remains the registry implementation. `NationalDataExchange` (`src/fabric/data-exchange.js`) wraps
   it and adds purpose limitation, purpose-scoped approval, retention and exchange audit. No existing
   caller, test or endpoint breaks.
3. **Merge the two federation models.** `tenancy/federation` and `tenancy/ecosystem-federation` are one
   bounded context (`tenancy-federation`) with one isolation model and two entry points. They modelled
   the same concept — trust between organisations — at two scales.
4. **Consolidate usability evidence into `portfolio`.** User-validation evidence about a service
   belongs to that service's portfolio record, not to a standalone context.
5. **Keep `govops/center` and `govops/command-center` separate.** They serve different audiences
   (operational vs strategic) at different cadences; both are advisory and neither authorizes. The
   apparent overlap is reporting surface, not responsibility.
6. **Scope the shared `purpose-limitation` responsibility:** `intelligence` owns
   `correlation-purpose-limitation`; `data-exchange` owns exchange purpose limitation. Cohesion is now
   1.0 for every context.

## Consequences

- **Backward compatibility:** preserved. `DataMarketplace` keeps its API and behaviour; the exchange is
  a new facade over it. The federation merge is a *map* change — module contents are untouched.
- **Twin impact:** `APP-FIT-CONTEXT-MAP` now fails on any unreviewed responsibility overlap;
  `APP-FIT-DATA-EXCHANGE-PURPOSE` verifies purpose limitation and the prohibition on commercial
  exchange.
- **Threats/risks:** removes a governance misdescription that could have justified commercial data
  sharing by analogy (privacy/LINDDUN: secondary use). Reduces duplicated trust logic between the two
  federation models.
- **Trade-offs (named):** the platform now carries two names for one capability during the transition
  (`DataMarketplace` class, "Data Exchange" capability). Accepted deliberately: renaming the class
  would break callers for no governance gain, and the facade is where the governance actually lives.

## Alternatives considered

- **Rename the class and all callers** — rejected: a breaking change with no behavioural benefit.
- **Keep "marketplace"** — rejected: it misstates the governance model to the public and to
  participating agencies.
- **"Data Marketplace (non-commercial)"** — rejected: a disclaimer inside a name is a design smell.
- **Fold `data-exchange` into `data-fabric`** — rejected: catalogue duties and purpose-limited release
  have different approvers, different boards and different failure modes.

## Human review

Dataset approval, exchange approval for restricted/secret classifications, and any change to the
permitted-purpose taxonomy remain decisions of the data steward and the Data Governance Board.
