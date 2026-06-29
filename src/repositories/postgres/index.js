'use strict';

const { query } = require('../../db/postgres');

/**
 * PostgreSQL repositories. Each entity is stored as a JSONB `doc` (the exact
 * domain object returned to services) plus extracted columns for indexing.
 * `DocStore` provides the shared CRUD; concrete repos add domain queries.
 *
 * The method set of every repository mirrors its in-memory/Mongo counterpart,
 * so services and the payment module work unchanged.
 */
class DocStore {
  constructor(table, columns) {
    this.table = table;
    this.columns = columns; // { colName: (doc) => value }
    this.colNames = Object.keys(columns);
  }

  _values(doc) {
    return this.colNames.map((c) => {
      const v = this.columns[c](doc);
      return v === undefined ? null : v;
    });
  }

  async insert(doc) {
    const cols = [...this.colNames, 'doc'];
    const ph = this.colNames.map((_, i) => `$${i + 1}`);
    ph.push(`$${this.colNames.length + 1}::jsonb`);
    await query(
      `INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${ph.join(',')})`,
      [...this._values(doc), JSON.stringify(doc)]
    );
    return doc;
  }

  async upsert(doc, conflict) {
    const cols = [...this.colNames, 'doc'];
    const ph = this.colNames.map((_, i) => `$${i + 1}`);
    ph.push(`$${this.colNames.length + 1}::jsonb`);
    const updates = cols
      .filter((c) => !conflict.includes(c))
      .map((c) => `${c}=EXCLUDED.${c}`)
      .join(',');
    await query(
      `INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${ph.join(',')})
       ON CONFLICT (${conflict.join(',')}) DO UPDATE SET ${updates}`,
      [...this._values(doc), JSON.stringify(doc)]
    );
    return doc;
  }

  async getOne(where, params) {
    const r = await query(`SELECT doc FROM ${this.table} WHERE ${where} LIMIT 1`, params);
    return r.rows[0] ? r.rows[0].doc : null;
  }

  async getMany(where, params, { order, limit } = {}) {
    let sql = `SELECT doc FROM ${this.table}`;
    if (where) sql += ` WHERE ${where}`;
    if (order) sql += ` ORDER BY ${order}`;
    if (limit) sql += ` LIMIT ${parseInt(limit, 10)}`;
    const r = await query(sql, params);
    return r.rows.map((row) => row.doc);
  }

  async count(where, params) {
    const sql = `SELECT count(*)::int AS n FROM ${this.table}${where ? ` WHERE ${where}` : ''}`;
    const r = await query(sql, params);
    return r.rows[0].n;
  }

