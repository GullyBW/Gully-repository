'use strict';

const { Rng } = require('./random');
const { sampleLocation, fullName } = require('./botswana');
const { SERVICE_CATEGORY_KEYS, BOOKING_STATUS, PAYMENT_STATUS, PAYMENT_METHODS, PROVIDER_AVAILABILITY, REVIEW_STATUS } =
  require('../../src/utils/constants');

/**
 * Deterministic dataset generator (Phase 2). Produces a coherent relational
 * graph across all domains with realistic Botswana geography. Object shapes
 * match exactly what the repositories store, so generated rows are
 * indistinguishable from rows written by the live application.
 *
 * Generation is proportional to the requested size; the default committed run
 * uses `small`, larger sizes are supported for ad-hoc capacity testing.
 */
const BOOKING_STATUS_WEIGHTS = [
  [BOOKING_STATUS.COMPLETED, 50],
  [BOOKING_STATUS.PENDING, 15],
  [BOOKING_STATUS.ACCEPTED, 12],
  [BOOKING_STATUS.IN_PROGRESS, 8],
  [BOOKING_STATUS.CANCELLED, 10],
  [BOOKING_STATUS.DECLINED, 5],
];
const PAYMENT_STATUS_WEIGHTS = [
  [PAYMENT_STATUS.SUCCEEDED, 70],
  [PAYMENT_STATUS.PENDING, 12],
  [PAYMENT_STATUS.PROCESSING, 6],
  [PAYMENT_STATUS.FAILED, 7],
  [PAYMENT_STATUS.REFUNDED, 5],
];
const METHOD_WEIGHTS = [
  [PAYMENT_METHODS.ORANGE_MONEY, 40],
  [PAYMENT_METHODS.MYZAKA, 25],
  [PAYMENT_METHODS.CARD, 25],
  [PAYMENT_METHODS.BANK_TRANSFER, 10],
];

function dateWithin(rng, daysBack) {
  const ms = Date.now() - rng.int(0, daysBack) * 86400000 - rng.int(0, 86400000);
  return new Date(ms);
}

