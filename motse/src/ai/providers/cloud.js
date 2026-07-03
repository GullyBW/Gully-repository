'use strict';

const { AiProvider } = require('../registry');
const { err } = require('../../kernel/errors');

/**
 * Cloud AI adapters (Phase 2, WS8): speech-to-text and neural
 * translation genuinely require hosted models, so these providers are
 * thin, transport-injected HTTP adapters (GCP-shaped). They register
 * only when credentials are configured; the safety gate in AiRegistry
 * has already run before run() is ever called, so no restricted
 * content can reach the wire by construction.
 */
class CloudSpeechToTextProvider extends AiProvider {
  constructor({ apiKey, endpoint, transport }) {
    super('cloud-speech', 'transcription');
    if (!apiKey) throw err('INVALID_ARGUMENT', 'CloudSpeechToTextProvider requires an apiKey');
    this.apiKey = apiKey;
    this.endpoint = endpoint || 'https://speech.googleapis.com/v1/speech:recognize';
    this.transport = transport || defaultTransport;
  }

  run(task) {
    if (!task.audio_base64) {
      throw err('INVALID_ARGUMENT', 'transcription needs { audio_base64, language? }');
    }
    const response = this.transport.post(
      `${this.endpoint}?key=${this.apiKey}`,
      {
        config: {
          languageCode: task.language || 'tn-BW',
          alternativeLanguageCodes: ['en-ZA'],
          enableAutomaticPunctuation: true,
        },
        audio: { content: task.audio_base64 },
      }
    );
    const alternative =
      response &&
      response.results &&
      response.results[0] &&
      response.results[0].alternatives &&
      response.results[0].alternatives[0];
    if (!alternative) {
      return { transcript: '', confidence: 0, language: task.language || 'tn-BW' };
    }
    return {
      transcript: alternative.transcript,
      confidence: alternative.confidence ?? null,
      language: task.language || 'tn-BW',
    };
  }
}

class CloudTranslationProvider extends AiProvider {
  constructor({ apiKey, endpoint, transport }) {
    super('cloud-translate', 'translation');
    if (!apiKey) throw err('INVALID_ARGUMENT', 'CloudTranslationProvider requires an apiKey');
    this.apiKey = apiKey;
    this.endpoint = endpoint || 'https://translation.googleapis.com/language/translate/v2';
    this.transport = transport || defaultTransport;
  }

  run(task) {
    if (!task.text) throw err('INVALID_ARGUMENT', 'translation needs { text, from, to }');
    const response = this.transport.post(`${this.endpoint}?key=${this.apiKey}`, {
      q: task.text,
      source: task.from || 'tn',
      target: task.to || 'en',
      format: 'text',
    });
    const first =
      response && response.data && response.data.translations && response.data.translations[0];
    if (!first) throw err('INTERNAL', 'Translation service returned no result');
    return {
      translation: first.translatedText,
      from: task.from || 'tn',
      to: task.to || 'en',
      quality: 'nmt',
    };
  }
}

/** Default transport — synchronous facade kept minimal; tests inject fakes. */
const defaultTransport = {
  post() {
    throw err('INTERNAL', 'No HTTP transport configured for cloud AI provider');
  },
};

module.exports = { CloudSpeechToTextProvider, CloudTranslationProvider };
