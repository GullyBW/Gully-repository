'use strict';

const BaseStrategy = require('./baseStrategy');

/**
 * News-sentiment strategy. Converts the aggregated, time-decayed news sentiment
 * for a symbol into a directional vote, and — crucially — checks whether price
 * action *confirms* the news. Fresh, strong, confirmed news is the edge desks
 * are slowest to systematise; here it votes on the same tick it lands.
 *
 * Candlestick reversal patterns on the latest bar nudge the vote too, since
 * they often mark the market digesting news.
 */
class NewsSentimentStrategy extends BaseStrategy {
  get name() {
    return 'news_sentiment';
  }

  evaluate({ news, snapshot }) {
    if (!news || !news.count) return this.hold(['no fresh news']);

    let score = news.score * 2; // map [-1,1] sentiment onto the [-2,2] vote scale
    const reasons = [`aggregated news sentiment ${news.score} (${news.label}) across ${news.count} items`];

    // Confidence scales with how much news there is and how strong it is.
    let confidence = Math.min(0.85, 0.35 + Math.abs(news.score) * 0.5 + Math.min(news.count, 6) * 0.04);

    // Price/news confirmation: reward when the tape agrees with the story.
    if (snapshot && snapshot.ok && snapshot.rsi != null) {
      const priceBullish = snapshot.trend && snapshot.trend.includes('uptrend');
      const priceBearish = snapshot.trend && snapshot.trend.includes('downtrend');
      if (score > 0 && priceBullish) {
        confidence = Math.min(1, confidence + 0.1);
        reasons.push('price trend confirms positive news');
      } else if (score < 0 && priceBearish) {
        confidence = Math.min(1, confidence + 0.1);
        reasons.push('price trend confirms negative news');
      } else if (score > 0 && priceBearish) {
        confidence = Math.max(0.2, confidence - 0.15);
        reasons.push('positive news but price weak — possible fade/priced-in');
      } else if (score < 0 && priceBullish) {
        confidence = Math.max(0.2, confidence - 0.15);
        reasons.push('negative news but price strong — possible dip-buy');
      }
    }

    // Candlestick reversal confirmation.
    if (snapshot && Array.isArray(snapshot.patterns)) {
      for (const p of snapshot.patterns) {
        if (p.direction === 'bullish') {
          score += 0.3 * p.strength;
          reasons.push(`bullish ${p.pattern} pattern`);
        } else if (p.direction === 'bearish') {
          score -= 0.3 * p.strength;
          reasons.push(`bearish ${p.pattern} pattern`);
        }
      }
    }

    if (Math.abs(score) < 0.25) return this.hold(['news sentiment too weak to act on']);
    return this.vote(score, confidence, reasons);
  }
}

module.exports = NewsSentimentStrategy;