function buildDataset(size, seed) {
  const rng = new Rng(seed);
  const now = new Date();

  const providerCount = size.providers;
  const customerCount = Math.max(size.users - providerCount, Math.ceil(providerCount * 0.5));
  const adminCount = Math.max(2, Math.round(size.users * 0.001));

  const users = [];
  const providers = [];
  const availabilities = [];
  const savedAddresses = [];

  // ---- Provider users + profiles ----
  for (let i = 0; i < providerCount; i += 1) {
    const id = `prov-${i}`;
    const name = fullName(rng);
    const category = rng.pick(SERVICE_CATEGORY_KEYS);
    const extraCats = rng.bool(0.3) ? [rng.pick(SERVICE_CATEGORY_KEYS)] : [];
    const loc = sampleLocation(rng);
    const reviewCount = rng.int(0, 120);
    const rating = reviewCount ? Math.round(rng.float(3.4, 5) * 10) / 10 : 0;
    users.push({
      id,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}.${i}@example.bw`,
      passwordHash: '$2a$10$benchmarkbenchmarkbenchmarku',
      role: 'provider',
      phone: `+267 7${rng.int(1000000, 9999999)}`,
      emailVerified: true,
      createdAt: dateWithin(rng, 720),
    });
    providers.push({
      userId: id,
      businessName: `${name.split(' ')[0]}'s ${category.replace(/_/g, ' ')}`,
      fullName: name,
      bio: `Experienced ${category.replace(/_/g, ' ')} serving ${loc.city} and surrounding areas.`,
      category,
      categories: Array.from(new Set([category, ...extraCats])),
      yearsExperience: rng.int(1, 25),
      languages: ['Setswana', 'English'],
      startingPrice: rng.int(5, 80) * 1000, // thebe
      location: loc,
      verified: rng.bool(0.6),
      availabilityStatus: rng.weighted([
        [PROVIDER_AVAILABILITY.AVAILABLE, 60],
        [PROVIDER_AVAILABILITY.BUSY, 25],
        [PROVIDER_AVAILABILITY.OFFLINE, 10],
        [PROVIDER_AVAILABILITY.VACATION, 5],
      ]),
      responseTimeMinutes: rng.int(5, 240),
      rating,
      ratingSum: Math.round(rating * reviewCount),
      reviewCount,
      completedJobs: rng.int(0, 400),
      responseRate: rng.int(70, 100),
      cancellationRate: rng.int(0, 20),
      memberSince: dateWithin(rng, 720),
      createdAt: now,
      updatedAt: now,
    });
    availabilities.push({
      providerId: id,
      weeklyHours: { mon: '08:00-17:00', tue: '08:00-17:00', wed: '08:00-17:00' },
      holidays: [],
      vacations: [],
      updatedAt: now,
    });
  }

  // ---- Customers ----
  for (let i = 0; i < customerCount; i += 1) {
    const id = `cust-${i}`;
    const name = fullName(rng);
    users.push({
      id,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}.c${i}@example.bw`,
      passwordHash: '$2a$10$benchmarkbenchmarkbenchmarku',
      role: 'customer',
      phone: `+267 7${rng.int(1000000, 9999999)}`,
      emailVerified: rng.bool(0.85),
      createdAt: dateWithin(rng, 540),
    });
    const addrCount = rng.int(1, 3);
    for (let a = 0; a < addrCount; a += 1) {
      const loc = sampleLocation(rng);
      savedAddresses.push({
        id: `addr-${i}-${a}`,
        customerId: id,
        label: a === 0 ? 'Home' : rng.pick(['Work', 'Mom', 'Plot']),
        address: loc.address,
        lat: loc.lat,
        lng: loc.lng,
        isDefault: a === 0,
        createdAt: dateWithin(rng, 400),
      });
    }
  }

  // ---- Admins ----
  for (let i = 0; i < adminCount; i += 1) {
    users.push({
      id: `admin-${i}`,
      name: `Admin ${i}`,
      email: `admin${i}@tirelo.bw`,
      passwordHash: '$2a$10$benchmarkbenchmarkbenchmarku',
      role: 'admin',
      emailVerified: true,
      createdAt: dateWithin(rng, 720),
    });
  }

  const customerIds = Array.from({ length: customerCount }, (_, i) => `cust-${i}`);
  const providerIds = providers.map((p) => p.userId);

  // ---- Bookings (+ transactions, reviews, conversations, messages) ----
  const bookings = [];
  const transactions = [];
  const reviews = [];
  const conversations = [];
  const messages = [];
  const notifications = [];
  const favourites = [];
  const auditLogs = [];

  for (let i = 0; i < size.bookings; i += 1) {
    const customerId = rng.pick(customerIds);
    const provider = providers[rng.int(0, providers.length - 1)];
    const providerId = provider.userId;
    const status = rng.weighted(BOOKING_STATUS_WEIGHTS);
    const amount = rng.int(5, 200) * 1000;
    const createdAt = dateWithin(rng, 365);
    const ref = `BKG-${seed.toString(36).toUpperCase()}${i.toString(36).toUpperCase()}`;
    const loc = sampleLocation(rng);
    bookings.push({
      reference: ref,
      customerId,
      providerId,
      serviceType: provider.category,
      description: `Need a ${provider.category.replace(/_/g, ' ')} for a job in ${loc.city}.`,
      scheduledFor: new Date(createdAt.getTime() + rng.int(1, 14) * 86400000),
      location: loc,
      amount,
      currency: 'BWP',
      status,
      paymentReference: undefined,
      paymentStatus: undefined,
      createdAt,
      updatedAt: createdAt,
    });

    // Transactions for accepted/in-progress/completed bookings.
    if ([BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.COMPLETED].includes(status)) {
      const pstatus = rng.weighted(PAYMENT_STATUS_WEIGHTS);
      transactions.push({
        reference: `PAY-${seed.toString(36).toUpperCase()}${i.toString(36).toUpperCase()}`,
        bookingReference: ref,
        customerId,
        providerId,
        amount,
        currency: 'BWP',
        method: rng.weighted(METHOD_WEIGHTS),
        status: pstatus,
        createdAt: new Date(createdAt.getTime() + 3600000),
        updatedAt: new Date(createdAt.getTime() + 7200000),
        history: [{ status: 'pending', at: createdAt }],
      });
    }

    // Reviews for ~60% of completed bookings.
    if (status === BOOKING_STATUS.COMPLETED && rng.bool(0.6)) {
      reviews.push({
        id: `rev-${i}`,
        providerId,
        customerId,
        bookingReference: ref,
        rating: rng.int(3, 5),
        comment: rng.pick(['Great work', 'On time and professional', 'Highly recommend', 'Good value', 'Will book again']),
        status: rng.bool(0.97) ? REVIEW_STATUS.PUBLISHED : REVIEW_STATUS.REPORTED,
        createdAt: new Date(createdAt.getTime() + 2 * 86400000),
      });
    }

    // Conversations + messages on ~15% of bookings.
    if (rng.bool(0.15)) {
      const convId = `conv-${i}`;
      const msgCount = rng.int(2, 8);
      const lastAt = new Date(createdAt.getTime() + msgCount * 60000);
      conversations.push({
        id: convId,
        bookingReference: ref,
        customerId,
        providerId,
        participants: [customerId, providerId],
        lastMessageAt: lastAt,
        createdAt,
      });
      for (let m = 0; m < msgCount; m += 1) {
        const sender = rng.bool(0.5) ? customerId : providerId;
        messages.push({
          id: `msg-${i}-${m}`,
          conversationId: convId,
          senderId: sender,
          body: rng.pick(['Hi, are you available?', 'Yes, I can come tomorrow', 'What is the address?', 'On my way', 'Thank you!']),
          readBy: [sender],
          reactions: {},
          createdAt: new Date(createdAt.getTime() + m * 60000),
        });
      }
    }
  }

  // ---- Favourites: each customer favourites a few providers ----
  for (const customerId of customerIds) {
    const n = rng.int(0, 5);
    const chosen = new Set();
    for (let k = 0; k < n; k += 1) chosen.add(rng.pick(providerIds));
    let idx = 0;
    for (const providerId of chosen) {
      favourites.push({
        id: `fav-${customerId}-${idx}`,
        customerId,
        providerId,
        createdAt: dateWithin(rng, 200),
      });
      idx += 1;
    }
  }

  // ---- Notifications: a handful per user ----
  for (const u of users) {
    if (u.role === 'admin') continue;
    const n = rng.int(0, 6);
    for (let k = 0; k < n; k += 1) {
      notifications.push({
        id: `ntf-${u.id}-${k}`,
        userId: u.id,
        type: 'announcement',
        title: 'Update',
        body: 'You have an update on Tirelo Services.',
        read: rng.bool(0.5),
        createdAt: dateWithin(rng, 120),
      });
    }
  }

  // ---- Audit logs ----
  const auditCount = Math.min(users.length, 5000);
  for (let i = 0; i < auditCount; i += 1) {
    auditLogs.push({
      id: `audit-${i}`,
      action: rng.weighted([['login', 60], ['login_failed', 15], ['token_refresh', 15], ['provider_verified', 10]]),
      actorId: rng.pick(customerIds),
      meta: {},
      createdAt: dateWithin(rng, 90),
    });
  }

  return {
    counts: {
      users: users.length,
      providers: providers.length,
      bookings: bookings.length,
      transactions: transactions.length,
      reviews: reviews.length,
      conversations: conversations.length,
      messages: messages.length,
      favourites: favourites.length,
      notifications: notifications.length,
      savedAddresses: savedAddresses.length,
      auditLogs: auditLogs.length,
    },
    users,
    providers,
    availability: availabilities,
    bookings,
    transactions,
    reviews,
    conversations,
    messages,
    favourites,
    notification: notifications,
    savedAddress: savedAddresses,
    auditLog: auditLogs,
    // Convenience handles for scenarios.
    sample: { customerIds, providerIds, categories: SERVICE_CATEGORY_KEYS },
  };
}

module.exports = { buildDataset };
