# API reference

Full endpoint tables (with auth/roles and examples) live in the root
[`README.md`](../README.md). All responses use `{ success, data }`; errors use
`{ success: false, error: { message, details? } }`.

## Endpoint groups

| Base | Area |
| --- | --- |
| `/api/auth` | register, login, refresh, logout, verify-email, forgot/reset-password, me, sessions |
| `/api/categories` | service categories |
| `/api/providers` | discovery search, profile, upsert, availability status, verify (admin) |
| `/api/reviews` | provider reviews, mine, create, edit, report, moderate (admin) |
| `/api/favourites` | save / list / remove |
| `/api/availability` | provider config + bookable slots |
| `/api/addresses` | saved customer addresses |
| `/api/bookings` | create, list, status, pay, payment status |
| `/api/payments` | methods, create, fetch, list, cancel, webhook (**module frozen**) |
| `/api/messages` | conversations, history, send, read, react, report |
| `/api/blocks` | list / block / unblock a user |
| `/api/notifications` | list, unread-count, read, devices, preferences |
| `/api/geo` | search, geocode, reverse, distance, directions |
| `/api/uploads/:kind` | secure image upload |
| `/api/admin` | dashboard, users, providers verify, suspend, bookings, payments, refund, broadcast, reviews, audit-logs |
| `/api/analytics` | provider / customer / admin + CSV export |

## Operational endpoints (no `/api` prefix)

| Path | Purpose |
| --- | --- |
| `GET /health`, `/health/live`, `/health/ready` | liveness / readiness probes |
| `GET /metrics` | JSON metrics |
| `GET /metrics/prometheus` | Prometheus text exposition |

## Added in release engineering (all additive, backward compatible)
`GET /api/reviews/mine`, `GET /api/admin/reviews`, `POST /api/messages/:ref/react`,
`POST /api/messages/:ref/report`, `/api/blocks/*`, `GET /api/geo/directions`,
`/metrics`, `/metrics/prometheus`.
