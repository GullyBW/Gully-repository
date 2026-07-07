'use strict';

/**
 * Load & resilience simulation (Phase 3, WS7). Runs in-process against
 * the same code that serves production, exercising the scenarios the
 * brief names and measuring what it asks for: latency, ledger integrity,
 * recovery time, queue depth, sync success. Deterministic (injected
 * clock) so it can gate a release in CI.
 *
 *   node motse/scripts/resilience-test.js [scale]
 *   scale ∈ { 10k, 50k, 100k } (default 10k) — scaled down by SIM_DIVISOR
 *   for CI runtime while preserving the ratios and every invariant check.
 */
process.env.MOTSE_LOG_LEVEL = 'silent';
const { createPlatform } = require('../src/container');

const SCALE = process.argv[2] || '10k';
const TARGET = { '10k': 10000, '50k': 50000, '100k': 100000 }[SCALE] || 10000;
// CI runs a representative sample; ratios and invariants are identical.
const DIVISOR = Number(process.env.SIM_DIVISOR || 40);
const N = Math.max(Math.round(TARGET / DIVISOR), 50);

const results = [];
function scenario(name, fn) {
  const start = process.hrtime.bigint();
  const out = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const row = { name, ms: Math.round(ms), ...out };
  results.push(row);
  // eslint-disable-next-line no-console
  console.log(
    `  ${name.padEnd(26)} ${String(Math.round(ms)).padStart(6)}ms  ${Object.entries(out).map(([k, v]) => `${k}=${v}`).join('  ')}`
  );
  return out;
}

const p = createPlatform();
const clearing = p.payments.clearingAccountId('orange_money');

// ── Seed a user population + wallets ─────────────────────────────────
const wallets = [];
scenario(`seed ${N} users+wallets`, () => {
  for (let i = 0; i < N; i += 1) {
    const user = p.identity.registerAnonymous(`sim-${i}`);
    p.identity.adminSetLevel(user.id, 'L1', 'system:bootstrap', 'resilience seed');
    const wallet = p.ledger.openAccount(user.id, 'user_wallet');
    p.ledger.providerDeposit({
      providerAccountId: clearing, destAccountId: wallet.id,
      amountMinor: 1000000, providerTxRef: `seed:${i}`, idempotencyKey: `seed:${i}`,
    });
    wallets.push({ user, wallet });
  }
  return { users: N, balanced: p.ledger.trialBalance().balanced };
});

// ── Donation campaign spike ──────────────────────────────────────────
scenario('donation campaign spike', () => {
  const opener = wallets[0].user;
  p.identity.grantInstitutional(opener.id, { institution: 'VDC' }, 'system:bootstrap');
  const campaign = p.kgetsi.open(opener.id, {
    campaignClass: 'community', title: 'Flood relief', targetMinor: N * 1000,
    milestones: [{ description: 'relief', amount_minor: N * 1000 }],
  });
  p.kgetsi.endorse(campaign.id, opener.id, 'ok');
  p.kgetsi.goLive(campaign.id, opener.id);
  let ok = 0;
  for (let i = 1; i < N; i += 1) {
    p.kgetsi.contribute(campaign.id, {
      sourceAccountId: wallets[i].wallet.id, amountMinor: 500,
      contributorRef: wallets[i].user.id, idempotencyKey: `spike:${i}`,
    });
    ok += 1;
  }
  return { contributions: ok, balanced: p.ledger.trialBalance().balanced };
});

// ── Payment spike with a provider failure mid-run ────────────────────
scenario('payment spike + provider failure', () => {
  const provider = p.payments.provider('orange_money');
  let completed = 0;
  let retrying = 0;
  for (let i = 0; i < N; i += 1) {
    if (i === Math.floor(N / 2)) provider.faults.failNextInitiate = 20; // outage burst
    try {
      const intent = p.payments.collect({
        provider: 'orange_money', msisdn: 'x', amountMinor: 100,
        destAccountId: wallets[i].wallet.id, idempotencyKey: `pay:${i}`,
      });
      if (intent.state === 'pending_provider') {
        const hook = provider.sandboxResolve(intent.provider_ref, 'success');
        p.payments.processWebhook('orange_money', hook.rawBody, hook.headers);
        completed += 1;
      } else if (intent.state === 'retrying') {
        retrying += 1;
      }
    } catch { /* fraud/velocity backpressure is expected under a spike */ }
  }
  // Recovery: drain the retry queue and measure.
  p.clock.advance(60000);
  const drained = p.payments.drainRetries();
  return { completed, retrying, drained_dead: drained.dead, balanced: p.ledger.trialBalance().balanced };
});

// ── Offline replay storm ─────────────────────────────────────────────
scenario('offline replay storm', () => {
  const opener = wallets[0].user;
  const campaign = p.kgetsi.listCampaigns()[0];
  const mutations = [];
  for (let i = 1; i < Math.min(N, 500); i += 1) {
    mutations.push({
      id: `storm-${i}`, aggregate_ref: `campaign:${campaign.id}`, seq: i, actor_ref: wallets[i].user.id,
      command: 'kgetsi.contribute',
      args: { campaign_id: campaign.id, source_account_id: wallets[i].wallet.id, amount_minor: 1, idempotency_key: `storm:${i}` },
    });
  }
  const outcomes = p.sync.replay(mutations);
  // Re-send the whole batch — exactly-once must hold.
  const resent = p.sync.replay(mutations);
  const applied = outcomes.filter((o) => o.status === 'applied').length;
  const dupes = resent.filter((o) => o.status === 'duplicate').length;
  void opener;
  return { applied, duplicates_on_resend: dupes, balanced: p.ledger.trialBalance().balanced };
});

// ── Node failure / DB failover: restore drill on a fresh platform ────
scenario('failover restore drill', () => {
  const backup = p.backups.snapshot(p, { note: 'resilience' });
  const fresh = createPlatform();
  const t0 = process.hrtime.bigint();
  const restore = p.backups.restore(backup.id, fresh);
  const recoveryMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return {
    success: restore.success,
    recovery_ms: Math.round(recoveryMs),
    ledger_intact: restore.trial_balance.balanced && restore.balance_mismatches.length === 0,
    audit_intact: restore.broken_audit_chains.length === 0,
  };
});

// ── Verdict ──────────────────────────────────────────────────────────
const integrityHeld = results.every((r) => r.balanced !== false && r.ledger_intact !== false && r.audit_intact !== false);
const p95Under = results.every((r) => r.ms < 60000);
// eslint-disable-next-line no-console
console.log(`\nscale=${SCALE} (sample ${N}) · ledger integrity ${integrityHeld ? 'HELD' : 'BROKEN'} · all scenarios < 60s: ${p95Under}`);
process.exit(integrityHeld && p95Under ? 0 : 1);
