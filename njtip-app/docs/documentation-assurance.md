# Documentation Assurance (Phase 13, Parts 6–7)

Gated by `APP-FIT-DOCUMENTATION-ASSURANCE`. Live: `GET /api/architecture/documentation`.

Phase 12 checked that the runbook's API routes existed. That closed the sharpest gap and left
everything else: an ADR cross-reference to a decision never written, a documented `npm run` script
that no longer exists, a fitness identifier quoted in a governance document after the control was
renamed, a link to a file somebody deleted.

## The rule that keeps this from being decorative

> **An unparseable or unresolvable claim is a finding, not a skip.**

The obvious failure mode of a documentation checker is that its extractor quietly stops matching,
coverage reads 100%, and nothing has been verified for months. So the extractor's **own yield** is
checked: a governed document from which nothing can be extracted is reported, and a corpus below a
floor of 100 claims fails outright. The fitness function additionally asserts that each claim kind
still yields matches somewhere in the corpus.

## What is checked

| Claim | Resolved means | If wrong |
|---|---|---|
| `api-route` | A route in `src/server.js` matches, by literal or pattern | An operator calls it under pressure and gets a 404 |
| `npm-command` | The script is defined in `package.json` | The documented procedure cannot be followed at all |
| `adr-reference` | An ADR with that number exists | A decision is cited as authority, and it does not exist |
| `doc-link` | The target file exists | The reader is sent somewhere that is not there |
| `fitness-id` | A control of that identifier actually runs | A document claims a guarantee enforced by a control nobody runs |
| `source-module` | The file exists | A reader looking for the implementation cannot find it |

The corpus is **named, not globbed** — a glob would silently start checking scratch files, so scope is
a decision.

## What it does not claim to do

> A documented command is verified to **resolve** — the script exists — not to succeed. Nothing here
> runs a shell command, and claiming otherwise would be the same failure in the other direction.

## Part 7 — Operational procedures

A runbook that resolves every route it names can still be unfollowable. An `operational-procedure`
must carry: **prerequisites · permissions · recovery times · dependencies · escalation · rollback ·
communication**, each with a stated reason.

`operational-reference` is a separate role: documentation an operator reads to *understand*
something rather than to follow step by step. Holding reference material to a rollback-section
requirement trains people to add empty sections, which is worse than the gap.

And the caveat that keeps it honest:

> This checks that a document **carries** each element, not that the procedure succeeds. A rollback
> section that is wrong passes here and fails in an incident; only a rehearsal catches that.

## What it found on first run

Three real defects, fixed rather than excused:

- **`docs/enterprise-graph.md` documented `as-of/:instant`** against a route whose parameter is
  `(\d+)`. The checker's placeholder substitution only tried a word; it now tries a number too.
- **Two reference documents were misclassified** as operational procedures.
- **The runbook genuinely had no prerequisites section and no communication plan.** Both were
  written — an operational document that does not say who to tell is one where nobody is told.
