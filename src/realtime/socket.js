'use strict';

const { Server } = require('socket.io');
const AuthService = require('../services/auth.service');
const MessageService = require('../services/message.service');
const bus = require('./bus');

/**
 * Socket.IO gateway for real-time chat. Authenticated with the same JWT as the
 * REST API (passed in handshake.auth.token). Clients join per-conversation
 * rooms; the message service emits 'message:new'/'message:read' through the bus,
 * which we relay to the right room. Typing indicators are relayed directly.
 */
function attachSocket(httpServer, opts = {}) {
  const io = new Server(httpServer, { cors: opts.cors || { origin: '*' } });

  // JWT auth handshake.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = AuthService.verifyToken(token);
      socket.user = { id: payload.sub, role: payload.role, email: payload.email };
      return next();
    } catch (_err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    // Join a booking conversation room (membership is access-checked).
    socket.on('conversation:join', async (bookingReference, ack) => {
      try {
        const conv = await MessageService.getOrCreateConversation(socket.user, bookingReference);
        socket.join(`conv:${conv.id}`);
        if (typeof ack === 'function') ack({ ok: true, conversationId: conv.id });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('message:send', async ({ bookingReference, ...input }, ack) => {
      try {
        const message = await MessageService.sendMessage(socket.user, bookingReference, input);
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('typing', ({ conversationId, typing }) => {
      socket.to(`conv:${conversationId}`).emit('typing', { userId: socket.user.id, typing });
    });

    socket.on('message:read', async ({ bookingReference }) => {
      try {
        await MessageService.markRead(socket.user, bookingReference);
      } catch (_err) {
        /* ignore */
      }
    });
  });

  // Relay service-emitted events into the right conversation room.
  bus.setEmitter((event, conversationId, payload) => {
    io.to(`conv:${conversationId}`).emit(event, payload);
  });

  return io;
}

module.exports = { attachSocket };