  async deleteWhere(where, params) {
    const r = await query(`DELETE FROM ${this.table} WHERE ${where}`, params);
    return r.rowCount;
  }
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// ---- Users ----
class PgUserRepository extends DocStore {
  constructor() {
    super('users', {
      id: (d) => d.id,
      email: (d) => d.email,
      role: (d) => d.role,
      email_verification_token: (d) => d.emailVerificationToken,
      password_reset_token: (d) => d.passwordResetToken,
    });
  }
  create(u) { return this.insert(u); }
  save(u) { return this.upsert(u, ['id']); }
  findById(id) { return this.getOne('id=$1', [id]); }
  findByEmail(email) { return this.getOne('email=$1', [String(email).toLowerCase()]); }
  findByEmailVerificationToken(t) { return this.getOne('email_verification_token=$1', [t]); }
  findByPasswordResetToken(t) { return this.getOne('password_reset_token=$1', [t]); }
  countByRole(role) { return this.count('role=$1', [role]); }
  async search({ q, role, limit = 50 } = {}) {
    const conds = [];
    const params = [];
    if (role) { params.push(role); conds.push(`role=$${params.length}`); }
    if (q) { params.push(`%${q}%`); conds.push(`(doc->>'name' ILIKE $${params.length} OR doc->>'email' ILIKE $${params.length})`); }
    return this.getMany(conds.join(' AND ') || null, params, { limit: Math.min(limit, 200) });
  }
}

// ---- Providers ----
class PgProviderRepository extends DocStore {
  constructor() {
    super('providers', {
      user_id: (d) => d.userId,
      category: (d) => d.category,
      verified: (d) => !!d.verified,
      availability_status: (d) => d.availabilityStatus,
      rating: (d) => d.rating || 0,
      starting_price: (d) => (d.startingPrice == null ? null : d.startingPrice),
      business_name: (d) => d.businessName,
      full_name: (d) => d.fullName,
      bio: (d) => d.bio,
    });
  }
  create(p) { return this.insert(p); }
  save(p) { return this.upsert(p, ['user_id']); }
  findByUserId(userId) { return this.getOne('user_id=$1', [userId]); }
  async query(filter = {}) {
    const conds = [];
    const params = [];
    if (filter.category) {
      params.push(filter.category);
      conds.push(`(category=$${params.length} OR doc->'categories' @> to_jsonb($${params.length}::text))`);
    }
    if (filter.verifiedOnly) conds.push('verified = true');
    if (filter.availableOnly) conds.push(`availability_status = 'available'`);
    if (num(filter.minRating) != null) { params.push(num(filter.minRating)); conds.push(`rating >= $${params.length}`); }
    if (num(filter.maxPrice) != null) { params.push(num(filter.maxPrice)); conds.push(`(starting_price IS NOT NULL AND starting_price <= $${params.length})`); }
    if (filter.q) { params.push(`%${filter.q}%`); conds.push(`(business_name ILIKE $${params.length} OR full_name ILIKE $${params.length} OR bio ILIKE $${params.length})`); }
    return this.getMany(conds.join(' AND ') || null, params, { limit: 500 });
  }
}

// ---- Bookings ----
class PgBookingRepository extends DocStore {
  constructor() {
    super('bookings', {
      reference: (d) => d.reference,
      customer_id: (d) => d.customerId,
      provider_id: (d) => d.providerId,
      status: (d) => d.status,
      created_at: (d) => d.createdAt,
    });
  }
  create(b) { return this.insert(b); }
  save(b) { return this.upsert(b, ['reference']); }
  findByReference(ref) { return this.getOne('reference=$1', [ref]); }
  listByCustomer(id, { limit = 20 } = {}) { return this.getMany('customer_id=$1', [id], { order: 'created_at DESC', limit }); }
  listByProvider(id, { limit = 20 } = {}) { return this.getMany('provider_id=$1', [id], { order: 'created_at DESC', limit }); }
  query({ status, limit = 100 } = {}) {
    return status
      ? this.getMany('status=$1', [status], { order: 'created_at DESC', limit })
      : this.getMany(null, [], { order: 'created_at DESC', limit });
  }
  all() { return this.getMany(null, []); }
  countByStatus(status) { return status ? this.count('status=$1', [status]) : this.count(null, []); }
}

// ---- Transactions (payment storage — read methods only added; logic untouched) ----
class PgTransactionRepository extends DocStore {
  constructor() {
    super('transactions', {
      reference: (d) => d.reference,
      customer_id: (d) => d.customerId,
      provider_id: (d) => d.providerId,
      status: (d) => d.status,
      method: (d) => d.method,
      amount: (d) => d.amount,
      created_at: (d) => d.createdAt,
    });
  }
  create(t) { return this.insert(t); }
  save(t) { return this.upsert(t, ['reference']); }
  findByReference(ref) { return this.getOne('reference=$1', [ref]); }
  listByCustomer(id, { limit = 20 } = {}) { return this.getMany('customer_id=$1', [id], { order: 'created_at DESC', limit }); }
  query({ status, method, limit = 100 } = {}) {
    const conds = [];
    const params = [];
    if (status) { params.push(status); conds.push(`status=$${params.length}`); }
    if (method) { params.push(method); conds.push(`method=$${params.length}`); }
    return this.getMany(conds.join(' AND ') || null, params, { order: 'created_at DESC', limit });
  }
  all() { return this.getMany(null, []); }
  async sumByStatus(status) {
    const r = await query('SELECT COALESCE(SUM(amount),0)::bigint AS total FROM transactions WHERE status=$1', [status]);
    return Number(r.rows[0].total);
  }
}

// ---- Reviews ----
class PgReviewRepository extends DocStore {
  constructor() {
    super('reviews', {
      id: (d) => d.id,
      provider_id: (d) => d.providerId,
      customer_id: (d) => d.customerId,
      booking_reference: (d) => d.bookingReference,
      status: (d) => d.status,
      created_at: (d) => d.createdAt,
    });
  }
  create(r) { return this.insert(r); }
  save(r) { return this.upsert(r, ['id']); }
  findById(id) { return this.getOne('id=$1', [id]); }
  findByBooking(ref) { return this.getOne('booking_reference=$1', [ref]); }
  listByProvider(id, { limit = 20 } = {}) { return this.getMany('provider_id=$1', [id], { order: 'created_at DESC', limit }); }
  listByCustomer(id, { limit = 100 } = {}) { return this.getMany('customer_id=$1', [id], { order: 'created_at DESC', limit }); }
  listByStatus(status, { limit = 100 } = {}) {
    return status
      ? this.getMany('status=$1', [status], { order: 'created_at DESC', limit })
      : this.getMany(null, [], { order: 'created_at DESC', limit });
  }
}

// ---- Favourites ----
class PgFavouriteRepository extends DocStore {
  constructor() {
    super('favourites', {
      id: (d) => d.id,
      customer_id: (d) => d.customerId,
      provider_id: (d) => d.providerId,
      created_at: (d) => d.createdAt,
    });
  }
  create(f) { return this.insert(f); }
  find(c, p) { return this.getOne('customer_id=$1 AND provider_id=$2', [c, p]); }
  listByCustomer(c) { return this.getMany('customer_id=$1', [c], { order: 'created_at DESC' }); }
  async remove(c, p) { return (await this.deleteWhere('customer_id=$1 AND provider_id=$2', [c, p])) > 0; }
}

// ---- Notifications ----
class PgNotificationRepository extends DocStore {
  constructor() {
    super('notifications', {
      id: (d) => d.id,
      user_id: (d) => d.userId,
      read: (d) => !!d.read,
      created_at: (d) => d.createdAt,
    });
  }
  create(n) { return this.insert(n); }
  save(n) { return this.upsert(n, ['id']); }
  findById(id) { return this.getOne('id=$1', [id]); }
  listByUser(userId, { limit = 50, unreadOnly = false } = {}) {
    const where = unreadOnly ? 'user_id=$1 AND read=false' : 'user_id=$1';
    return this.getMany(where, [userId], { order: 'created_at DESC', limit });
  }
  countUnread(userId) { return this.count('user_id=$1 AND read=false', [userId]); }
  async markAllRead(userId) {
    await query(
      `UPDATE notifications SET read=true, doc=jsonb_set(doc,'{read}','true'::jsonb)
       WHERE user_id=$1 AND read=false`,
      [userId]
    );
  }
}

// ---- Availability ----
class PgAvailabilityRepository extends DocStore {
  constructor() { super('availabilities', { provider_id: (d) => d.providerId }); }
  findByProvider(id) { return this.getOne('provider_id=$1', [id]); }
  save(a) { return this.upsert(a, ['provider_id']); }
}

// ---- Refresh tokens ----
class PgRefreshTokenRepository extends DocStore {
  constructor() {
    super('refresh_tokens', {
      id: (d) => d.id,
      user_id: (d) => d.userId,
      token_hash: (d) => d.tokenHash,
      revoked: (d) => !!d.revoked,
      expires_at: (d) => d.expiresAt,
    });
  }
  create(r) { return this.insert(r); }
  save(r) { return this.upsert(r, ['id']); }
  findByHash(h) { return this.getOne('token_hash=$1', [h]); }
  listByUser(userId) { return this.getMany('user_id=$1', [userId], { order: 'expires_at DESC' }); }
  async revokeById(id) {
    const r = await query(`UPDATE refresh_tokens SET revoked=true, doc=jsonb_set(doc,'{revoked}','true'::jsonb) WHERE id=$1`, [id]);
    return r.rowCount > 0;
  }
  async revokeAllForUser(userId) {
    await query(`UPDATE refresh_tokens SET revoked=true, doc=jsonb_set(doc,'{revoked}','true'::jsonb) WHERE user_id=$1`, [userId]);
  }
}

// ---- Audit logs ----
class PgAuditLogRepository extends DocStore {
  constructor() {
    super('audit_logs', {
      id: (d) => d.id,
      action: (d) => d.action,
      actor_id: (d) => d.actorId,
      created_at: (d) => d.createdAt,
    });
  }
  create(e) { return this.insert(e); }
  list({ action, actorId, limit = 100 } = {}) {
    const conds = [];
    const params = [];
    if (action) { params.push(action); conds.push(`action=$${params.length}`); }
    if (actorId) { params.push(actorId); conds.push(`actor_id=$${params.length}`); }
    return this.getMany(conds.join(' AND ') || null, params, { order: 'created_at DESC', limit });
  }
}

// ---- Device tokens ----
class PgDeviceTokenRepository extends DocStore {
  constructor() { super('device_tokens', { token: (d) => d.token, user_id: (d) => d.userId }); }
  async upsert(record) {
    const existing = await this.getOne('token=$1', [record.token]);
    const doc = existing
      ? { ...existing, userId: record.userId, platform: record.platform, lastSeenAt: new Date() }
      : record;
    await super.upsert(doc, ['token']);
    return doc;
  }
  listByUser(userId) { return this.getMany('user_id=$1', [userId]); }
  async removeByToken(token) { return (await this.deleteWhere('token=$1', [token])) > 0; }
}

// ---- Notification preferences ----
class PgNotificationPreferenceRepository extends DocStore {
  constructor() { super('notification_preferences', { user_id: (d) => d.userId }); }
  findByUser(userId) { return this.getOne('user_id=$1', [userId]); }
  save(p) { return this.upsert(p, ['user_id']); }
}

// ---- Saved addresses ----
class PgSavedAddressRepository extends DocStore {
  constructor() { super('saved_addresses', { id: (d) => d.id, customer_id: (d) => d.customerId }); }
  create(a) { return this.insert(a); }
  save(a) { return this.upsert(a, ['id']); }
  findById(id) { return this.getOne('id=$1', [id]); }
  listByCustomer(c) { return this.getMany('customer_id=$1', [c], { order: `doc->>'createdAt' DESC` }); }
  async remove(id) { return (await this.deleteWhere('id=$1', [id])) > 0; }
  async clearDefault(customerId) {
    await query(`UPDATE saved_addresses SET doc=jsonb_set(doc,'{isDefault}','false'::jsonb) WHERE customer_id=$1`, [customerId]);
  }
}

// ---- Conversations ----
class PgConversationRepository extends DocStore {
  constructor() {
    super('conversations', {
      id: (d) => d.id,
      booking_reference: (d) => d.bookingReference,
      customer_id: (d) => d.customerId,
      provider_id: (d) => d.providerId,
      last_message_at: (d) => d.lastMessageAt,
    });
  }
  create(c) { return this.insert(c); }
  save(c) { return this.upsert(c, ['id']); }
  findById(id) { return this.getOne('id=$1', [id]); }
  findByBooking(ref) { return this.getOne('booking_reference=$1', [ref]); }
  listByParticipant(userId) { return this.getMany('customer_id=$1 OR provider_id=$1', [userId], { order: 'last_message_at DESC' }); }
}

// ---- Messages ----
class PgMessageRepository extends DocStore {
  constructor() {
    super('messages', {
      id: (d) => d.id,
      conversation_id: (d) => d.conversationId,
      created_at: (d) => d.createdAt,
    });
  }
  create(m) { return this.insert(m); }
  save(m) { return this.upsert(m, ['id']); }
  findById(id) { return this.getOne('id=$1', [id]); }
  async listByConversation(conversationId, { limit = 100 } = {}) {
    const r = await query(
      'SELECT doc FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT $2',
      [conversationId, Math.min(limit, 200)]
    );
    return r.rows.map((row) => row.doc).reverse();
  }
  async markRead(conversationId, userId) {
    await query(
      `UPDATE messages
         SET doc = jsonb_set(doc, '{readBy}', (doc->'readBy') || to_jsonb($2::text))
       WHERE conversation_id=$1 AND NOT (doc->'readBy' @> to_jsonb($2::text))`,
      [conversationId, userId]
    );
  }
}

/** Build the full set of PostgreSQL repositories. */
function buildPostgresRepositories() {
  return {
    transaction: new PgTransactionRepository(),
    user: new PgUserRepository(),
    booking: new PgBookingRepository(),
    provider: new PgProviderRepository(),
    review: new PgReviewRepository(),
    favourite: new PgFavouriteRepository(),
    notification: new PgNotificationRepository(),
    availability: new PgAvailabilityRepository(),
    refreshToken: new PgRefreshTokenRepository(),
    auditLog: new PgAuditLogRepository(),
    deviceToken: new PgDeviceTokenRepository(),
    notificationPreference: new PgNotificationPreferenceRepository(),
    savedAddress: new PgSavedAddressRepository(),
    conversation: new PgConversationRepository(),
    message: new PgMessageRepository(),
  };
}

module.exports = { buildPostgresRepositories };
