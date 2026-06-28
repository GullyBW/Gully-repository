'use strict';

const AnalyticsService = require('../services/analytics.service');
const { toCSV } = require('../utils/csv');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const AnalyticsController = {
  provider: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await AnalyticsService.providerAnalytics(req.user.id) });
  }),

  customer: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await AnalyticsService.customerAnalytics(req.user.id) });
  }),

  admin: asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await AnalyticsService.adminAnalytics() });
  }),

  // GET /api/analytics/export?report=...&format=csv|json
  export: asyncHandler(async (req, res) => {
    const { report, format = 'csv' } = req.query;
    const rows = await AnalyticsService.reportRows(report, req.user);
    if (format === 'json') {
      return res.json({ success: true, data: rows });
    }
    const csv = toCSV(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${report || 'report'}.csv"`);
    return res.send(csv);
  }),
};

module.exports = AnalyticsController;
