'use strict';

/**
 * Edge-branch exercises for Phase-2 components: default arguments,
 * alternate constructor options, and failure paths that the main
 * behavioural suites don't reach. Everything here is still asserting
 * real behaviour — no test exists only to touch a line.
 */
const { world, adminUser } = require('./helpers');
const { createPlatform } = require('../src/container');
const { sha256 } = require('../src/kernel/ids');
const {
  TfIdfSemanticSearchProvider,
  ExtractiveSummarizerProvider,
  MetadataTaggerProvider,
  CooccurrenceRecommenderProvider,
  PhraseTranslatorProvider,
  tokenize,
} = require('../src/ai/providers/local');
const { CloudSpeechToTextProvider, CloudTranslationProvider } = require('../src/ai/providers/cloud');
const { PilotService } = require('../src/pilot/pilot.service');

describe('AI local providers — edge branches', () => {
  test('tokenizer handles null/empty; semantic search honours limit', () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize('')).toEqual([]);
    const search = new TfIdfSemanticSearchProvider();
    const documents = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, text: `pula story ${i}` }));
    const out = search.run({ query: 'pula', documents, limit: 2 });
    expect(out.results.length).toBeLessThanOrEqual(2);
  });

  test('summarizer: no sentence punctuation falls back to whole text; empty text throws', () => {
    const summarizer = new ExtractiveSummarizerProvider();
    const out = summarizer.run({ text: 'no punctuation here just words' });
    expect(out.summary).toContain('no punctuation');
    expect(() => summarizer.run({ text: '   ' })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });

  test('tagger: default entity list, custom max_tags, empty text throws', () => {
    const tagger = new MetadataTaggerProvider();
    const out = tagger.run({ text: 'cattle cattle rain rain rain harvest', max_tags: 2 });
    expect(out.tags).toHaveLength(2);
    expect(out.entities).toEqual([]);
    expect(() => tagger.run({ text: '' })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });

  test('recommender: for_item seeding and duplicate record()s', () => {
    const recommender = new CooccurrenceRecommenderProvider();
    recommender.record('u1', 'a');
    recommender.record('u1', 'a'); // set semantics
    recommender.record('u1', 'b');
    recommender.record('u2', 'a');
    const out = recommender.run({ for_item: 'a', limit: 1 });
    expect(out.recommendations[0].item).toBe('b');
  });

  test('translator: default direction tn→en; punctuation stripped; missing text throws', () => {
    const translator = new PhraseTranslatorProvider();
    const out = translator.run({ text: 'Pula!!!' });
    expect(out.translation).toBe('rain');
    expect(out.from).toBe('tn');
    expect(() => translator.run({})).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });

  test('cloud adapters: custom endpoints, default transport refuses, error branches', () => {
    const speech = new CloudSpeechToTextProvider({ apiKey: 'k', endpoint: 'https://alt/speech' });
    expect(speech.endpoint).toBe('https://alt/speech');
    expect(() => speech.run({ audio_base64: 'x' })).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }) // default transport
    );
    expect(() => speech.run({})).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));

    const translate = new CloudTranslationProvider({
      apiKey: 'k',
      endpoint: 'https://alt/translate',
      transport: { post: () => ({ data: { translations: [] } }) },
    });
    expect(() => translate.run({ text: 'x' })).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }) // provider returned nothing
    );
    expect(() => translate.run({})).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => new CloudTranslationProvider({})).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    // Missing-confidence branch normalises to null.
    const noConfidence = new CloudSpeechToTextProvider({
      apiKey: 'k',
      transport: { post: () => ({ results: [{ alternatives: [{ transcript: 'x' }] }] }) },
    });
    expect(noConfidence.run({ audio_base64: 'x' }).confidence).toBeNull();
  });
});

describe('Integrations — edge branches', () => {
  test('gis zoom default; ICS without optional fields; calendar defaults', () => {
    const w = world();
    const gis = w.p.integrations.get('gis');
    expect(gis.staticMapUrl({ lat: 1, lng: 2 })).toContain('zoom=12');
    expect(gis.staticMapUrl({ lat: 1, lng: 2 }, 8)).toContain('zoom=8');
    const calendar = w.p.integrations.get('calendar');
    const { ics } = calendar.createEvent({
      title: 'Bare event',
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T01:00:00.000Z',
    });
    expect(ics).not.toContain('LOCATION');
    expect(ics).not.toContain('DESCRIPTION');
    expect(ics).toContain('SUMMARY:Bare event');
  });
});

