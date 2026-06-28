# Administrator manual

Admin accounts are provisioned out-of-band (the public sign-up only creates
customers/providers). Seed an admin by inserting a user with `role: 'admin'`
(see `BlockService`/repo usage) or via your ops tooling, then log in normally.

Open **Profile → Admin portal** (`/admin`).

## Dashboard
Totals for users, customers, providers (active/verified), bookings by status and
revenue, plus payment success/failure counts and charts.

## Provider management (`/admin/providers`)
- Search providers; **Verify** to grant the badge; **Suspend/Reinstate**
  accounts (suspended users can't log in). Open a provider to view their public
  profile, ratings and completed jobs. All actions are audited.

## Customer management (`/admin/users`)
- Search customers; view verification status; suspend/reinstate.

## Booking management (`/admin/bookings`)
- Filter by status; **cancel** a booking with a reason (audited).

## Payment monitoring (`/admin/payments`)
- Filter by status (succeeded/pending/failed/refunded). Request a **refund**
  (recorded + audited; gateway execution remains in the payment module).

## Review moderation (`/admin/reviews`)
- Queue of **reported** reviews; **Remove** or **Reinstate** (rating recomputes).

## Broadcast centre (`/admin/broadcast`)
- Send announcements / service-interruption / promo / emergency alerts to all
  users, customers only, or providers only.

## Audit logs (`/admin/audit-logs`)
- Searchable by action: logins, failed logins, verifications, suspensions,
  refunds, broadcasts, conversation reports, etc.

## Analytics (`/analytics/admin`)
- Revenue, popular services, peak hours, geographic demand, top providers, with
  CSV/Excel/PDF export.
