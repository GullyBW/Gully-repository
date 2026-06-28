'use strict';

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true },
    type: { type: String, enum: ['text', 'image', 'location'], default: 'text' },
    text: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },
    readBy: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Message', messageSchema);
