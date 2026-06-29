# API documentation & Postman

Machine-readable API docs for the Tirelo Services backend live in
[`docs/api/`](./api/) and are generated from a single source of truth
([`docs/api/api-spec.js`](./api/api-spec.js)) so they never drift from the code.

| File | Use |
| --- | --- |
| [`docs/api/openapi.json`](./api/openapi.json) | OpenAPI 3.0 spec — import into Postman, Swagger UI, Insomnia, Stoplight, code generators |
| [`docs/api/tirelo-services.postman_collection.json`](./api/tirelo-services.postman_collection.json) | Ready-to-use Postman collection (90 requests, 17 folders) |
| [`docs/api/tirelo-services.postman_environment.json`](./api/tirelo-services.postman_environment.json) | Postman environment (`baseUrl`, `accessToken`, `refreshToken`) |

Regenerate after changing routes:

```bash
npm run docs:api
```

## Import into Postman

**Option A — the Postman collection (recommended).** It already has Bearer auth,
variables and token auto-capture wired up.

1. Postman → **Import** → drop in `tirelo-services.postman_collection.json`
   **and** `tirelo-services.postman_environment.json`.
2. Top-right environment selector → choose **“Tirelo Services — Local”**
   (or edit `baseUrl`, default `http://localhost:4000`).
3. Open **Auth → POST /api/auth/login**, set an email/password, **Send**. A test
   script saves `accessToken` + `refreshToken` into the collection
   automatically — every authenticated request then just works.
4. Send any other request. The collection applies `Authorization: Bearer
   {{accessToken}}` to all non-public endpoints; public ones are marked
   *No Auth*.

**Option B — the OpenAPI spec.** Postman → **Import** →
`docs/api/openapi.json`. Postman generates a collection from it. You won't get
the token-capture scripts (Option A has those), so set the `accessToken`
variable yourself after logging in.

## Conventions

- **Envelope:** success is `{ "success": true, "data": ... }`; errors are
  `{ "success": false, "error": { "message", "details"? } }`.
- **Auth:** `Authorization: Bearer <accessToken>`. Get tokens from
  `POST /api/auth/login` or `/register`; rotate via `POST /api/auth/refresh`.
- **Money:** integer **minor units** (thebe; 100 thebe = 1 BWP).
- **Roles:** each request's description notes the minimum role
  (`public` / `user` / `provider` / `admin`). To exercise admin/provider routes,
  log in as a user with that role.
- **Payments:** the `/api/payments/*` routes (including the gateway webhook) are
  unauthenticated by design — the app initiates payments through the Bookings
  endpoints, and the gateway calls the webhook with a signature header.

## Variables

| Variable | Meaning |
| --- | --- |
| `baseUrl` | API origin, e.g. `http://localhost:4000` |
| `accessToken` | JWT access token (auto-set on login/register/refresh) |
| `refreshToken` | refresh token (auto-set on login/register/refresh) |

Path parameters (`:id`, `:reference`, `:userId`, `:providerId`,
`:bookingReference`, `:kind`, `:token`, `:method`) appear as editable URL
variables on each request.

For a prose overview of the API see [`API_REFERENCE.md`](./API_REFERENCE.md).
