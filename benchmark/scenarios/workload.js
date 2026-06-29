'use strict';

const { measure } = require('../lib/stats');

/**
 * Phase 4 — Marketplace workload simulation.
 *
 * Times the repository work behind realistic customer / provider / admin
 * actions against PostgreSQL with the dataset loaded. Each "flow" is the set of
 * repository calls a single screen/action makes; latency here is the DB portion
 * of the request (no HTTP / serialization overhead).
 */
async function run(ctx) {
  const { drivers, dataset } = ctx;
  const driver = drivers.find((d) => d.name === 'postgres') || drivers[0];
  const repos = driver.repos;
  const { customerIds, providerIds } = dataset.sample;
  const pick = (arr, i) => arr[i % arr.length];

  const flows = [];

  // --- Customer: discover providers (filter + rank + page) ---
  flows.push(['customer: discover (category+rank)', await measure('discover', async (i) => {
    const list = await repos.provider.query({ category: 'plumber', availableOnly: true });
    list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return list.slice(0, 20);
  }, { samples: 800 })]);

  // --- Customer: open a provider profile + its reviews ---
  flows.push(['customer: provider profile + reviews', await measure('profile', async (i) => {
    const pid = pick(providerIds, i);
    await repos.provider.findByUserId(pid);
    return repos.review.listByProvider(pid, { limit: 10 });
  }, { samples: 1000 })]);

  // --- Customer: create a booking + notify provider ---
  let b = 0;
  flows.push(['customer: create booking (+notify)', await measure('book', async (i) => {
    const ref = `BKG-WL-${i}-${b}`;
    b += 1;
    const customerId = pick(customerIds, i);
    const providerId = pick(providerIds, i);
    await repos.booking.create({
      reference: ref, customerId, providerId, serviceType: 'plumber',
      amount: 50000, currency: 'BWP', status: 'pending', createdAt: new Date(), updatedAt: new Date(),
    });
    return repos.notification.create({
      id: `ntf-wl-${i}-${b}`, userId: providerId, type: 'new_booking', title: 'New booking',
      body: ref, read: false, createdAt: new Date(),
    });
  }, { samples: 800 })]);

  // --- Provider: dashboard (incoming bookings + recent reviews) ---
  flows.push(['provider: dashboard', await measure('dashboard', async (i) => {
    const pid = pick(providerIds, i);
    await repos.booking.listByProvider(pid, { limit: 20 });
    return repos.review.listByProvider(pid, { limit: 5 });
  }, { samples: 1000 })]);

  // --- Provider: unread notifications badge ---
  flows.push(['provider: unread badge', await measure('unread', async (i) => {
    const pid = pick(providerIds, i);
    return repos.notification.countUnread(pid);
  }, { samples: 1000 })]);

  // --- Admin: dashboard aggregations ---
  flows.push(['admin: dashboard stats', await measure('admin', async () => {
    await repos.booking.countByStatus('completed');
    await repos.booking.countByStatus('pending');
    await repos.transaction.sumByStatus('succeeded');
    await repos.user.countByRole('provider');
    return repos.user.countByRole('customer');
  }, { samples: 400 })]);

  const rows = flows.map(([label, s]) => [label, s.p50, s.p95, s.p99, s.throughput]);

  return {
    title: 'Phase 4 — Marketplace workload simulation',
    description: `Repository latency behind realistic actions (driver: ${driver.name}).`,
    tables: [{
      title: 'Per-flow latency (DB portion)',
      columns: ['Flow', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)', 'flows/s'],
      rows,
    }],
    notes: [
      'Admin "dashboard stats" runs 5 aggregate queries; latency shown is for the whole bundle.',
      'These are the same repository methods the controllers call — no business logic was duplicated.',
    ],
    raw: flows.map(([label, s]) => ({ label, ...s })),
  };
}

module.exports = { run };
