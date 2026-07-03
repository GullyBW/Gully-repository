'use strict';

const { err } = require('../kernel/errors');

/**
 * AI Foundation (Phase-1 §7): provider EXTENSION POINTS only — no model
 * is integrated here. Each capability has a provider interface; the
 * registry enforces the platform's cultural-safety constraints BEFORE
 * any provider sees any content:
 *
 *  - media flagged no_derivatives_no_training NEVER reaches a provider
 *    (doc §6.4 derivative ban — fail closed, not opt-out);
 *  - restricted heritage items never reach a provider;
 *  - every invocation is audited (P10).
 *
 * A future integration implements one of the interfaces below and
 * registers it; nothing else in the platform changes.
 */
const CAPABILITIES = [
  'transcription', // speech → text (Setswana/Ikalanga ASR-assisted workflow, §6.3)
  'translation',
  'summarization', // story summaries
  'knowledge_search', // semantic retrieval over PUBLIC content
  'tagging', // content tagging
  'recommendation',
];

/** Interface contract — subclasses implement run(). */
class AiProvider {
  constructor(name, capability) {
    this.name = name;
    this.capability = capability;
  }

  /** @param {object} task capability-specific payload @returns result */
  // eslint-disable-next-line no-unused-vars
  run(task) {
    throw err('INVALID_ARGUMENT', `${this.name} does not implement run()`);
  }
}

class AiRegistry {
  constructor({ media, heritage, audit, clock }) {
    this.media = media;
    this.heritage = heritage;
    this.audit = audit;
    this.clock = clock;
    this.providers = new Map(); // capability -> provider
  }

  register(provider) {
    if (!CAPABILITIES.includes(provider.capability)) {
      throw err('INVALID_ARGUMENT', `Unknown AI capability ${provider.capability}`);
    }
    this.providers.set(provider.capability, provider);
  }

  configured(capability) {
    return this.providers.has(capability);
  }

  /**
   * Run a capability with the safety gate. task may reference
   * media_refs and heritage_refs; every referenced object must be
   * derivable — one restricted item fails the WHOLE task.
   */
  run(capability, task, actorRef) {
    const provider = this.providers.get(capability);
    if (!provider) {
      throw err('NOT_FOUND', `No provider configured for ${capability}`, {
        configured: [...this.providers.keys()],
      });
    }
    for (const mediaRef of task.media_refs || []) {
      this.media.assertDerivableForTraining(mediaRef); // throws on the flag
    }
    for (const heritageRef of task.heritage_refs || []) {
      const item = this.heritage.items.get(heritageRef);
      if (!item || item.visibility !== 'public' || item.state === 'withdrawn') {
        throw err('PERMISSION_DENIED', 'AI jobs only run over public, live heritage content', {
          heritage_ref: heritageRef,
        });
      }
    }
    const result = provider.run(task);
    this.audit.append(actorRef || 'system:ai', `ai.${capability}`, `ai:${provider.name}`, null, {
      media_refs: task.media_refs || [],
      heritage_refs: task.heritage_refs || [],
    });
    return result;
  }
}

module.exports = { AiRegistry, AiProvider, CAPABILITIES };
