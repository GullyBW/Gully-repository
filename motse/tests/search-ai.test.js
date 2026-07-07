'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { AiProvider } = require('../src/ai/registry');
const { world, publishedItem } = require('./helpers');

describe('Search (§6.1) — restricted content fails closed', () => {
  test('public heritage is findable; members-only content never enters the index', () => {
    const w = world();
    publishedItem(w, { visibility: 'public', title: 'Dikgang tsa Tsodilo' });
    const restricted = publishedItem(w, { visibility: 'members', title: 'Sacred Tsodilo rites' });
    w.p.search.reindex();

    const out = w.p.search.search('tsodilo');
    expect(out.results.some((r) => r.type === 'heritage')).toBe(true);
    expect(JSON.stringify(out)).not.toContain(restricted.id);
    expect(JSON.stringify(out)).not.toContain('Sacred');
  });

  test('a custodian restriction drops an already-indexed item on the next event', () => {
    const w = world();
    const item = publishedItem(w, { visibility: 'public', title: 'Mokoro songs' });
    w.p.search.reindex();
    expect(w.p.search.search('mokoro').results).toHaveLength(1);

    const council = w.p.governance.createCouncil('bakalanga', w.admin.id);
    w.p.governance.grantSeat(council.id, { kind: 'association', holderRef: w.mma.id }, w.admin.id);
    // The validate event triggers the indexer resync — no manual reindex.
    w.p.heritage.validate(item.id, w.mma.id, { decision: 'restrict' });
    expect(w.p.search.search('mokoro').results).toHaveLength(0);
  });

  test('withdrawn items disappear from search on the withdrawal event', () => {
    const w = world();
    const item = publishedItem(w, { visibility: 'public', title: 'Phane harvest' });
    w.p.search.reindex();
    expect(w.p.search.search('phane').results).toHaveLength(1);
    w.p.heritage.withdraw(item.id, w.mma.id, 'narrator request');
    expect(w.p.search.search('phane').results).toHaveLength(0);
  });

  test('lessons derived from restricted sources are not searchable (inherited restriction)', () => {
    const w = world();
    const course = w.p.puo.createCourse(w.mma.id, { title: 'Ikalanga', language: 'ik', level: 'A1' });
    const publicSource = publishedItem(w, { visibility: 'public' });
    const restrictedSource = publishedItem(w, { visibility: 'members' });
    w.p.puo.deriveLesson(course.id, w.mma.id, { sourceItemRef: publicSource.id, level: 'A1' });
    const hiddenLesson = w.p.puo.deriveLesson(course.id, w.mma.id, {
      sourceItemRef: restrictedSource.id,
      level: 'A1',
    });
    w.p.search.reindex();
    const out = w.p.search.search('lesson a1', { types: ['lesson'] });
    expect(out.results).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain(hiddenLesson.id);
  });

  test('family circles are findable only by their own members', () => {
    const w = world();
    w.p.lelapa.createCircle(w.kabo.id, 'Ba ga Mokoena');
    w.p.search.reindex();
    expect(w.p.search.search('mokoena').results).toHaveLength(0); // anonymous
    expect(w.p.search.search('mokoena', { readerRef: w.mma.id }).results).toHaveLength(0); // outsider
    expect(w.p.search.search('mokoena', { readerRef: w.kabo.id }).results).toHaveLength(1); // member
  });

  test('villages, tourism, music, trusts and councils are indexed; prefix search works', () => {
    const w = world();
    w.p.mafelo.createPlace({ name: 'Tsodilo Hills', district: 'ngamiland', geo: { lat: 0, lng: 0 } });
    w.p.loeto.createExperience(w.mma.id, {
      title: 'Makgadikgadi walk',
      priceMinor: 100,
      splitTemplate: { name: 't', version: 1, shares: [{ account_id: w.mmaWallet.id, pct: 100 }] },
    });
    w.p.mmino.publishTrack(w.kabo.id, { title: 'Setapa grooves', mediaRef: 'med_x' });
    w.p.letlole.registerTrust(w.admin.id, {
      name: 'Khama Rhino Trust',
      deedDocRef: 'd',
      trustees: [w.admin.id, w.headman.id],
    });
    w.p.governance.createCouncil('bakalanga', w.admin.id);
    w.p.search.reindex();

    expect(w.p.search.search('tsodi').results[0].type).toBe('village'); // prefix
    expect(w.p.search.search('makgadikgadi').results[0].type).toBe('tourism');
    expect(w.p.search.search('setapa').results[0].type).toBe('music');
    expect(w.p.search.search('rhino').results[0].type).toBe('trust');
    expect(w.p.search.search('bakalanga', { types: ['council'] }).results).toHaveLength(1);
  });

  test('GET /v1/search serves anonymous and authenticated readers with the same rules', async () => {
    const w = world();
    const { app } = createApp(w.p);
    publishedItem(w, { visibility: 'public', title: 'Serowe stories' });
    publishedItem(w, { visibility: 'members', title: 'Serowe secrets' });
    w.p.search.reindex();
    const res = await request(app).get('/v1/search?q=serowe');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('secrets');

    const tooShort = await request(app).get('/v1/search?q=s');
    expect(tooShort.status).toBe(400);
  });
});

