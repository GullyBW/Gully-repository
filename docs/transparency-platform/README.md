# Botswana National Transparency & Integrity Platform (BNTIP) — Blueprint

An implementation-ready **Enterprise Architecture & Governance Blueprint** for a secure,
privacy-preserving platform that lets citizens confidentially report suspected corruption
and integrity issues in Botswana's justice sector — designed to later expand into a full
National Transparency Platform.

> This blueprint is produced in **batches**. The design mandate requires the threat model
> to be **validated by the client before any architecture, governance, or roadmap is
> written**. **Batch 1 (Foundations) is delivered below and the blueprint deliberately stops
> at a Confirmation Checkpoint.**

## Batch 1 — Foundations (delivered)

| # | Document | Contents |
|---|----------|----------|
| 00 | [Master Index](./00-master-index.md) | Reading guide, delivery contract, 26-item coverage map, conventions, non-negotiable constraints |
| 01 | [Assumptions Register](./01-assumptions-register.md) | 30 legal/technical/governance/operational/financial/organizational assumptions with confidence, impact-if-wrong, validation owner |
| 02 | [Threat Model (STRIDE + LINDDUN)](./02-threat-model-stride-linddun.md) | Assets, threat actors, trust assumptions, 23 STRIDE + 13 LINDDUN threats with risk ratings, mitigations, residual risk |
| 03 | [Threat Model Validation → ⛔ Confirmation Checkpoint](./03-threat-model-validation-checkpoint.md) | Top risks, high-impact assumptions, named tensions, and **7 questions to answer before Batch 2** |

## What happens next

Batches 2–6 (Governance & Trust → Security & System Architecture → Product & Workflow →
Legal/Compliance/Risk → Delivery & Sustainability) are **blocked pending your answers at the
[Confirmation Checkpoint](./03-threat-model-validation-checkpoint.md#36--confirmation-checkpoint--decisions-requested-of-you).**

## Design commitments carried through every section

- Reporter safety above convenience · Privacy & Security by Design · Zero Trust · Least
  Privilege · Defense in Depth.
- **The operator is inside the threat model** — no single party can de-anonymize a reporter.
- **Confidential reporting is separated from public disclosure**; no individually
  identifying allegations are published.
- **Human verification over automated judgment** — AI never decides guilt or truth.
- **Honesty over false confidence** — residual risks are stated plainly, and anonymity-,
  cryptography-, evidence-, and metadata-critical subsystems are flagged
  `🔒 HUMAN-EXPERT-REVIEW-REQUIRED` before implementation.

_All financials will be presented in Botswana Pula (BWP) primary, USD secondary. Every legal
statement requires confirmation by an admitted Botswana attorney before deployment._
