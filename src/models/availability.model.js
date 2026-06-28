'use strict';

const mongoose = require('mongoose');

const availabilitySchema = new mongoose.Schema(
  {
    providerId: { type: String, required: true, unique: true, index: true },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0 = Sunday
    startTime: { type: String, default: '08:00' },
    endTime: { type: String, default: '17:00' },
    slotMinutes: { type: Number, default: 60 },
    holidays: { type: [String], default: [] }, // 'YYYY-MM-DD'
    emergencyAvailable: { type: Boolean, default: false },
    vacationMode: { type: Boolean, default: false },
    vacationUntil: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Availability', availabilitySchema);
