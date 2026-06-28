'use strict';

const { v4: uuidv4 } = require('uuid');

const MESSAGE_TYPES = ['text', 'image', 'location'];

function createConversation(bookingReference, customerId, providerId) {
  const now = new Date();
  return {
    id: uuidv4(),
    bookingReference,
    customerId,
    providerId,
    lastMessageAt: now,
    createdAt: now,
  };
}

function createMessage(conversationId, senderId, input) {
  const type = MESSAGE_TYPES.includes(input.type) ? input.type : 'text';
  return {
    id: uuidv4(),
    conversationId,
    senderId,
    type,
    text: type === 'text' ? input.text || '' : input.text || '',
    imageUrl: type === 'image' ? input.imageUrl || '' : '',
    location: type === 'location' ? input.location || null : null,
    readBy: [senderId],
    reactions: [], // [{ userId, emoji }]
    forwardedFrom: input.forwardedFrom || null,
    createdAt: new Date(),
  };
}

/** Toggle a user's emoji reaction on a message (one emoji per user). */
function toggleReaction(message, userId, emoji) {
  message.reactions = message.reactions || [];
  const existing = message.reactions.find((r) => r.userId === userId);
  if (existing && existing.emoji === emoji) {
    message.reactions = message.reactions.filter((r) => r.userId !== userId);
  } else if (existing) {
    existing.emoji = emoji;
  } else {
    message.reactions.push({ userId, emoji });
  }
  return message;
}

function conversationJSON(c) {
  return {
    id: c.id,
    bookingReference: c.bookingReference,
    customerId: c.customerId,
    providerId: c.providerId,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
  };
}

function messageJSON(m) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    type: m.type,
    text: m.text,
    imageUrl: m.imageUrl,
    location: m.location,
    readBy: m.readBy,
    reactions: m.reactions || [],
    forwardedFrom: m.forwardedFrom || null,
    createdAt: m.createdAt,
  };
}

module.exports = {
  createConversation,
  createMessage,
  toggleReaction,
  conversationJSON,
  messageJSON,
  MESSAGE_TYPES,
};
