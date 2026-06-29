-- Tirelo Services — PostgreSQL schema.
-- Each table stores the full domain object in a JSONB `doc` column (the source
-- of truth returned to services) plus extracted columns for indexing/filtering.
-- Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE,
  role text,
  email_verification_token text,
  password_reset_token text,
  doc jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS providers (
  user_id text PRIMARY KEY,
  category text,
  verified boolean DEFAULT false,
  availability_status text,
  rating numeric DEFAULT 0,
  starting_price numeric,
  business_name text,
  full_name text,
  bio text,
  doc jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_category ON providers(category);
CREATE INDEX IF NOT EXISTS idx_providers_rating ON providers(rating);

CREATE TABLE IF NOT EXISTS bookings (
  reference text PRIMARY KEY,
  customer_id text,
  provider_id text,
  status text,
  created_at timestamptz,
  doc jsonb NOT NULL
);
-- Single-column lookup indexes are superseded by the composite
-- (owner/status, created_at DESC) indexes defined in the optimization section
-- below, whose leading column also serves equality lookups.

CREATE TABLE IF NOT EXISTS transactions (
  reference text PRIMARY KEY,
  customer_id text,
  provider_id text,
  status text,
  method text,
  amount numeric,
  created_at timestamptz,
  doc jsonb NOT NULL
);
-- Lookup indexes for transactions are the composites in the optimization section.

CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  provider_id text,
  customer_id text,
  booking_reference text UNIQUE,
  status text,
  created_at timestamptz,
  doc jsonb NOT NULL
);
-- idx_reviews_provider is superseded by the composite (provider_id, created_at).
CREATE INDEX IF NOT EXISTS idx_reviews_customer ON reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE TABLE IF NOT EXISTS favourites (
  id text PRIMARY KEY,
  customer_id text,
  provider_id text,
  created_at timestamptz,
  doc jsonb NOT NULL,
  UNIQUE (customer_id, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_favourites_customer ON favourites(customer_id);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text,
  read boolean DEFAULT false,
  created_at timestamptz,
  doc jsonb NOT NULL
);
-- Notification lookup/sort served by the composite + partial indexes below.

CREATE TABLE IF NOT EXISTS availabilities (
  provider_id text PRIMARY KEY,
  doc jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id text PRIMARY KEY,
  user_id text,
  token_hash text,
  revoked boolean DEFAULT false,
  expires_at timestamptz,
  doc jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  action text,
  actor_id text,
  created_at timestamptz,
  doc jsonb NOT NULL
);
-- Audit lookups served by idx_audit_actor + idx_audit_action_created below.

CREATE TABLE IF NOT EXISTS device_tokens (
  token text PRIMARY KEY,
  user_id text,
  doc jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_user ON device_tokens(user_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id text PRIMARY KEY,
  doc jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_addresses (
  id text PRIMARY KEY,
  customer_id text,
  doc jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON saved_addresses(customer_id);

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  booking_reference text UNIQUE,
  customer_id text,
  provider_id text,
  last_message_at timestamptz,
  doc jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  conversation_id text,
  created_at timestamptz,
  doc jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- ---------------------------------------------------------------------------
-- Performance indexes (validated by benchmark/scenarios/query-analysis.js).
-- These are additive and idempotent; they back the hot read paths the
-- repositories actually issue (list-by-owner ordered by recency, status +
-- recency filters, JSONB category containment, unread-notification counts).
-- The repository/service code is unchanged — only the access paths improve.
-- ---------------------------------------------------------------------------

-- Provider discovery: extra single-column filters used by PgProviderRepository.query
CREATE INDEX IF NOT EXISTS idx_providers_availability ON providers(availability_status);
CREATE INDEX IF NOT EXISTS idx_providers_starting_price ON providers(starting_price);
-- Multi-category providers are matched with `doc->'categories' @> ...`; a GIN
-- index makes that containment check an index scan instead of a seq scan.
CREATE INDEX IF NOT EXISTS idx_providers_categories_gin ON providers USING gin ((doc->'categories'));

-- Bookings/transactions/reviews: list-by-owner is always ORDER BY created_at DESC,
-- so a composite (owner, created_at DESC) serves filter+sort from one index.
CREATE INDEX IF NOT EXISTS idx_bookings_customer_created ON bookings(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_provider_created ON bookings(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status_created ON bookings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_created ON transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status_created ON transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_provider_created ON reviews(provider_id, created_at DESC);

-- Notifications: list newest-first per user, and a partial index for the very
-- hot "unread count" / "unread list" path (read=false is a small subset).
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read = false;

-- Messages: history is conversation_id + ORDER BY created_at.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

-- Conversations: listByParticipant matches customer_id OR provider_id, newest first.
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_provider ON conversations(provider_id, last_message_at DESC);

-- Audit logs: admin viewer filters by actor and/or action, newest first.
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_logs(action, created_at DESC);

-- Drop the single-column indexes that the composites above fully supersede
-- (their leading column also answers the old equality lookups). Keeps write
-- amplification and storage down. Idempotent on fresh and existing databases.
DROP INDEX IF EXISTS idx_bookings_customer;
DROP INDEX IF EXISTS idx_bookings_provider;
DROP INDEX IF EXISTS idx_bookings_status;
DROP INDEX IF EXISTS idx_transactions_customer;
DROP INDEX IF EXISTS idx_transactions_status;
DROP INDEX IF EXISTS idx_reviews_provider;
DROP INDEX IF EXISTS idx_notifications_user;
DROP INDEX IF EXISTS idx_audit_action;
