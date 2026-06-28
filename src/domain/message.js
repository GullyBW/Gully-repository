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
    createdAt: new Date(),
  };
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
    createdAt: m.createdAt,
  };
}

module.exports = { createConversation, createMessage, conversationJSON, messageJSON, MESSAGE_TYPES };
