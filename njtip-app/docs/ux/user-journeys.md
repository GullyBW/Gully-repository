# UX (Part 7) — Journeys, Wireframes, Accessibility

Interfaces stay **simple despite architectural complexity**. The runnable prototype is
[`ui/index.html`](../../ui/index.html) (tabbed, theme-aware, keyboard-navigable, responsive, zero
external assets).

## Primary users & journeys
| User | Goal | Journey (prototype tab) |
|------|------|-------------------------|
| **Citizen** | Report safely, anonymously | Read honest banner → pick category → describe (guidance: don't name yourself) → submit → receive case code → (optional) check status / attach evidence. **No identity is requested; identity fields are rejected.** |
| **Investigator** | Review a routed report | Authenticate (JIT/FIDO2) → open case by code → record disposition (reviewed/escalate). Sees case, not reporter identity (there is none). |
| **Oversight Board** | See system health, not cases | Open dashboard → non-attributable aggregates (counts by status, integrity). No case content. |
| **Auditor** | Verify integrity | Generate evidence bundle → independently verify digest + signature + audit chain (Twin `verify-evidence`). |
| **Administrator** | Operate safely | Zero standing privilege; break-glass is dual-controlled + audited (no UI shortcut). |
| **Governance Official** | Record a decision | Authenticate → enter reviewer + subject + verdict + **rationale (required)** → record. The system **records**, never decides. |

## Wireframe descriptions
- **Citizen:** single-column form; prominent honest-risk banner; category dropdown; large textarea;
  one clear "Submit anonymously" action; result shows case code + routed recipient + CoI status.
- **Investigator/Governance:** token + case/decision fields; single primary action; JSON result panel.
- **Oversight:** one "Refresh aggregates" action; aggregate tiles only.
- **Assurance:** "Validate architecture" + "Generate evidence" actions surfacing Twin results in-product.

## Accessibility review
- Semantic landmarks (`nav[role=tablist]`, `section`, labelled inputs); `aria-selected` on tabs;
  visible focus; sufficient contrast in light **and** dark (`prefers-color-scheme`); no color-only
  signals; keyboard operable; responsive to `width=device-width`. Target: WCAG 2.1 AA (formal audit +
  low-literacy/Setswana testing in a later increment — blueprint phase3/04).

## Responsive layout
Single fluid column, `max-width` container, relative units; works phone → desktop; no horizontal
scroll. Offline-capable PWA client is a v1.x transition item.

## Honesty in the UX (safety control)
Every screen states: synthetic MVP; evidence supports — never replaces — human decisions; and (citizen
tab) that no identifying data is collected and the reporter should avoid self-identifying in content.
