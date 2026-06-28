'use strict';

const mongoose = require('mongoose');

const savedAddressSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    customerId: { type: String, required: true, index: true },
    label: { type: String, default: 'Address' },
    address: { type: String, default: '' },
    lat: { type: Number },
    lng: { type: Number },
    isDefault: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

module.exports = mongoose.model('SavedAddress', savedAddressSchema);
