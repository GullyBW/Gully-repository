# Strategic planning, institutional learning, and the four-clause invariant

Phase 14. What the institution can see coming, what it learns from what already happened, and the
invariant that binds both to the capabilities the platform exists to deliver.

---

## The four-clause global invariant

`src/governance/institutional-resilience.js` · verified by `APP-FIT-GLOBAL-INVARIANT` · [ADR-0009](./adr/0009-adaptive-governance-and-the-four-clause-invariant.md)

> **No critical institutional capability may depend upon an unvalidated assumption, an unverified
> dependency, an undocumented governance relationship, or a single point of organizational failure.**

The fourth clause is [ADR-0008](./adr/0008-institutional-assurance-and-the-single-dependency-invariant.md)'s
invariant unchanged. The three new ones close ways a capability can be fragile while passing it:

| Clause | Evaluated from | If unknown |
|---|---|---|
| `unvalidated-assumption` | the propagated health of every assumption bearing on the capability's contexts | It may rest on a belief that stopped being true, and nothing would say when. |
| `unverified-dependency` | the `detectedBy` control of each dependency kind, resolved against what actually ran | The dependency may already have broken; the first anybody hears is the incident. |
| `undocumented-governance-relationship` | whether every institution pair the capability spans has a recorded way to reach the other | Two institutions may be jointly responsible with no way to reach each other. |
| `single-point-of-organizational-failure` | thirteen dependency kinds across eleven categories | One person, document, dataset, site, instrument or board may stop a constitutional capability. |

**A clause with no register behind it reports UNKNOWN and does not hold.** An unexamined capability is
not a sound one.

### It does not hold, and that is the point

Every critical capability currently fails the assumption clause — the registry is new and nothing has
been verified — and the single-point clause. `evidence-custody` satisfies **all four** when fed full
continuity evidence and a verified assumption, which is what demonstrates the bar is reachable rather
than decorative.

Building the second clause found something real: **two dependency kinds had no detecting control at
all.** Communication channels now resolve to the escalation workflow — an escalation raised and never
acknowledged is exactly what a failed channel looks like from inside the platform. Facilities resolve
to the multi-region check and state on every row that it watches the region behind a site, not the
building; it would not notice a shared power feed or a shared landlord.

### Acceptance

A failing clause blocks institutional readiness until it is mitigated or **formally accepted by the
accountable human authority with a recorded rationale, owner and expiry**. Constitutional capabilities
remain the Oversight Board's alone. An acceptance expires without anybody withdrawing it, which returns
the block automatically.

---

## The eleven-category dependency taxonomy

Thirteen assessable kinds, rolled up into the eleven categories a board actually asks about. A category
nothing assessed is **unvalidated**, not validated.

| Category | Kinds | Asks |
|---|---|---|
| people | person, team | Can the people be replaced? |
| process | process | Is there another way to do it? |
| technology | service | Does one system carry it? |
| data | data | Can the data be reconstructed? |
| knowledge | knowledge | Does anybody else know how? |
| documentation | document | Is it written down anywhere followable? |
| facilities | facility, region | Does one site carry it? |
| communications | communication-channel | Can people still be reached? |
| suppliers | supplier | Does one supplier carry it? |
| legal-authority | legal-authority | Does one instrument authorise it? |
| governance | governance | Can a decision still be taken? |

**Knowledge** needs *both* halves: a trained, rehearsed second person **and** a followable procedure.
A document nobody has followed is a guess; a person who has rehearsed but written nothing down takes it
with them.

### What the widening found

Four new single dependencies. Two were incomplete declarations and were corrected: `case-investigation`
and `service-recovery` both omitted the event stores they are actually built on, which made the
data-resilience check report them as holding an unreconstructible store of record. The declaration was
wrong, not the architecture.

Two are real and are now in the ratchet: **nothing in this platform records what legally authorises
case investigation or service recovery.** Both report UNKNOWN, and unknown is not resilient.

---

## Institutional risk prioritisation

Six factors per open dependency. Three are derived, three are declared priors, and each says which:

