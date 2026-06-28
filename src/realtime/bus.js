'use strict';

/**
 * Tiny indirection so the message service can push real-time events without
 * importing Socket.IO directly. The socket gateway registers an emitter at
 * startup; in tests (no gateway) emit is a no-op.
 */
let emitter = null;

function setEmitter(fn) {
  emitter = fn;
}

function emit(event, room, payload) {
  if (emitter) {
    try {
      emitter(event, room, payload);
    } catch (_err) {
      /* never let realtime failures break the request path */
    }
  }
}

module.exports = { setEmitter, emit };
