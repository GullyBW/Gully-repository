'use strict';

const { v4: uuidv4 } = require('uuid');

/** A customer saving a provider as a favourite. */
function createFavourite(customerId, providerId) {
  return {
    id: uuidv4(),
    customerId,
    providerId,
    createdAt: new Date(),
  };
}

module.exports = { createFavourite };
