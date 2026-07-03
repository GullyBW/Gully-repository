'use strict';

const { world, publishedItem } = require('./helpers');
const {
  CloudSpeechToTextProvider,
  CloudTranslationProvider,
} = require('../src/ai/providers/cloud');

describe('Production AI providers (WS8) — local, in-process, deterministic', () => {
  test('semantic search ranks by TF-IDF cosine relevance', () => {
    const w = world();
    const out = w.p.ai.run('knowledge_search', {
      query: 'rock paintings at tsodilo',
      documents: [
        { id: 'a', text: 'The rock paintings of Tsodilo hills tell the story of the ancestors' },
        { id: 'b', text: 'Sorghum harvest songs from the lands' },
        { id: 'c', text: 'Tsodilo is a sacred place of rock art and painting traditions' },
      ],
    }, w.admin.id);
    expect(out.results[0].id).not.toBe('b');
    expect(out.results.map((r) => r.id)).toEqual(expect.arrayContaining(['a', 'c']));
    expect(out.results.map((r) => r.id)).not.toContain('b');
    expect(() => w.p.ai.run('knowledge_search', { query: '' }, w.admin.id)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });

  test('extractive summarizer keeps the highest-signal sentences in order', () => {
    const w = world();
    const out = w.p.ai.run('summarization', {
      text:
        'The kgotla met on Saturday. The kgotla discussed the borehole repair fund. ' +
        'Weather was pleasant. The borehole repair fund reached its target. ' +
        'Everyone was thanked for the borehole fund contributions.',
      max_sentences: 2,
    }, w.admin.id);
    expect(out.sentences_used).toBe(2);
    expect(out.summary).toContain('borehole');
    expect(out.summary).not.toContain('Weather');
  });

  test('metadata tagger extracts keywords and known entities', () => {
    const w = world();
    const out = w.p.ai.run('tagging', {
      text: 'A praise poem recorded at Tsodilo about cattle, rain and the bakalanga lineage of the hills',
    }, w.admin.id);
    expect(out.tags.length).toBeGreaterThan(2);
    expect(out.entities).toEqual(expect.arrayContaining(['tsodilo', 'bakalanga']));
  });

  test('recommender: co-occurrence first, popularity for cold starts', () => {
    const w = world();
    const interactions = [
      { user: 'u1', item: 'story-a' }, { user: 'u1', item: 'story-b' },
      { user: 'u2', item: 'story-a' }, { user: 'u2', item: 'story-b' },
      { user: 'u2', item: 'story-c' }, { user: 'u3', item: 'story-a' },
    ];
    const forUser = w.p.ai.run('recommendation', { interactions, for_user: 'u3' }, w.admin.id);
    expect(forUser.recommendations[0].item).toBe('story-b'); // co-occurs with story-a
    const coldStart = w.p.ai.run('recommendation', { for_user: 'stranger' }, w.admin.id);
    expect(coldStart.recommendations[0].cold_start).toBe(true);
    expect(coldStart.recommendations[0].item).toBe('story-a'); // most popular
  });

  test('baseline Setswana↔English translator: greedy phrase match with honest coverage', () => {
    const w = world();
    const out = w.p.ai.run('translation', {
      text: 'Dumela mma, ke a leboga',
      from: 'tn', to: 'en',
    }, w.admin.id);
    expect(out.translation).toBe('hello madam thank you');
    expect(out.quality).toBe('baseline');
    expect(out.coverage_pct).toBe(100);

    const reverse = w.p.ai.run('translation', { text: 'rain money village', from: 'en', to: 'tn' }, w.admin.id);
    expect(reverse.translation).toBe('pula madi motse');

    const partial = w.p.ai.run('translation', { text: 'dumela quantum mechanics', from: 'tn', to: 'en' }, w.admin.id);
    expect(partial.coverage_pct).toBeLessThan(100); // untranslated words pass through
    expect(() =>
      w.p.ai.run('translation', { text: 'x', from: 'fr', to: 'en' }, w.admin.id)
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  test('safety gate holds for the new providers: restricted heritage never reaches them', () => {
    const w = world();
    const restricted = publishedItem(w, { visibility: 'members' });
    expect(() =>
      w.p.ai.run('summarization', { text: 'x', heritage_refs: [restricted.id] }, w.admin.id)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    // Public content passes and the invocation is audited (P10).
    const publicItem = publishedItem(w, { visibility: 'public' });
    w.p.ai.run('summarization', { text: 'One sentence.', heritage_refs: [publicItem.id] }, w.admin.id);
    expect(
      w.p.audit.chainFor('ai:local-extractive').some((e) => e.action === 'ai.summarization')
    ).toBe(true);
  });
});

describe('Cloud AI adapters (WS8) — transport-injected, GCP-shaped', () => {
  test('speech-to-text normalises the recognize response', () => {
    const w = world();
    const transport = {
      calls: [],
      post(url, payload) {
        this.calls.push({ url, payload });
        return {
          results: [{ alternatives: [{ transcript: 'dumelang bagaetsho', confidence: 0.92 }] }],
        };
      },
    };
    w.p.ai.register(new CloudSpeechToTextProvider({ apiKey: 'k', transport }));
    const out = w.p.ai.run('transcription', { audio_base64: 'UklGRg==', language: 'tn-BW' }, w.admin.id);
    expect(out.transcript).toBe('dumelang bagaetsho');
    expect(out.confidence).toBe(0.92);
    expect(transport.calls[0].payload.config.languageCode).toBe('tn-BW');
    // Empty operator response → empty transcript, never a crash.
    transport.post = () => ({ results: [] });
    expect(w.p.ai.run('transcription', { audio_base64: 'x' }, w.admin.id).transcript).toBe('');
  });

  test('cloud translation supersedes the baseline when registered', () => {
    const w = world();
    const transport = {
      post: () => ({ data: { translations: [{ translatedText: 'The chief greets the village' }] } }),
    };
    w.p.ai.register(new CloudTranslationProvider({ apiKey: 'k', transport }));
    const out = w.p.ai.run('translation', { text: 'Kgosi o dumedisa motse', from: 'tn', to: 'en' }, w.admin.id);
    expect(out.quality).toBe('nmt');
    expect(out.translation).toContain('chief');
  });

  test('credentials are mandatory; the safety gate still fronts cloud providers', () => {
    const w = world();
    expect(() => new CloudSpeechToTextProvider({})).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    const transport = { post: () => ({ results: [] }) };
    w.p.ai.register(new CloudSpeechToTextProvider({ apiKey: 'k', transport }));
    // Restricted media never reaches the wire — gate fires first.
    const session = w.p.media.createUploadSession(w.mma.id, {
      type: 'audio', mediaClass: 'restricted', totalBytes: 1,
    });
    w.p.media.appendChunk(session.id, 0, 'x');
    const media = w.p.media.completeUpload(session.id, {});
    expect(() =>
      w.p.ai.run('transcription', { audio_base64: 'x', media_refs: [media.id] }, w.admin.id)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });
});
