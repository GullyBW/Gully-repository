'use strict';
// Maps twin controls (fitness functions) to external framework control IDs.
// Illustrative, engineering-level mapping — a qualified assessor confirms
// applicability (control mapping is decision-support, not a compliance ruling).
module.exports = [
  { control: 'FIT-IDENTITY-MINIMIZATION', title: 'Data minimization / no identity', frameworks: {
    'ISO-27001': ['A.8.11 Data masking'], 'ISO-27701': ['7.4.4 Minimize'], 'NIST-CSF': ['PR.DS-5'], 'NIST-800-53': ['SC-28', 'PM-25'], 'CIS': ['CIS 3'], 'OWASP-ASVS': ['V8.1'] } },
  { control: 'FIT-ENCRYPTION', title: 'Encryption at rest', frameworks: {
    'ISO-27001': ['A.8.24 Cryptography'], 'NIST-CSF': ['PR.DS-1'], 'NIST-800-53': ['SC-28'], 'CIS': ['CIS 3.11'], 'OWASP-ASVS': ['V6.2'] } },
  { control: 'FIT-ZONE-ISOLATION', title: 'Network/data segmentation', frameworks: {
    'ISO-27001': ['A.8.22 Segregation of networks'], 'NIST-CSF': ['PR.AC-5'], 'NIST-800-53': ['SC-7', 'AC-4'], 'CIS': ['CIS 12'], 'OWASP-ASVS': ['V1.1'] } },
  { control: 'FIT-SECURE-DATA-FLOWS', title: 'Secure information transfer', frameworks: {
    'ISO-27001': ['A.5.14 Information transfer'], 'NIST-CSF': ['PR.DS-2'], 'NIST-800-53': ['AC-4', 'SC-8'], 'OWASP-ASVS': ['V13'] } },
  { control: 'FIT-LEAST-PRIVILEGE', title: 'Least privilege / access rights', frameworks: {
    'ISO-27001': ['A.8.2 Privileged access rights'], 'NIST-CSF': ['PR.AC-4'], 'NIST-800-53': ['AC-6'], 'CIS': ['CIS 6'], 'OWASP-ASVS': ['V4.1'] } },
  { control: 'FIT-ZERO-TRUST', title: 'Authentication / continuous verification', frameworks: {
    'ISO-27001': ['A.8.5 Secure authentication'], 'NIST-CSF': ['PR.AC-7'], 'NIST-800-53': ['IA-2', 'AC-3'], 'CIS': ['CIS 6'], 'OWASP-ASVS': ['V2.1'] } },
  { control: 'FIT-POLICY-ENFORCEMENT', title: 'Access enforcement (default-deny)', frameworks: {
    'ISO-27001': ['A.8.3 Information access restriction'], 'NIST-CSF': ['PR.PT-3'], 'NIST-800-53': ['AC-3'], 'OWASP-ASVS': ['V4.1'] } },
  { control: 'FIT-AUDITABILITY', title: 'Logging / tamper-evident audit', frameworks: {
    'ISO-27001': ['A.8.15 Logging'], 'NIST-CSF': ['PR.PT-1', 'DE.AE-3'], 'NIST-800-53': ['AU-9', 'AU-10'], 'CIS': ['CIS 8'], 'OWASP-ASVS': ['V7'] } },
  { control: 'FIT-CHAIN-OF-CUSTODY', title: 'Evidence integrity', frameworks: {
    'ISO-27001': ['A.5.28 Collection of evidence'], 'NIST-800-53': ['AU-10', 'SI-7'], 'NIST-CSF': ['PR.DS-6'] } },
  { control: 'FIT-GOVERNANCE', title: 'Segregation of duties / dual control', frameworks: {
    'ISO-27001': ['A.5.3 Segregation of duties'], 'NIST-CSF': ['PR.AC-4'], 'NIST-800-53': ['AC-5'], 'CIS': ['CIS 6'] } },
  { control: 'FIT-EMERGENCY', title: 'Emergency access management', frameworks: {
    'ISO-27001': ['A.8.2'], 'NIST-800-53': ['AC-6(9)', 'CP-2'], 'NIST-CSF': ['PR.AC-4'] } },
  { control: 'FIT-BACKUP', title: 'Backup', frameworks: {
    'ISO-27001': ['A.8.13 Information backup'], 'NIST-CSF': ['PR.IP-4', 'RC.RP-1'], 'NIST-800-53': ['CP-9'], 'CIS': ['CIS 11'] } },
  { control: 'FIT-TIME-INTEGRITY', title: 'Clock synchronization', frameworks: {
    'ISO-27001': ['A.8.17 Clock synchronization'], 'NIST-800-53': ['AU-8'], 'NIST-CSF': ['PR.PT-1'] } },
];
