'use strict';

const { v4: uuidv4 } = require('uuid');

const PLATFORMS = ['android', 'ios', 'web'];

/** A push registration token for one of a user's devices. */
function createDeviceToken(userId, token, platform) {
  return {
    id: uuidv4(),
    userId,
    token,
    platform: PLATFORMS.includes(platform) ? platform : 'web',
    createdAt: new Date(),
    lastSeenAt: new Date(),
  };
}

function toPublicJSON(d) {
  return { id: d.id, platform: d.platform, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt };
}

module.exports = { createDeviceToken, toPublicJSON, PLATFORMS };
