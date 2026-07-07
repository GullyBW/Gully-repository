'use strict';

/**
 * Cursor pagination (doc §7.1): page_token / next_page_token.
 * Tokens are opaque base64 offsets over a stable ordering.
 */
function paginate(items, { pageToken, pageSize = 20 } = {}) {
  let offset = 0;
  if (pageToken) {
    const decoded = Number(Buffer.from(String(pageToken), 'base64').toString('utf8'));
    if (Number.isInteger(decoded) && decoded >= 0) offset = decoded;
  }
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const page = items.slice(offset, offset + size);
  const nextOffset = offset + size;
  return {
    items: page,
    next_page_token:
      nextOffset < items.length ? Buffer.from(String(nextOffset)).toString('base64') : null,
  };
}

/**
 * Partial responses via field masks (doc §7.1) — protects data budgets
 * (P8): ?fields=id,name,state returns only those fields.
 */
function applyFieldMask(resource, fields) {
  if (!fields) return resource;
  const wanted = String(fields)
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  if (wanted.length === 0) return resource;
  const pick = (obj) =>
    Object.fromEntries(Object.entries(obj).filter(([k]) => wanted.includes(k)));
  return Array.isArray(resource) ? resource.map(pick) : pick(resource);
}

module.exports = { paginate, applyFieldMask };
