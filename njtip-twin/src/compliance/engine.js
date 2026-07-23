'use strict';
// Compliance mapping engine: joins live fitness results to framework controls and
// produces an audit-ready, per-framework compliance view. A control is "evidenced"
// when its mapped fitness function currently passes.
const mappings = require('./mappings');

function mapCompliance(fitnessResults) {
  const byId = new Map(fitnessResults.map((r) => [r.id, r]));
  const controls = mappings.map((m) => {
    const r = byId.get(m.control);
    return { control: m.control, title: m.title, evidenced: r ? r.pass : false, present: !!r, frameworks: m.frameworks };
  });

  // Framework rollups.
  const frameworks = {};
  for (const c of controls) {
    for (const [fw, ids] of Object.entries(c.frameworks)) {
      frameworks[fw] = frameworks[fw] || { controlsMapped: 0, controlsEvidenced: 0, refs: new Set() };
      frameworks[fw].controlsMapped += 1;
      if (c.evidenced) frameworks[fw].controlsEvidenced += 1;
      ids.forEach((id) => frameworks[fw].refs.add(id));
    }
  }
  const frameworkSummary = Object.entries(frameworks).map(([fw, v]) => ({
    framework: fw, controlsMapped: v.controlsMapped, controlsEvidenced: v.controlsEvidenced,
    refs: [...v.refs].sort(),
    percent: v.controlsMapped ? Math.round((v.controlsEvidenced / v.controlsMapped) * 100) : 0,
  }));

  return {
    controls,
    frameworkSummary,
    summary: { totalControls: controls.length, evidenced: controls.filter((c) => c.evidenced).length },
    caveat: 'Illustrative control mapping for decision-support. A qualified assessor confirms applicability; this is not a compliance certification.',
  };
}

module.exports = { mapCompliance };
