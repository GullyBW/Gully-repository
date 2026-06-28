'use strict';

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    bookingReference: { type: String, required: true, unique: true, index: true },
    customerId: { type: String, required: true, index: true },
    providerId: { type: String, required: true, index: true },
    lastMessageAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Conversation', conversationSchema);