describe('AI foundation (extension points only)', () => {
  class StubTranscriber extends AiProvider {
    constructor() {
      super('stub-asr', 'transcription');
    }

    run(task) {
      return { transcript: `[transcribed ${task.media_refs.length} item(s)]`, language: 'tn' };
    }
  }

  test('unconfigured capabilities respond with NOT_FOUND, never a fake result', () => {
    const w = world();
    expect(w.p.ai.configured('transcription')).toBe(false);
    expect(() => w.p.ai.run('transcription', {}, w.admin.id)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
  });

  test('a registered provider runs over public content and the invocation is audited', () => {
    const w = world();
    w.p.ai.register(new StubTranscriber());
    const session = w.p.media.createUploadSession(w.mma.id, { type: 'audio', totalBytes: 2 });
    w.p.media.appendChunk(session.id, 0, 'ab');
    const media = w.p.media.completeUpload(session.id, {});
    const out = w.p.ai.run('transcription', { media_refs: [media.id] }, w.admin.id);
    expect(out.transcript).toContain('transcribed 1');
    expect(
      w.p.audit.chainFor('ai:stub-asr').some((e) => e.action === 'ai.transcription')
    ).toBe(true);
  });

  test('no_derivatives_no_training media NEVER reaches a provider (§6.4)', () => {
    const w = world();
    w.p.ai.register(new StubTranscriber());
    const session = w.p.media.createUploadSession(w.mma.id, {
      type: 'audio',
      mediaClass: 'restricted',
      totalBytes: 2,
    });
    w.p.media.appendChunk(session.id, 0, 'ab');
    const media = w.p.media.completeUpload(session.id, {});
    expect(() =>
      w.p.ai.run('transcription', { media_refs: [media.id] }, w.admin.id)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });

  test('restricted heritage refs fail the whole task, and the API surface lists capabilities', async () => {
    const w = world();
    w.p.ai.register(new StubTranscriber());
    const restricted = publishedItem(w, { visibility: 'members' });
    expect(() =>
      w.p.ai.run('transcription', { heritage_refs: [restricted.id] }, w.admin.id)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));

    const { app } = createApp(w.p);
    const res = await request(app).get('/v1/ai/capabilities');
    // Phase 2 ships local providers for translation/search/summarize/
    // tag/recommend by default; cloud transcription needs credentials —
    // here it's configured because the test registered a stub.
    expect(res.body.capabilities).toEqual(
      expect.arrayContaining([
        { capability: 'transcription', configured: true },
        { capability: 'translation', configured: true },
        { capability: 'recommendation', configured: true },
      ])
    );
    const fresh = createApp();
    const freshRes = await request(fresh.app).get('/v1/ai/capabilities');
    expect(freshRes.body.capabilities).toEqual(
      expect.arrayContaining([{ capability: 'transcription', configured: false }])
    );
  });
});
