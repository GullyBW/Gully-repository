'use strict';

const axios = require('axios');
const config = require('../config');
const { haversineKm, estimateTravelKm, isValidPoint } = require('../utils/geo');
const ApiError = require('../utils/ApiError');

/**
 * Maps / location service. Wraps Google Maps Geocoding & Places when an API key
 * is configured, and otherwise serves a built-in Botswana sandbox so address
 * search, geocoding and distance all work in development and tests without a
 * key. Distance ranking always uses the local haversine helper (no quota cost).
 */

// A small gazetteer of Botswana locations for the sandbox.
const SANDBOX_PLACES = [
  { name: 'Gaborone CBD', address: 'CBD, Gaborone, Botswana', lat: -24.6545, lng: 25.9086 },
  { name: 'Game City Mall', address: 'Game City, Gaborone, Botswana', lat: -24.6939, lng: 25.8936 },
  { name: 'Airport Junction', address: 'Airport Junction, Gaborone, Botswana', lat: -24.6202, lng: 25.9182 },
  { name: 'Phakalane', address: 'Phakalane, Gaborone, Botswana', lat: -24.5667, lng: 25.9500 },
  { name: 'Mogoditshane', address: 'Mogoditshane, Botswana', lat: -24.6280, lng: 25.8650 },
  { name: 'Francistown', address: 'Francistown, Botswana', lat: -21.1700, lng: 27.5078 },
  { name: 'Maun', address: 'Maun, Botswana', lat: -19.9833, lng: 23.4167 },
  { name: 'Molepolole', address: 'Molepolole, Botswana', lat: -24.4067, lng: 25.4951 },
  { name: 'Lobatse', address: 'Lobatse, Botswana', lat: -25.2167, lng: 25.6667 },
  { name: 'Kanye', address: 'Kanye, Botswana', lat: -24.9667, lng: 25.3333 },
];

class GeoService {
  static get isLive() {
    return Boolean(config.maps.googleApiKey);
  }

  /** Distance in km between two {lat,lng} points (null if either is invalid). */
  static distanceKm(from, to) {
    return haversineKm(from, to);
  }

  static estimateTravelKm(from, to) {
    return estimateTravelKm(from, to);
  }

  /** Free-text place search. Returns [{name,address,lat,lng}]. */
  static async searchPlaces(query) {
    if (!query || query.trim().length < 2) return [];
    if (!GeoService.isLive) {
      const q = query.toLowerCase();
      return SANDBOX_PLACES.filter(
        (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q)
      );
    }
    const { data } = await axios.get(`${config.maps.baseUrl}/place/textsearch/json`, {
      params: { query, key: config.maps.googleApiKey },
      timeout: 15000,
    });
    return (data.results || []).map((r) => ({
      name: r.name,
      address: r.formatted_address,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
    }));
  }

  /** Address -> coordinates. */
  static async geocode(address) {
    if (!address) throw ApiError.badRequest('address is required');
    if (!GeoService.isLive) {
      const q = address.toLowerCase();
      const match =
        SANDBOX_PLACES.find((p) => p.address.toLowerCase().includes(q) || q.includes(p.name.toLowerCase())) ||
        SANDBOX_PLACES[0];
      return { lat: match.lat, lng: match.lng, formattedAddress: match.address };
    }
    const { data } = await axios.get(`${config.maps.baseUrl}/geocode/json`, {
      params: { address, key: config.maps.googleApiKey },
      timeout: 15000,
    });
    const r = (data.results || [])[0];
    if (!r) throw ApiError.notFound('Address not found');
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
    };
  }

  /**
   * Route between two points. Uses the Google Directions API when live, else a
   * sandbox estimate (haversine distance + an average-speed duration). Same
   * return shape either way: { distanceKm, durationMinutes, polyline }.
   */
  static async directions(from, to) {
    if (!isValidPoint(from) || !isValidPoint(to)) {
      throw ApiError.badRequest('Valid from/to coordinates are required');
    }
    if (!GeoService.isLive) {
      const distanceKm = Math.round(haversineKm(from, to) * 10) / 10;
      const durationMinutes = Math.max(1, Math.round((distanceKm / 40) * 60)); // ~40 km/h
      return { distanceKm, durationMinutes, polyline: null, sandbox: true };
    }
    const { data } = await axios.get(`${config.maps.baseUrl}/directions/json`, {
      params: {
        origin: `${from.lat},${from.lng}`,
        destination: `${to.lat},${to.lng}`,
        key: config.maps.googleApiKey,
      },
      timeout: 15000,
    });
    const route = (data.routes || [])[0];
    const leg = route && route.legs && route.legs[0];
    return {
      distanceKm: leg ? Math.round((leg.distance.value / 1000) * 10) / 10 : null,
      durationMinutes: leg ? Math.round(leg.duration.value / 60) : null,
      polyline: route ? route.overview_polyline?.points : null,
    };
  }

  /** Distance + ETA between provider and customer (alias suited to bookings). */
  static async travelEstimate(from, to) {
    return GeoService.directions(from, to);
  }

  /** Coordinates -> nearest known address (reverse geocode). */
  static async reverseGeocode(lat, lng) {
    const point = { lat: Number(lat), lng: Number(lng) };
    if (!isValidPoint(point)) throw ApiError.badRequest('Valid lat/lng required');
    if (!GeoService.isLive) {
      let nearest = SANDBOX_PLACES[0];
      let best = Infinity;
      for (const p of SANDBOX_PLACES) {
        const d = haversineKm(point, p);
        if (d != null && d < best) {
          best = d;
          nearest = p;
        }
      }
      return { formattedAddress: nearest.address, lat: point.lat, lng: point.lng };
    }
    const { data } = await axios.get(`${config.maps.baseUrl}/geocode/json`, {
      params: { latlng: `${lat},${lng}`, key: config.maps.googleApiKey },
      timeout: 15000,
    });
    const r = (data.results || [])[0];
    return { formattedAddress: r ? r.formatted_address : 'Unknown location', lat: point.lat, lng: point.lng };
  }
}

module.exports = GeoService;
