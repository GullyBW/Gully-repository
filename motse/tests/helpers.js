'use strict';

const { createPlatform } = require('../src/container');

/**
 * Test world builder: a platform with the common cast —
 *  - admin: L3 institutional (bootstrap)
 *  - ward + headman (L3, headman_office role, in verification circle)
 *  - mma (L2, ward-verified, morafe member) — an elder contributor
 *  - kabo (L1, phone-verified) — an ordinary member with a funded wallet
 *  - provider clearing account (mobile money mirror)
 */
function world() {
  const p = createPlatform();

  const admin = p.identity.registerAnonymous('dev-admin');
  p.identity.grantInstitutional(admin.id, { institution: 'Motse Platform Ops' }, 'system:bootstrap');

  const ward = p.kgotla.createWard({ district: 'central', name: 'Mmadinare-03' });

  const headman = p.identity.registerAnonymous('dev-headman');
  p.identity.grantInstitutional(
    headman.id,
    { institution: `Headman office ${ward.name}` },
    'system:bootstrap'
  );
  p.identity.grantRole(headman.id, 'headman_office', `ward:${ward.id}`, 'system:bootstrap');

  const mma = verifiedUser(p, '+26771000001', 'dev-mma');
  p.identity.endorseWardResidency(mma.id, ward.id, headman.id);
  p.identity.joinMorafe(mma.id, 'bakalanga', headman.id);

  const kabo = verifiedUser(p, '+26771000002', 'dev-kabo');

  const providerClearing = p.ledger.openAccount('orange_money', 'provider_clearing');
  const kaboWallet = fundedWallet(p, kabo.id, providerClearing.id, 100000); // BWP 1000
  const mmaWallet = fundedWallet(p, mma.id, providerClearing.id, 100000);

  return {
    p,
    admin: p.identity.get(admin.id),
    ward,
    headman: p.identity.get(headman.id),
    mma: p.identity.get(mma.id),
    kabo: p.identity.get(kabo.id),
    providerClearing,
    kaboWallet,
    mmaWallet,
  };
}

let msisdnSeq = 0;

function verifiedUser(p, msisdn, deviceId) {
  const { sandbox_code } = p.identity.requestOtp(msisdn);
  const { user } = p.identity.verifyOtp(msisdn, sandbox_code, { deviceId });
  return user;
}

function freshVerifiedUser(p, deviceId = 'dev-x') {
  msisdnSeq += 1;
  return verifiedUser(p, `+2677199${String(msisdnSeq).padStart(4, '0')}`, deviceId);
}

function fundedWallet(p, ownerRef, providerAccountId, amountMinor) {
  const wallet = p.ledger.openAccount(ownerRef, 'user_wallet');
  p.ledger.providerDeposit({
    providerAccountId,
    destAccountId: wallet.id,
    amountMinor,
    providerTxRef: `topup:${wallet.id}`,
    idempotencyKey: `topup:${wallet.id}`,
  });
  return wallet;
}

/** A published, consented heritage item. */
function publishedItem(w, { visibility = 'public', title = 'Dikgang tsa pele' } = {}) {
  const consent = w.p.heritage.recordConsent({
    subjectRef: w.mma.id,
    spokenAudioRef: 'med_consent_audio',
    language: 'tn',
    scope: 'heritage_contribution',
  });
  const item = w.p.heritage.submit(w.mma.id, {
    type: 'audio',
    narratorRef: w.mma.id,
    morafeRef: 'bakalanga',
    visibility,
    consentRef: consent.id,
    mediaRefs: [],
    title,
  });
  return w.p.heritage.publish(item.id, w.mma.id);
}

/** A live campaign with two milestones (60/40) and an escrow. */
function liveCampaign(w, { campaignClass = 'community', targetMinor = 50000 } = {}) {
  const campaign = w.p.kgetsi.open(w.kabo.id, {
    campaignClass,
    title: 'Standpipe repair',
    targetMinor,
    milestones: [
      { description: 'Materials', amount_minor: Math.round(targetMinor * 0.6) },
      { description: 'Labour', amount_minor: targetMinor - Math.round(targetMinor * 0.6) },
    ],
  });
  w.p.kgetsi.endorse(campaign.id, w.admin.id, 'VDC verified');
  return w.p.kgetsi.goLive(campaign.id, w.admin.id);
}

/** Grant a fresh L3 platform_admin (as the bootstrap endpoint would). */
function adminUser(p, deviceId = 'dev-padmin') {
  const user = p.identity.registerAnonymous(deviceId);
  p.identity.grantInstitutional(user.id, { institution: 'Motse Ops' }, 'system:bootstrap');
  p.identity.grantRole(user.id, 'platform_admin', 'platform', 'system:bootstrap');
  return p.identity.get(user.id);
}

module.exports = {
  world,
  verifiedUser,
  freshVerifiedUser,
  fundedWallet,
  publishedItem,
  liveCampaign,
  adminUser,
};