describe('Ops & backups — failure paths', () => {
  test('acknowledge is only valid from open; timeline notes append; state filter works', () => {
    const w = world();
    const admin = adminUser(w.p);
    const incident = w.p.ops.openIncident(
      { severity: 'sev3', title: 'drill', source: 'drill:2' }, admin.id
    );
    w.p.ops.addTimelineNote(incident.id, admin.id, 'investigating');
    w.p.ops.acknowledgeIncident(incident.id, admin.id);
    expect(() => w.p.ops.acknowledgeIncident(incident.id, admin.id)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    expect(w.p.ops.listIncidents({ state: 'acknowledged' })).toHaveLength(1);
    expect(w.p.ops.listIncidents({ state: 'resolved' })).toHaveLength(0);
    expect(() => w.p.ops.acknowledgeIncident('inc_none', admin.id)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
  });

  test('tampered ledger balances break the manifest; restore reports balance mismatches', () => {
    const w = world();
    const summary = w.p.backups.snapshot(w.p);
    const backup = w.p.backups.get(summary.id);
    // Tamper with balances only → the manifest checksum catches it.
    backup.ledger_balances[0][1] += 1;
    const verification = w.p.backups.verify(summary.id);
    expect(verification.valid).toBe(false);
    expect(verification.failures).toContain('manifest');

    // Forge a "consistent-looking" backup (checksums recomputed) whose
    // stored balances disagree with its own postings — restore rebuilds
    // from postings and REPORTS the mismatch instead of trusting it.
    const summary2 = w.p.backups.snapshot(w.p);
    const backup2 = w.p.backups.get(summary2.id);
    backup2.ledger_balances = backup2.ledger_balances.map(([id, v], i) =>
      i === 0 ? [id, v + 500] : [id, v]
    );
    backup2.manifest_checksum = sha256(
      JSON.stringify(backup2.checksums) + sha256(JSON.stringify(backup2.ledger_balances))
    );
    const result = w.p.backups.restore(summary2.id, createPlatform());
    expect(result.balance_mismatches.length).toBeGreaterThan(0);
    expect(result.success).toBe(false);
  });
});

describe('Pilot & flags — remaining branches', () => {
  test('registerVillage without a headman msisdn; report without analytics bound', () => {
    const w = world();
    const admin = adminUser(w.p);
    const pilot = w.p.pilots.create({ name: 'P', district: 'kgatleng' }, admin.id);
    const { village, ward } = w.p.pilots.registerVillage(pilot.id, { name: 'Oodi' }, admin.id);
    expect(village.headman_ref).toBeNull();
    expect(ward.name).toBe('Oodi');

    const bare = new PilotService({
      store: w.p.store, clock: w.p.clock, identity: w.p.identity,
      kgotla: w.p.kgotla, flags: w.p.flags, audit: w.p.audit, bus: w.p.bus,
    });
    // Without analytics the report still generates, usage is null.
    const report = bare.report(pilot.id);
    expect(report.usage).toBeNull();
    // Duplicate admin assignment is a no-op.
    w.p.pilots.assignAdmin(pilot.id, admin.id, admin.id);
    w.p.pilots.assignAdmin(pilot.id, admin.id, admin.id);
    expect(w.p.pilots.get(pilot.id).admins).toHaveLength(1);
  });

  test('flags: config kind definition round-trips; snapshot for an unknown user id', () => {
    const w = world();
    const admin = adminUser(w.p);
    const def = w.p.flags.define('config.pack_max_mb', {
      description: 'Offline pack size cap',
      defaultValue: 64,
      kind: 'config',
    });
    expect(def.kind).toBe('config');
    w.p.flags.set('config.pack_max_mb', 'global', 32, admin.id);
    const snapshot = w.p.flags.snapshotFor(w.p.identity, 'usr_ghost'); // unknown user
    expect(snapshot['config.pack_max_mb']).toBe(32);
    expect(w.p.flags.list().find((f) => f.key === 'config.pack_max_mb').overrides).toHaveLength(1);
  });
});

describe('Assurance — remaining branches', () => {
  test('5xx responses are not abuse; geo-less and first-geo logins do not trip travel', () => {
    const w = world();
    for (let i = 0; i < 50; i += 1) w.p.assurance.recordApiOutcome('srv', 502);
    expect(w.p.assurance.isBlocked('srv')).toBe(false);

    w.p.assurance.recordLogin(w.kabo.id, { deviceId: 'd0' }); // no geo at all
    w.p.assurance.recordLogin(w.kabo.id, { deviceId: 'd0', geo: { lat: -24, lng: 25 } }); // first geo
    expect(w.p.assurance.listEvents({ type: 'impossible_travel' })).toHaveLength(0);
  });

  test('device risk: shared devices and active holds add to the score', () => {
    const w = world();
    for (let i = 0; i < 4; i += 1) {
      w.p.assurance.recordLogin(`usr_share_${i}`, { deviceId: 'family-phone' });
    }
    w.p.clock.advance(48 * 3600 * 1000); // device is no longer "new"
    w.p.assurance.placeHold('usr_share_0', 'test');
    const risk = w.p.assurance.deviceRisk('usr_share_0', 'family-phone');
    expect(risk.reasons).toEqual(
      expect.arrayContaining(['account under security hold', 'device shared by 4 accounts'])
    );
    // Rotation policy on an unknown secret fails loudly.
    expect(() => w.p.assurance.setRotationPolicy('secret:ghost', 30)).toThrow();
  });
});
