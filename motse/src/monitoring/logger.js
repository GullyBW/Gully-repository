'use strict';

/**
 * Structured logger (doc §16: structured logs with trace IDs
 * end-to-end). JSON lines to an injectable sink; tests inspect the
 * sink, production ships stdout → Cloud Logging.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity };

class Logger {
  constructor({ clock, sink, level = process.env.MOTSE_LOG_LEVEL || 'info', context = null } = {}) {
    this.clock = clock;
    this.sink = sink || ((line) => process.stdout.write(`${line}\n`));
    this.threshold = LEVELS[level] || LEVELS.info;
    this.bound = {};
    // Optional dynamic-context provider evaluated at log time — e.g. the active
    // trace/span id from the tracer's AsyncLocalStorage — so every line is
    // correlatable without threading ids through call sites. Additive: when
    // absent (the default) behaviour is identical.
    this.context = context;
  }

  /** Child logger with bound fields (e.g. service, module, request_id). */
  with(fields) {
    const child = new Logger({ clock: this.clock, sink: this.sink, context: this.context });
    child.threshold = this.threshold;
    child.bound = { ...this.bound, ...fields };
    return child;
  }

  _log(level, message, fields = {}) {
    if (LEVELS[level] < this.threshold) return;
    let dynamic = {};
    if (this.context) {
      try { dynamic = this.context() || {}; } catch (e) { dynamic = {}; } // context must never break a log
    }
    this.sink(
      JSON.stringify({
        ts: this.clock ? this.clock.nowIso() : new Date().toISOString(),
        level,
        message,
        // Precedence (low → high): dynamic context, bound fields, explicit call fields.
        ...dynamic,
        ...this.bound,
        ...fields,
      })
    );
  }

  debug(message, fields) {
    this._log('debug', message, fields);
  }

  info(message, fields) {
    this._log('info', message, fields);
  }

  warn(message, fields) {
    this._log('warn', message, fields);
  }

  error(message, fields) {
    this._log('error', message, fields);
  }
}

module.exports = { Logger };
