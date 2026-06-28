'use strict';

const GeoService = require('../services/geo.service');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const GeoController = {
  // GET /api/geo/search?q=
  search: asyncHandler(async (req, res) => {
    const results = await GeoService.searchPlaces(req.query.q);
    res.json({ success: true, data: results });
  }),

  // POST /api/geo/geocode { address }
  geocode: asyncHandler(async (req, res) => {
    const result = await GeoService.geocode(req.body.address);
    res.json({ success: true, data: result });
  }),

  // GET /api/geo/reverse?lat=&lng=
  reverse: asyncHandler(async (req, res) => {
    const result = await GeoService.reverseGeocode(req.query.lat, req.query.lng);
    res.json({ success: true, data: result });
  }),

  // GET /api/geo/distance?fromLat=&fromLng=&toLat=&toLng=
  distance: asyncHandler(async (req, res) => {
    const from = { lat: Number(req.query.fromLat), lng: Number(req.query.fromLng) };
    const to = { lat: Number(req.query.toLat), lng: Number(req.query.toLng) };
    const km = GeoService.estimateTravelKm(from, to);
    res.json({ success: true, data: { distanceKm: km } });
  }),
};

module.exports = GeoController;
