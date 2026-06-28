'use strict';

const { v4: uuidv4 } = require('uuid');

/** A customer's saved service location (home, office, …). */
function createSavedAddress(customerId, input) {
  return {
    id: uuidv4(),
    customerId,
    label: input.label || 'Address',
    address: input.address || '',
    lat: input.lat,
    lng: input.lng,
    isDefault: !!input.isDefault,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const EDITABLE_FIELDS = ['label', 'address', 'lat', 'lng', 'isDefault'];

function applyEdit(addr, input) {
  for (const f of EDITABLE_FIELDS) {
    if (input[f] !== undefined) addr[f] = input[f];
  }
  addr.updatedAt = new Date();
  return addr;
}

function toPublicJSON(a) {
  return {
    id: a.id,
    label: a.label,
    address: a.address,
    lat: a.lat,
    lng: a.lng,
    isDefault: a.isDefault,
    createdAt: a.createdAt,
  };
}

module.exports = { createSavedAddress, applyEdit, toPublicJSON };
