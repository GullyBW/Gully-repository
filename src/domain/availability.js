'use strict';

/**
 * Provider availability: weekly working days/hours, holidays, vacation mode and
 * emergency availability. `computeSlots` turns this into concrete bookable time
 * slots for a given date so customers only ever see open slots.
 */

function defaultAvailability(providerId) {
  const now = new Date();
  return {
    providerId,
    workingDays: [1, 2, 3, 4, 5], // Mon–Fri (0 = Sunday)
    startTime: '08:00',
    endTime: '17:00',
    slotMinutes: 60,
    holidays: [], // ['YYYY-MM-DD', ...]
    emergencyAvailable: false, // bookable any time, overrides closed days
    vacationMode: false,
    vacationUntil: null, // 'YYYY-MM-DD' or null (indefinite)
    createdAt: now,
    updatedAt: now,
  };
}

const EDITABLE_FIELDS = [
  'workingDays',
  'startTime',
  'endTime',
  'slotMinutes',
  'holidays',
  'emergencyAvailable',
  'vacationMode',
  'vacationUntil',
];

function applyEdit(availability, input) {
  for (const f of EDITABLE_FIELDS) {
    if (input[f] !== undefined) availability[f] = input[f];
  }
  availability.updatedAt = new Date();
  return availability;
}

function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function onVacation(availability, dateStr) {
  if (!availability.vacationMode) return false;
  if (!availability.vacationUntil) return true; // indefinite
  return dateStr <= String(availability.vacationUntil).slice(0, 10);
}

/**
 * Concrete bookable slots for a date ('YYYY-MM-DD').
 * @returns {{start:string,end:string}[]}
 */
function computeSlots(availability, dateStr) {
  const a = availability;
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return [];

  const emergency = !!a.emergencyAvailable;
  if (onVacation(a, dateStr) && !emergency) return [];
  if ((a.holidays || []).includes(dateStr) && !emergency) return [];

  const weekday = date.getDay();
  if (!(a.workingDays || []).includes(weekday) && !emergency) return [];

  const slots = [];
  const step = a.slotMinutes || 60;
  const start = timeToMinutes(a.startTime || '08:00');
  const end = timeToMinutes(a.endTime || '17:00');
  for (let t = start; t + step <= end; t += step) {
    slots.push({ start: minutesToTime(t), end: minutesToTime(t + step) });
  }
  return slots;
}

function toPublicJSON(a) {
  return {
    providerId: a.providerId,
    workingDays: a.workingDays,
    startTime: a.startTime,
    endTime: a.endTime,
    slotMinutes: a.slotMinutes,
    holidays: a.holidays,
    emergencyAvailable: a.emergencyAvailable,
    vacationMode: a.vacationMode,
    vacationUntil: a.vacationUntil,
    updatedAt: a.updatedAt,
  };
}

module.exports = { defaultAvailability, applyEdit, computeSlots, onVacation, toPublicJSON };
