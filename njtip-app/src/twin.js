'use strict';
// Bridge to the Digital Engineering Twin's VALIDATED domain modules. The product
// (v1.0 MVP) reuses these as its initial (reference) implementation; the component
// transition matrix (docs/component-transition-matrix.md) governs their replacement
// with production-grade implementations. The Twin remains the assurance layer:
// every architectural invariant these modules embody is continuously verified.
const T = '../../njtip-twin/src';
module.exports = {
  ZONES: require(`${T}/zones`).ZONES,
  ReportStore: require(`${T}/model/report-store`).ReportStore,
  IdentityMinimizationError: require(`${T}/model/report-store`).IdentityMinimizationError,
  EvidenceStore: require(`${T}/model/evidence-store`).EvidenceStore,
  AuditLog: require(`${T}/model/audit-log`).AuditLog,
  IAM: require(`${T}/model/iam`).IAM,
  ThresholdCustody: require(`${T}/model/governance`).ThresholdCustody,
  RecipientDirectory: require(`${T}/model/governance`).RecipientDirectory,
  PolicyEngine: require(`${T}/policy/policy-engine`).PolicyEngine,
  GovernanceLedger: require(`${T}/governance/portal`).GovernanceLedger,
  signing: require(`${T}/evidence/signing`),
  crypto: require(`${T}/platform/crypto`),
  hash: require(`${T}/util/hash`),
  rng: require(`${T}/util/rng`),
};