| Factor | Basis |
|---|---|
| likelihood | **declared** — an institution loses people constantly and regions almost never |
| operationalImpact | derived from the declared topology |
| detectability | derived from whether the kind's control ran and held |
| recoveryComplexity | **declared** — recording a contact is simple; giving a deputy real competence takes a year |
| businessCriticality | derived from the capability's constitutional status |
| governancePriority | derived from the accountability record |

> **A constitutional capability always ranks first, whatever the arithmetic says.**

A weighted average would eventually let a well-detected constitutional dependency fall below a
badly-detected trivial one, and no tuning makes that acceptable. Criticality selects the band; the
arithmetic only orders within it.

---

## Strategic scenario planning

`src/twin2/operations-twin.js` · verified by `APP-FIT-STRATEGIC-SCENARIOS`

The twin could rehearse losing a region and losing a person. It could not rehearse the things that
actually reshape an institution — and those arrive with far more warning and are planned for far less
carefully, because nothing existed to plan against.

Seven scenarios, each able to block and each able to pass:

- **policy-reform** — catches contexts *outside* the reform that depend on a guarantee it weakens.
- **legislative-change** — reports reach wider than the instrument names, and controls that must be
  built rather than complied with.
- **funding-reduction** — which governance objects lose an accountable authority first.
- **organizational-restructuring** — a merger that leaves one authority both holding and approving the
  same subsystem is blocked.
- **staffing-growth** — the finding that matters: headcount does **not** close a single-person
  dependency, because an untrained arrival is a name, not an alternative.
- **cross-government-collaboration** — see below.
- **emergency-operations** — an emergency runs out of approving authorities before it runs out of
  systems.

### The zone question

Collaboration exposed a real gap: **this platform does not record which deployment zone a bounded
context sits in.** The topology knows the zone of every service; nothing connects a service back to a
context.

So the proposal must state it, the twin checks the stated zones are real, and a context whose zone the
proposal does not state **blocks**. Reading the absence as "probably fine" would be reading an unknown
as a pass on a constitutional invariant, which is the one place this platform never does that.

---

## Institutional learning

`src/assurance/institutional.js` (`institutionalLearning`) · verified by `APP-FIT-INSTITUTIONAL-LEARNING`

```
Incident → Investigation → Root Cause → Corrective Action → Verification →
Governance Update → ADR → Training → Future Readiness
```

The improvement loop already closes the first six links. Closing them is a **correction**, and:

> **A correction changes the system. Learning changes what the people can do next time.**

An institution that fixes the same class of problem three times has corrected three times and learned
nothing — and every metric in a normal improvement dashboard shows it doing well: closure rate 100%,
mean time to close falling.

So the chain ends at future readiness, and readiness only counts when:

- somebody was trained **after** the incident (training booked before it was not a response to it), and
- a rehearsal happened **after** the training (training with no rehearsal behind it is a certificate).

An incident that was fixed with nobody taught is reported as `corrected-not-learned`. `weakestStage`
names where the chain most often breaks across the estate — which says what to fix about *how the
institution learns*, rather than about any one incident.

---

## Regulatory change forecasting

`src/legislation/compliance-intelligence.js` · verified by `APP-FIT-REGULATORY-FORECAST`

> **A forecast must never become a compliance record.** A hypothetical obligation sitting in the same
> register as an observed one is how "we expect to comply" becomes "we comply".

Forecasts live in their own register, are labelled `hypothetical: true`, and `obligationsMoved` is
asserted to be `0`. The effort estimate is derived from what is **missing** — controls that do not
exist, decisions not recorded, controls that are failing — rather than declared by whoever files the
forecast, because an estimate somebody types in is a negotiating position.

An empty forecast register reports that **nobody has looked**, not that nothing is coming.

---

## Executive strategic intelligence

Fifteen panels, five of them new: strategic readiness, organizational maturity, operational
sustainability, decision quality, public trust. Every one is a function of a register; there is still
no parameter anywhere in the module that accepts a figure.

Eighteen assurance domains, five new: dependency resilience, strategic readiness, learning maturity,
governance adaptability, public trust indicators.

**Eighteen verified domains still print NOT AUTHORIZED.** Authorization is a recorded decision by a
named human for a specific deployment, and no aggregate of evidence has ever produced one here.
