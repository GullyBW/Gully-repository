'use strict';
// Legislative Impact Analysis (Stabilization Part 7). Extends the legislative registry with
// the analysis a legal change actually needs before enactment: a TRANSITIVE regulatory
// dependency graph, policy impact analysis, service dependency mapping, FITNESS-FUNCTION
// impact assessment, diffable regulatory version history, change SIMULATION and obsolete-policy
// detection.
//
// Deterministic. Every output is ADVISORY: a legal change is fully simulatable before human
// enactment, and nothing here enacts, amends or repeals anything.
class LegislativeImpactAnalyzer {
  constructor(registry) { if (!registry) throw new Error('a legislative registry is required'); this._reg = registry; }

  // --- Regulatory dependency graph ------------------------------------------------------

  graph() { return this._reg.dependencyGraph(); }
  // Everything `id` depends on, transitively (what a change to id must respect).
  ancestors(id) {
    const g = this.graph(); const seen = new Set(); const walk = (n) => { for (const dep of g[n] || []) if (!seen.has(dep)) { seen.add(dep); walk(dep); } };
    walk(id); return [...seen].sort();
  }
  // Everything that depends on `id`, transitively (what a change to id will reach).
  descendants(id) {
    const g = this.graph(); const seen = new Set();
    const walk = (n) => { for (const [other, deps] of Object.entries(g)) if (deps.includes(n) && !seen.has(other)) { seen.add(other); walk(other); } };
    walk(id); return [...seen].sort();
  }
  // A cycle between legal instruments is an authoring error, not a legal construct.
  cycles() {
    const g = this.graph(); const found = []; const state = {};
    const walk = (n, stack) => {
      if (state[n] === 'done') return;
      if (state[n] === 'open') { found.push([...stack.slice(stack.indexOf(n)), n]); return; }
      state[n] = 'open'; stack.push(n);
      for (const next of g[n] || []) walk(next, stack);
      stack.pop(); state[n] = 'done';
    };
    for (const id of Object.keys(g)) walk(id, []);
    return found;
  }

  // --- Policy, service and control impact -------------------------------------------------

  // Transitive policy impact: every instrument, system and control a change to `id` reaches.
  policyImpact(id) {
    const direct = this._reg.impact(id);
    const reached = this.descendants(id);
    const systems = new Set(direct.affectedSystems);
    const controls = new Set(direct.affectedControls);
    for (const other of reached) { const d = this._reg.describe(other); for (const s of d.mapsToSystems) systems.add(s); for (const c of d.mapsToControls) controls.add(c); }
    return {
      instrument: id,
      directInstruments: direct.affectedInstruments,
      transitiveInstruments: reached,
      affectedSystems: [...systems].sort(),
      affectedControls: [...controls].sort(),
      breadth: reached.length + systems.size + controls.size,
      advisoryOnly: true,
      note: 'Advisory impact analysis. Enactment remains a decision of the responsible legal authority.',
    };
  }

  // Service dependency map: system → the instruments that govern it (and their status).
  serviceDependencyMap() {
    const out = {};
    for (const i of this._reg.registryList()) for (const s of i.mapsToSystems) {
      (out[s] = out[s] || []).push({ instrument: i.id, status: i.status, controls: i.mapsToControls });
    }
    for (const s of Object.keys(out)) out[s].sort((a, b) => a.instrument.localeCompare(b.instrument));
    return out;
  }

  // Fitness-function impact: which controls an instrument mandates and how they stand right
  // now. A mandated control that no fitness function implements is a compliance gap.
  fitnessImpact(id, fitnessResults = []) {
    const known = new Map(fitnessResults.map((r) => [r.id, r.pass]));
    const impact = this.policyImpact(id);
    const controls = impact.affectedControls.map((control) => ({
      control,
      implemented: known.has(control),
      holding: known.get(control) ?? null,
    }));
    return {
      instrument: id, controls,
      unimplemented: controls.filter((c) => !c.implemented).map((c) => c.control),
      failing: controls.filter((c) => c.implemented && c.holding === false).map((c) => c.control),
      note: 'A mandated control with no fitness function is a compliance gap; a failing one is a live breach of the mandate.',
    };
  }

  // --- Version history & diffs ------------------------------------------------------------

