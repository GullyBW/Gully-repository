'use strict';

/**
 * Structured logger (doc §16: structured logs with trace IDs
 * end-to-end). JSON lines to an injectable sink; tests inspect the
 * sink, production ships stdout → Cloud Logging.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity };

class Logger {
  constructor({ clock, sink, level = process.env.MOTSE_LOG_LEVEL || 'info' } = {}) {
    this.clock = clock;
    this.sink = sink || ((line) => process.stdout.write(`${line}\n`));
    this.threshold = LEVELS[level] || LEVELS.info;
    this.bound = {};
  }

  /** Child logger with bound fields (e.g. trace_id, module). */
  with(fields) {
    const child = new Logger({ clock: this.clock, sink: this.sink });
    child.threshold = this.threshold;
    child.bound = { ...this.bound, ...fields };
    return child;
  }

  _log(level, message, fields = {}) {
    if (LEVELS[level] < this.threshold) return;
    this.sink(
      JSON.stringify({
        ts: this.clock ? this.clock.nowIso() : new Date().toISOString(),
        level,
        message,
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
