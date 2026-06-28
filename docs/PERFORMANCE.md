# Performance audit

## Backend optimizations in place

| Area | Implementation |
| --- | --- |
| Compression | `compression` (gzip) on all responses |
| Response caching | `responseCache` middleware + `CacheService` (Redis or in-memory) on public GETs (e.g. categories) |
| DB indexing | Indexes on lookup fields (`reference`, `userId`, `email`, `status`, `providerId`, geo lat/lng, `createdAt`) across schemas |
| Query shaping | `.lean()` reads, capped result sets, status-class counters instead of full scans for stats |
| Payload size | JSON body limit 1mb; minor-unit integers (no float math) |
| Connection mgmt | Graceful shutdown drains HTTP + Mongo + cache; keep-alive via proxy |

## Frontend optimizations in place

| Area | Implementation |
| --- | --- |
| Lazy routes | Every page is a lazy-loaded standalone component; `PreloadAllModules` warms them |
| Heavy libs isolated | `chart.js`, `xlsx`, `jspdf` load only on analytics/export pages (lazy chunks), not the initial bundle |
| Images | `loading="lazy"` on provider/portfolio/recent images; thumbnails generated server-side (sharp) |
| Caching | Service worker (ngsw) prefetches the app shell, lazily caches assets, freshness-caches `/api/categories` |
| Realtime | Single shared, auto-reconnecting Socket.IO connection (battery friendly) |
| Scrolling | Infinite scroll on provider lists; scroll-position restoration |

## How to measure

```bash
# API latency (local in-memory server)
PORT=4010 node src/test-server.js &
npx autocannon -c 20 -d 10 http://127.0.0.1:4010/api/categories

# Bundle analysis
cd mobile && npx ng build --configuration production --stats-json
npx webpack-bundle-analyzer www/stats.json

# Web vitals (LCP / INP / CLS) — serve the PWA and run Lighthouse
npx lighthouse http://localhost:8100 --preset=desktop --view
```

## Targets & thresholds

| Metric | Target |
| --- | --- |
| API p95 latency (cached GET) | < 100 ms |
| API p95 latency (write) | < 300 ms |
| Initial JS (gzipped) | < 500 KB (budget warns at 3 MB raw, errors at 6 MB) |
| LCP | < 2.5 s |
| INP | < 200 ms |
| CLS | < 0.1 |

## Recommendations

1. Run **Lighthouse** against the hosted PWA and record LCP/INP/CLS per release;
   add a CI Lighthouse-CI job if budgets are exceeded.
2. Enable **Redis** in multi-instance deployments so cache + rate limiting are shared.
3. Add **compound indexes** for the hottest provider-search filter combinations
   once production query patterns are known; consider a Mongo `2dsphere` index
   if geo search volume grows (current haversine ranking is in-process).
4. Serve images via a **CDN** and adopt cloud object storage (`STORAGE_DRIVER`).
5. Monitor 5xx rate and p95 latency via `/metrics/prometheus` + Grafana.
