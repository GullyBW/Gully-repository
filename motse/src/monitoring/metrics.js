'use strict';

/**
 * Metrics registry (doc §16 observability): counters, gauges and
 * histograms with labels, exposed in Prometheus text format at
 * /metrics. Dependency-free so it runs identically in tests and prod.
 */
class Metrics {
  constructor() {
    this.counters = new Map(); // name -> Map(labelKey -> value)
    this.gauges = new Map(); // name -> { fn } | Map(labelKey -> value)
    this.histograms = new Map(); // name -> Map(labelKey -> { buckets, sum, count })
    this.buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  }

  static labelKey(labels = {}) {
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}="${String(labels[k]).replace(/"/g, '')}"`).join(',');
  }

  inc(name, labels = {}, value = 1) {
    if (!this.counters.has(name)) this.counters.set(name, new Map());
    const series = this.counters.get(name);
    const key = Metrics.labelKey(labels);
    series.set(key, (series.get(key) || 0) + value);
  }

  /** Register a gauge backed by a live function (evaluated on scrape). */
  gaugeFn(name, fn) {
    this.gauges.set(name, { fn });
  }

  setGauge(name, labels = {}, value) {
    if (!this.gauges.has(name) || this.gauges.get(name).fn) this.gauges.set(name, new Map());
    this.gauges.get(name).set(Metrics.labelKey(labels), value);
  }

  observe(name, labels = {}, valueMs) {
    if (!this.histograms.has(name)) this.histograms.set(name, new Map());
    const series = this.histograms.get(name);
    const key = Metrics.labelKey(labels);
    if (!series.has(key)) {
      series.set(key, { counts: new Array(this.buckets.length + 1).fill(0), sum: 0, count: 0 });
    }
    const h = series.get(key);
    h.sum += valueMs;
    h.count += 1;
    let placed = false;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (valueMs <= this.buckets[i]) {
        h.counts[i] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) h.counts[this.buckets.length] += 1;
  }

  counterValue(name, labels = {}) {
    const series = this.counters.get(name);
    return series ? series.get(Metrics.labelKey(labels)) || 0 : 0;
  }

  /** Prometheus text exposition format. */
  render() {
    const lines = [];
    for (const [name, series] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [key, value] of series) {
        lines.push(`${name}${key ? `{${key}}` : ''} ${value}`);
      }
    }
    for (const [name, gauge] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      if (gauge.fn) {
        lines.push(`${name} ${gauge.fn()}`);
      } else {
        for (const [key, value] of gauge) {
          lines.push(`${name}${key ? `{${key}}` : ''} ${value}`);
        }
      }
    }
    for (const [name, series] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      for (const [key, h] of series) {
        let cumulative = 0;
        for (let i = 0; i < this.buckets.length; i += 1) {
          cumulative += h.counts[i];
          const le = `le="${this.buckets[i]}"`;
          lines.push(`${name}_bucket{${key ? `${key},` : ''}${le}} ${cumulative}`);
        }
        cumulative += h.counts[this.buckets.length];
        lines.push(`${name}_bucket{${key ? `${key},` : ''}le="+Inf"} ${cumulative}`);
        lines.push(`${name}_sum${key ? `{${key}}` : ''} ${h.sum}`);
        lines.push(`${name}_count${key ? `{${key}}` : ''} ${h.count}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

module.exports = { Metrics };
