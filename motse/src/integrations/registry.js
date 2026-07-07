'use strict';

const { id, sha256 } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * External integration registry (Phase 2, WS9). One registry, one
 * provider per kind, sandbox implementations by default — the same
 * pattern as payments: business logic never touches a concrete
 * provider, only the kind's interface.
 *
 * Kinds and their interfaces:
 *  bank          linkAccount({owner_ref, bank, account_no}) · transfer(...) · statement(date)
 *  gov_identity  verifyNationalId({omang, full_name, dob})
 *  gis           geocode(name) · distanceKm(a, b) · staticMapUrl(geo)
 *  email         send({to, subject, body})
 *  whatsapp      sendTemplate({to, template, params})
 *  calendar      createEvent({title, start, end, location, description}) → { ics }
 */
const KINDS = ['bank', 'gov_identity', 'gis', 'email', 'whatsapp', 'calendar'];

class IntegrationRegistry {
  constructor({ clock }) {
    this.clock = clock;
    this.providers = new Map(); // kind -> provider
  }

  register(kind, provider) {
    if (!KINDS.includes(kind)) throw err('INVALID_ARGUMENT', `Unknown integration kind ${kind}`);
    this.providers.set(kind, provider);
    return provider;
  }

  has(kind) {
    return this.providers.has(kind);
  }

  get(kind) {
    const provider = this.providers.get(kind);
    if (!provider) throw err('NOT_FOUND', `No ${kind} integration configured`);
    return provider;
  }

  describe() {
    return [...this.providers.entries()].map(([kind, provider]) => ({
      kind,
      name: provider.name,
      mode: provider.live ? 'live' : 'sandbox',
    }));
  }
}

// ── Sandbox implementations ──────────────────────────────────────────

class SandboxBankProvider {
  constructor({ clock }) {
    this.name = 'sandbox-bank';
    this.live = false;
    this.clock = clock;
    this.links = [];
    this.transfers = [];
  }

  linkAccount({ ownerRef, bank, accountNo }) {
    const link = {
      id: id('bnk'),
      owner_ref: ownerRef,
      bank,
      account_no_masked: `***${String(accountNo).slice(-4)}`,
      linked_at: this.clock.nowIso(),
    };
    this.links.push(link);
    return link;
  }

  transfer({ linkId, amountMinor, reference }) {
    const transfer = {
      id: id('bft'),
      link_id: linkId,
      amount_minor: amountMinor,
      reference,
      state: 'accepted',
      at: this.clock.nowIso(),
    };
    this.transfers.push(transfer);
    return transfer;
  }

  statement(dateIso) {
    const day = String(dateIso).slice(0, 10);
    return this.transfers.filter((t) => t.at.slice(0, 10) === day);
  }
}

class SandboxGovIdentityProvider {
  constructor() {
    this.name = 'sandbox-gov-identity';
    this.live = false;
  }

  /** Deterministic sandbox: 9-digit Omang with a simple parity rule. */
  verifyNationalId({ omang, fullName, dob }) {
    if (!/^\d{9}$/.test(String(omang))) {
      return { verified: false, reason: 'OMANG_FORMAT_INVALID' };
    }
    const digits = String(omang).split('').map(Number);
    const parityOk = digits.reduce((a, b) => a + b, 0) % 2 === 0;
    return parityOk
      ? { verified: true, reference: sha256(`${omang}:${fullName}:${dob}`).slice(0, 16) }
      : { verified: false, reason: 'RECORD_NOT_FOUND' };
  }
}

const GAZETTEER = {
  gaborone: { lat: -24.6282, lng: 25.9231 },
  francistown: { lat: -21.1661, lng: 27.5144 },
  maun: { lat: -19.9953, lng: 23.4181 },
  serowe: { lat: -22.3875, lng: 26.7108 },
  tsodilo: { lat: -18.7519, lng: 21.7333 },
  mmadinare: { lat: -21.8667, lng: 27.75 },
  kasane: { lat: -17.7986, lng: 25.1522 },
};

class SandboxGisProvider {
  constructor() {
    this.name = 'sandbox-gis';
    this.live = false;
  }

  geocode(name) {
    const hit = GAZETTEER[String(name || '').toLowerCase().trim()];
    return hit ? { found: true, name, geo: hit } : { found: false, name };
  }

  distanceKm(a, b) {
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
  }

  staticMapUrl(geo, zoom = 12) {
    return `/gis/static?lat=${geo.lat}&lng=${geo.lng}&zoom=${zoom}`;
  }
}

class SandboxEmailProvider {
  constructor({ clock }) {
    this.name = 'sandbox-email';
    this.live = false;
    this.clock = clock;
    this.sent = [];
  }

  send({ to, subject, body }) {
    this.sent.push({ to, subject, body, at: this.clock.nowIso() });
    return { delivered: true, transport: this.name };
  }
}

class SandboxWhatsAppProvider {
  constructor({ clock }) {
    this.name = 'sandbox-whatsapp';
    this.live = false;
    this.clock = clock;
    this.sent = [];
  }

  sendTemplate({ to, template, params }) {
    this.sent.push({ to, template, params, at: this.clock.nowIso() });
    return { delivered: true, transport: this.name };
  }
}

class IcsCalendarProvider {
  constructor({ clock }) {
    this.name = 'ics-calendar';
    this.live = true; // ICS generation is fully functional, not a stub
    this.clock = clock;
  }

  createEvent({ title, start, end, location, description }) {
    const fmt = (iso) => String(iso).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const uid = id('evt');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Motse//Loeto//EN',
      'BEGIN:VEVENT',
      `UID:${uid}@motse.bw`,
      `DTSTAMP:${fmt(this.clock.nowIso())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${escapeIcs(title)}`,
      location ? `LOCATION:${escapeIcs(location)}` : null,
      description ? `DESCRIPTION:${escapeIcs(description)}` : null,
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .filter(Boolean)
      .join('\r\n');
    return { uid, ics };
  }
}

function escapeIcs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

module.exports = {
  IntegrationRegistry,
  SandboxBankProvider,
  SandboxGovIdentityProvider,
  SandboxGisProvider,
  SandboxEmailProvider,
  SandboxWhatsAppProvider,
  IcsCalendarProvider,
  KINDS,
};
