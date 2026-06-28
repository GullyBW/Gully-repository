'use strict';

const mongoose = require('mongoose');

const favouriteSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    customerId: { type: String, required: true, index: true },
    providerId: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// A customer can favourite a provider at most once.
favouriteSchema.index({ customerId: 1, providerId: 1 }, { unique: true });

module.exports = mongoose.model('Favourite', favouriteSchema);
