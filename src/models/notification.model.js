'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Notification', notificationSchema);
