# Assumption Registry & Twin Confidence (Phase 13, Parts 1–2)

Gated by `APP-FIT-ASSUMPTION-REGISTRY` and `APP-FIT-TWIN-CONFIDENCE`.
Live: `GET /api/architecture/assumptions` · `GET /api/twin/operations/confidence`.

---

# Part 2 — The executable assumption registry

Every phase of this platform has rested on assumptions that were written into a comment and then
stopped being examined:

> *"An investigator's session is pinned for the duration of a case edit."*
> *"The synthetic topology reflects the production one."*
> *"case-throughput is a usable proxy for whether people can report."*

Each is load-bearing. Each was true when written. None had an owner, an expiry, or anything that
would tell you the day it stopped being true. `src/architecture/assumptions.js` fixes that, and the
eight assumptions this codebase actually makes are now registered with all of it.

## Three decisions carry the weight

**1. Declared and assessed confidence are separate fields.** The owner states what they believe;
the registry derives what the evidence supports. Where the first exceeds the second, the assumption
is an **overclaim** and is named as one. A single hand-entered confidence would be unfalsifiable —
which is the opposite of the point.

**2. Contradiction is detected structurally, not read.** Each assumption carries a machine-readable
claim — `{ subject, predicate, value }` — so two assumptions that cannot both be true are found by
comparison rather than by someone noticing:

```
at-most 100   vs  at-least 500   on the same subject  → contradiction
holds         vs  does-not-hold                       → contradiction
equals 1000   vs  equals 2000                         → contradiction
at-least 100  vs  at-most 500                         → compatible, not reported
```

The detector is deliberately conservative. A false contradiction would train people to ignore the
report, which is worse than missing one.

**3. An assumption with no expiry is refused.** An assumption that never expires is a *belief*, and
beliefs outliving the conditions that justified them is the entire failure mode here. `register()`
fails closed without one, and without an owner.

## What the assessment is made of

| Input | Effect |
|---|---|
| Verification method | Sets a **ceiling**: `executable-check` → high, `operational-observation` → moderate, `human-attestation` → low, `unverifiable` → unknown |
| Cited evidence | Evidence that resolves to no control that ran caps at low; **failing** evidence caps at low |
| Verification history | **Never verified caps at low**, whatever the method allows. A failed verification takes it to `unknown` |
| Expiry | Absolute — an expired assumption supports nothing until it is re-taken |
| Review cadence | Overdue caps at low |

`recordVerification()` is append-only, attributed and **never seeded**. The platform's own
assumptions therefore all read as overclaimed today, because nobody has verified any of them yet.
That is uncomfortable and it is accurate; seeding a verification history would make every confidence
figure downstream a lie.

## Detection

`stale` · `contradictions` · `orphaned` (bears on no bounded context the architecture contains) ·
`unevidenced` (cites nothing, or cites controls that never ran) · `overclaims`.

`health(ids)` aggregates a set to the **weakest** member — a simulation resting on five sound
assumptions and one expired one rests on an expired assumption. An empty set is not sound: *"an
undeclared assumption is not an absent one, it is an unexamined one."*

---

# Part 1 — Digital twin confidence

A simulation that answers confidently and gives the reader nothing to disagree with is the dangerous
kind. So every scenario now declares its **assumptions**, its **limitations**, an **owner** and a
**review cadence**, and `simulate()` refuses to run one that does not.

`assertDeclaredMetadata()` is exported so the guard can be fed a crafted scenario spec directly —
a check that can only be exercised by mutating the real scenario table is a check nobody dares
exercise.

## Confidence is capped, never averaged

```
confidence = weakest of:
    calibration        has anyone compared this scenario against a real outcome?
    assumptions        what does the registry say about the assumptions it rests on?
    model completeness does the model still match the architecture-of-record?
```

The result names `limitedBy`, so raising it means fixing the limiting factor rather than re-reading
the model.

## Calibration

| State | Meaning | Ceiling |
|---|---|---|
| `uncalibrated` | No simulation of this scenario has ever been compared against a real outcome | **low** |
| `diverging` | Recent comparisons found the simulation disagreed with reality | **unknown** |
| `calibrated` | Recent comparisons matched the observed outcome | high |

> **A simulation nobody has checked against reality cannot report high confidence, however complete
> the model is.**

`recordValidation()` takes what was predicted, what was observed, and who compared them. It is
append-only and never seeded — a fabricated calibration history is the single cheapest way to make
this entire framework worthless.

As composed, every scenario is `uncalibrated` and the twin reports `unknown`. That is the true state
of a platform that has never run a real DR exercise against its own predictions.

## Trend

`confidenceTrend()` compares agreement in the earlier half of the history against the later half and
warns when it decays: *"the model is drifting away from the system it describes."* Two comparisons
minimum — one observation is a result, not a direction.
