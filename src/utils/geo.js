'use strict';

/**
 * Lightweight geo helpers. Distance uses the haversine formula so the
 * marketplace can rank "nearest first" without any external dependency. A real
 * Google Maps Distance Matrix call can later replace `estimateTravelKm` while
 * keeping the same signature.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two {lat,lng} points, in kilometres. */
function haversineKm(a, b) {
  if (!isValidPoint(a) || !isValidPoint(b)) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rough straight-line travel estimate (km, rounded to 1 dp). */
function estimateTravelKm(a, b) {
  const km = haversineKm(a, b);
  return km == null ? null : Math.round(km * 10) / 10;
}

function isValidPoint(p) {
  return (
    p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

module.exports = { haversineKm, estimateTravelKm, isValidPoint };
