# Governance Rehearsals, Decision Memory & the Organizational Twin (Phase 13, Parts 9, 10, 12)

Gated by `APP-FIT-GOVERNANCE-REHEARSALS`, `APP-FIT-DECISION-MEMORY` and
`APP-FIT-ORGANIZATIONAL-TWIN`.

---

## Part 12 — Governance rehearsals

Phase 11 rehearsed the **system**: chaos experiments prove a fault is detected, contained, recovered
and verified. Nothing rehearsed the **people**. An escalation path never walked, a break-glass
authorisation nobody has exercised, a custody hand-over practised for the first time during a real
seizure — each is a procedure that exists on paper and has never met a human under time pressure.

> **The rehearsal is scored against what the document promised, not against what happened.**

An exercise that took four hours is not a success because everyone tried hard; it is a failure if the
runbook says thirty minutes. Every rehearsal declares its expectations **up front**, taken from the
documented procedure, and those expectations are **frozen onto the run** when it is scheduled — a
later edit to the catalogue cannot retroactively change what a past exercise was held to.

Six rehearsals: incident escalation · disaster recovery · emergency authorization · evidence custody
· legislative change · executive approval.

The after-action report checks timing against the document, missed steps, **steps observed out of
order**, and separation of duties inside the exercise itself — one person who assembles, reviews,
decides and records an approval fails, whatever the timings say.

Three properties worth naming:

- **An unobserved expectation is not met.** *"An expectation nobody recorded meeting is not met."*
- **A closed report cannot be edited.** An after-action report you can still add observations to is
  one that can be made to say anything.
- **Never-rehearsed is its own state and the worst one.** *"A procedure nobody has rehearsed is one
  whose first test will be a real incident."* It is reported separately from *failed*, because it is
  worse and easier to overlook.

Closing a rehearsal records participation, which is what makes training currency (Part 11) real
rather than a certificate.

---

## Part 9 — Decision memory

```
ADR → Implementation → Operational Outcome → Lessons Learned → Future ADRs → Improvement
```

The catalogue records what was decided and why. It does not record what **happened**. ADR-0005
predicted authorization caching would scale safely, and nothing in the repository connects that
prediction to whether it did.

Two rules keep this from becoming a self-congratulatory log:

- **An outcome must be evidenced.** "It worked" is not an outcome; a named control that holds is.
  An outcome citing evidence that never ran is recorded as **claimed**, not evidenced — and one
  claiming `as-predicted` while citing a **failing** control is reported as **contradicted**.
- **A decision with no recorded outcome is unevaluated, not successful.** The default state of every
  decision is that nobody has checked, and the report says so rather than letting silence read as
  success.

`too-early` and `mixed` are verdicts because most real outcomes are, and forcing a binary pushes
honest entries into the wrong box.

---

## Part 10 — The organizational twin

The twin modelled infrastructure and forgot that every one of those controls is exercised by a
person. An institution loses people far more often than it loses regions, and it had never rehearsed
that. Three scenarios join the twin:

| Scenario | Question |
|---|---|
| `owner-absence` | If these people are unavailable, which governance objects stop being owned? |
| `leadership-turnover` | If these offices change hands at once, what loses its authority **and its deputy** together? |
| `operational-overload` | If several incidents run at once, is there anybody left to authorise the next one? |

Turnover takes the office **and** its deputy — a new chair arrives with a new vice-chair — which is
what makes it different from a single absence.

**A deputy nobody has assessed does not cover anything.** The scenario takes a continuity assessment
from the caller rather than duplicating readiness evidence inside the twin: an absence covered by an
unassessed deputy is reported as uncovered, and the same absence covered by an assessed-ready deputy
comes out clean.

All three obey the Part 17 isolation property — the baseline digest is re-derived after every run.
