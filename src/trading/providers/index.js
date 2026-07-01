'use strict';

const config = require('../../config');
const SimulatedProvider = require('./simulated.provider');
const IbkrProvider = require('./ibkr.provider');

/**
 * Market-data provider registry. Mirrors the payment-provider pattern: one
 * factory per venue, selected by config. The simulator is always available as
 * an offline fallback so the trading stack boots even without an IBKR gateway.
 */
const builders = {
  simulated: () => new SimulatedProvider(config.trading),
  ibkr: () => new IbkrProvider(config.trading.ibkr),
};

let active = null;

/** The configured provider (built lazily, cached). */
function getProvider() {
  if (!active) {
    const build = builders[config.trading.dataProvider] || builders.simulated;
    active = build();
  }
  return active;
}

/** Always-available offline provider, used as a fallback and for backtests. */
function getSimulatedProvider() {
  return builders.simulated();
}

/** Test/utility hook to swap the active provider. */
function setProvider(provider) {
  active = provider;
}

function resetProvider() {
  active = null;
}

module.exports = { getProvider, getSimulatedProvider, setProvider, resetProvider };
