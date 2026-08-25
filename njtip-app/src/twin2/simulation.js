'use strict';
// Digital Engineering Twin 2.0 (Phase 17) + Enterprise Resilience (Phase 24). Deterministic
// SIMULATIONS that let engineers reason about capacity, failure, recovery, deployment, and
// multi-region failover WITHOUT touching production. Pure functions over measured/declared
// inputs; every result is reproducible. These INFORM human decisions; they authorize nothing.

// Capacity forecasting: given a measured per-replica throughput and a target peak load, how
// many replicas are needed and does the configured HPA max cover it?
function capacityForecast({ perReplicaRps, targetPeakRps, hpaMax, headroom = 0.3 }) {
  const effective = perReplicaRps * (1 - headroom);          // reserve headroom
  const needed = Math.ceil(targetPeakRps / Math.max(1e-9, effective));
  return { perReplicaRps, targetPeakRps, headroom, replicasNeeded: needed, hpaMax, covered: needed <= hpaMax, note: covered(needed, hpaMax) };
}
function covered(n, max) { return n <= max ? 'HPA max covers the forecast peak' : 'FORECAST EXCEEDS HPA max — review capacity plan'; }

// Failure prediction: a transparent heuristic from error-budget burn rate + saturation.
function failurePrediction({ errorBudgetConsumed = 0, cpuSaturation = 0, latencyBurn = 0 }) {
  const score = Math.min(1, 0.5 * errorBudgetConsumed + 0.3 * cpuSaturation + 0.2 * latencyBurn);
  const risk = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';
  return { score: +score.toFixed(2), risk, method: 'transparent-heuristic', note: 'Not a model; informs human capacity/reliability decisions.' };
}

// Recovery / DR simulation: estimate whether RTO/RPO targets are met given backup cadence
// and failover time.
function recoverySimulation({ backupIntervalMs, failoverMs, rtoTargetMs, rpoTargetMs }) {
  const estimatedRpoMs = backupIntervalMs;                    // worst-case data loss window
  const estimatedRtoMs = failoverMs;                          // time to restore service
  return { estimatedRpoMs, estimatedRtoMs, rpoMet: estimatedRpoMs <= rpoTargetMs, rtoMet: estimatedRtoMs <= rtoTargetMs, pass: estimatedRpoMs <= rpoTargetMs && estimatedRtoMs <= rtoTargetMs };
}

// Deployment simulation: model a canary rollout across steps; abort if the simulated error
// rate exceeds the gate at any step (models a progressive-delivery guard).
function deploymentSimulation({ steps = [5, 25, 50, 100], simulatedErrorRate = 0, errorGate = 0.01 }) {
  const trace = [];
  for (const pct of steps) {
    const ok = simulatedErrorRate <= errorGate;
    trace.push({ trafficPct: pct, errorRate: simulatedErrorRate, ok });
    if (!ok) return { promoted: false, abortedAt: pct, trace, note: 'canary aborted — error gate exceeded (human decides rollback)' };
  }
  return { promoted: true, trace, note: 'canary healthy at every step — promotion is still a human decision' };
}

// Multi-region failover simulation: route around a failed region if quorum remains.
function failoverSimulation({ regions, failed = [] }) {
  const healthy = regions.filter((r) => !failed.includes(r));
  const quorum = healthy.length > regions.length / 2;
  return { regions, failed, healthy, quorum, activeActive: healthy.length >= 2, servedBy: quorum ? healthy : [], degraded: !quorum };
}

module.exports = { capacityForecast, failurePrediction, recoverySimulation, deploymentSimulation, failoverSimulation };
