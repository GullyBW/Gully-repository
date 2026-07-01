'use strict';

const sentiment = require('../src/trading/analysis/sentiment');

describe('Financial sentiment engine', () => {
  test('scores a clearly bullish headline positive', () => {
    const s = sentiment.analyze('Company beats earnings expectations, shares surge to record high');
    expect(s.score).toBeGreaterThan(0.2);
    expect(['positive', 'very_positive']).toContain(s.label);
    expect(s.matches.length).toBeGreaterThan(0);
  });

  test('scores a clearly bearish headline negative', () => {
    const s = sentiment.analyze('Shares plunge on fraud lawsuit and bankruptcy fears');
    expect(s.score).toBeLessThan(-0.2);
    expect(['negative', 'very_negative']).toContain(s.label);
  });

  test('handles negation', () => {
    const positive = sentiment.analyze('profit will surge');
    const negated = sentiment.analyze('profit will not surge');
    expect(positive.score).toBeGreaterThan(0);
    expect(negated.score).toBeLessThan(positive.score);
  });

  test('neutral text scores near zero', () => {
    const s = sentiment.analyze('The company scheduled its annual meeting for next month');
    expect(Math.abs(s.score)).toBeLessThan(0.15);
    expect(s.label).toBe('neutral');
  });

  test('aggregate weights recent news more heavily via time decay', () => {
    const now = Date.now();
    const items = [
      { headline: 'stock surges on record profit and upgrade', publishedAt: new Date(now - 5 * 60000) },
      { headline: 'shares plunge on fraud probe', publishedAt: new Date(now - 10 * 3600000) },
    ];
    const agg = sentiment.aggregate(items, { now, halfLifeMinutes: 60 });
    expect(agg.count).toBe(2);
    // The fresh positive item dominates the stale negative one.
    expect(agg.score).toBeGreaterThan(0);
  });

  test('empty input is neutral', () => {
    expect(sentiment.aggregate([]).score).toBe(0);
    expect(sentiment.analyze('').score).toBe(0);
  });
});
