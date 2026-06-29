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
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

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
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  provider_id text,
  customer_id text,
  booking_reference text UNIQUE,
  status text,
  created_at timestamptz,
  doc jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_provider ON reviews(provider_id);
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
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

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
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

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
