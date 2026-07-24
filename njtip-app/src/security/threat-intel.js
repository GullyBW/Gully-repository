'use strict';
// Threat Intelligence Platform (Phase 36). Extends Zero Trust with threat feeds, IOC
// management, device/credential risk intelligence, behavioural analytics, threat
// correlation, and a security-recommendation engine. Threat intelligence ENRICHES trust
// scores but NEVER overrides human governance — recommendations are advisory. Deterministic.
//
// Indicators are OPAQUE and non-identifying (hashes, opaque device/credential ids) — no
// personal data participates.
class ThreatFeed {
  constructor() { this._iocs = new Map(); } // indicator -> { type, severity, since }
  ingest(indicators = []) { for (const i of indicators) this._iocs.set(i.indicator, { type: i.type, severity: i.severity || 'medium', since: i.since || 0 }); return this._iocs.size; }
  match(indicator) { const i = this._iocs.get(indicator); return i ? { indicator, ...i, hit: true } : { indicator, hit: false }; }
  size() { return this._iocs.size; }
}

// Device risk from posture signals (opaque device id, non-identifying posture).
function deviceRisk({ jailbroken = false, patched = true, knownBadDevice = false } = {}) {
  let risk = 0; const reasons = [];
  if (jailbroken) { risk += 40; reasons.push('jailbroken/rooted'); }
  if (!patched) { risk += 30; reasons.push('missing security patches'); }
  if (knownBadDevice) { risk += 30; reasons.push('device on threat feed'); }
  return { risk: Math.min(100, risk), band: risk >= 60 ? 'high' : risk >= 30 ? 'medium' : 'low', reasons };
}

// Credential risk: reuse/weakness against a synthetic breach set (opaque credential hashes).
function credentialRisk(credentialHash, breachedHashes = new Set()) {
  const breached = breachedHashes.has(credentialHash);
  return { risk: breached ? 90 : 0, breached, reason: breached ? 'credential appears in a breach corpus' : 'not seen in breach corpus' };
}

// Behavioural analytics: flag anomalous access rate / off-hours access (opaque principal id).
function behavioralAnomaly({ requestsPerMin = 0, hourOfDay = 12, baselinePerMin = 10 } = {}) {
  const reasons = []; let score = 0;
  if (requestsPerMin > baselinePerMin * 5) { score += 50; reasons.push('request rate >5x baseline'); }
  if (hourOfDay < 5 || hourOfDay > 23) { score += 20; reasons.push('off-hours access'); }
  return { anomalyScore: Math.min(100, score), anomalous: score >= 50, reasons };
}

// Trust-score enrichment: threat intel LOWERS a base trust score but is BOUNDED — it cannot
// grant trust, and it never authorizes; the human governance model still applies.
function enrichTrust(baseScore, { deviceRisk = 0, credentialRisk = 0, anomalyScore = 0 } = {}) {
  const penalty = Math.round(0.4 * deviceRisk + 0.4 * credentialRisk + 0.2 * anomalyScore);
  const enriched = Math.max(0, Math.min(baseScore, baseScore - penalty)); // can only lower
  return { baseScore, penalty, enrichedScore: enriched, note: 'Threat intel can only reduce trust; it never grants it and never overrides human governance.' };
}

// Threat correlation: fold multiple signals into a single advisory incident.
function correlate(signals = []) {
  const high = signals.filter((s) => (s.risk || s.anomalyScore || 0) >= 60);
  if (!high.length) return { incident: false };
  return { incident: true, severity: high.length >= 2 ? 'critical' : 'high', signals: high, advisoryOnly: true, note: 'Advisory correlation — response is a human decision.' };
}

// Security recommendation engine (advisory only).
function recommend(context = {}) {
  const recs = [];
  if (context.deviceRiskBand === 'high') recs.push({ action: 'require-device-remediation', rationale: 'device risk high' });
  if (context.credentialBreached) recs.push({ action: 'force-credential-rotation', rationale: 'credential in breach corpus' });
  if (context.anomalous) recs.push({ action: 'step-up-authentication', rationale: 'behavioural anomaly' });
  return { recommendations: recs, advisoryOnly: true, autonomous: false, note: 'Advisory — a human applies or rejects each recommendation.' };
}

module.exports = { ThreatFeed, deviceRisk, credentialRisk, behavioralAnomaly, enrichTrust, correlate, recommend };