  // Regulatory version history with a diff of the control/system mappings per version.
  versionHistory(id) {
    const versions = this._reg.history(id);
    const rows = versions.map((v, idx) => {
      const prev = idx ? versions[idx - 1] : null;
      const diff = prev ? {
        controlsAdded: (v.mapsToControls || []).filter((c) => !(prev.mapsToControls || []).includes(c)),
        controlsRemoved: (prev.mapsToControls || []).filter((c) => !(v.mapsToControls || []).includes(c)),
        systemsAdded: (v.mapsToSystems || []).filter((s) => !(prev.mapsToSystems || []).includes(s)),
        systemsRemoved: (prev.mapsToSystems || []).filter((s) => !(v.mapsToSystems || []).includes(s)),
      } : null;
      return { version: v.version, summary: v.summary, mapsToControls: v.mapsToControls || [], mapsToSystems: v.mapsToSystems || [], diff, weakening: !!(diff && (diff.controlsRemoved.length || diff.systemsRemoved.length)) };
    });
    return { instrument: id, versions: rows, weakeningAmendments: rows.filter((r) => r.weakening).map((r) => r.version) };
  }

  // --- Change simulation --------------------------------------------------------------------

  // Simulate a proposed amendment BEFORE enactment: the registry's compatibility verdict plus
  // transitive reach, live control state and an explainable risk band.
  simulateChange(id, { proposedControls = null, proposedSystems = null, fitnessResults = [] } = {}) {
    const base = this._reg.simulate(id, { proposedControls, proposedSystems });
    const impact = this.policyImpact(id);
    const fitness = this.fitnessImpact(id, fitnessResults);
    const removed = base.compatibility.removedControls.length + base.compatibility.removedSystems.length;
    const reasons = [];
    if (base.compatibility.removedControls.length) reasons.push(`removes ${base.compatibility.removedControls.length} mandated control(s)`);
    if (base.compatibility.removedSystems.length) reasons.push(`removes ${base.compatibility.removedSystems.length} governed system(s)`);
    if (impact.transitiveInstruments.length) reasons.push(`reaches ${impact.transitiveInstruments.length} dependent instrument(s)`);
    if (fitness.unimplemented.length) reasons.push(`${fitness.unimplemented.length} mandated control(s) have no fitness function`);
    const score = removed * 2 + impact.transitiveInstruments.length + fitness.unimplemented.length;
    return {
      instrument: id,
      compatibility: base.compatibility,
      impact, fitness,
      risk: { band: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low', score, reasons: reasons.length ? reasons : ['no controls or systems removed; no dependents reached'] },
      simulatable: true, advisoryOnly: true, enacts: false,
      note: 'Every legal change is fully simulatable before implementation. Simulation never enacts.',
    };
  }

  // --- Obsolete policy detection ----------------------------------------------------------

  // Instruments that no longer make sense as they stand. Each finding names WHY.
  obsolete({ fitnessResults = [] } = {}) {
    const known = new Set(fitnessResults.map((r) => r.id));
    const findings = [];
    const all = this._reg.registryList();
    for (const i of all) {
      if (i.status === 'repealed' && i.mapsToSystems.length) findings.push({ instrument: i.id, reason: 'repealed but still mapped to live systems', detail: i.mapsToSystems, severity: 'high' });
      if (i.status === 'repealed' && all.some((o) => o.status !== 'repealed' && o.dependsOn.includes(i.id))) findings.push({ instrument: i.id, reason: 'repealed but an in-force instrument still depends on it', severity: 'high' });
      if (i.status !== 'repealed' && !i.mapsToSystems.length && !i.mapsToControls.length) findings.push({ instrument: i.id, reason: 'in the register but governs no system and mandates no control', severity: 'medium' });
      if (known.size) for (const c of i.mapsToControls) if (!known.has(c)) findings.push({ instrument: i.id, reason: 'mandates a control that no fitness function implements', detail: c, severity: 'medium' });
      if (i.status === 'draft' && all.some((o) => o.id !== i.id && o.title === i.title)) findings.push({ instrument: i.id, reason: 'draft duplicates the title of another instrument', severity: 'low' });
    }
    return { findings, clean: findings.filter((f) => f.severity === 'high').length === 0, note: 'Advisory. Repeal and amendment remain decisions of the responsible legal authority.' };
  }

  // --- Consolidated report -----------------------------------------------------------------

  report({ fitnessResults = [] } = {}) {
    const instruments = this._reg.registryList();
    return {
      instruments,
      dependencyGraph: this.graph(),
      cycles: this.cycles(),
      serviceDependencyMap: this.serviceDependencyMap(),
      impact: Object.fromEntries(instruments.map((i) => [i.id, this.policyImpact(i.id)])),
      fitnessImpact: Object.fromEntries(instruments.map((i) => [i.id, this.fitnessImpact(i.id, fitnessResults)])),
      obsolete: this.obsolete({ fitnessResults }),
      advisoryOnly: true, enacts: false,
      note: 'Legislative impact analysis. Simulatable before enactment; enactment is always a human legal decision.',
    };
  }
}

module.exports = { LegislativeImpactAnalyzer };
