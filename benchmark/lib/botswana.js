'use strict';

/**
 * Botswana geographic reference data for realistic dataset generation.
 * Population weights bias most providers/customers toward the South-East
 * corridor (Gaborone area), matching the real distribution of the country.
 */
const CITIES = [
  { name: 'Gaborone', lat: -24.6282, lng: 25.9231, weight: 38 },
  { name: 'Francistown', lat: -21.17, lng: 27.5078, weight: 14 },
  { name: 'Molepolole', lat: -24.4067, lng: 25.495, weight: 8 },
  { name: 'Maun', lat: -19.9833, lng: 23.4167, weight: 7 },
  { name: 'Serowe', lat: -22.3875, lng: 26.7106, weight: 6 },
  { name: 'Selibe Phikwe', lat: -21.9764, lng: 27.8478, weight: 5 },
  { name: 'Kanye', lat: -24.9667, lng: 25.3333, weight: 5 },
  { name: 'Mahalapye', lat: -23.1042, lng: 26.8142, weight: 4 },
  { name: 'Mochudi', lat: -24.4167, lng: 26.15, weight: 4 },
  { name: 'Lobatse', lat: -25.2167, lng: 25.6667, weight: 4 },
  { name: 'Palapye', lat: -22.55, lng: 27.125, weight: 3 },
  { name: 'Ramotswa', lat: -24.8667, lng: 25.8167, weight: 2 },
];

const CITY_WEIGHTS = CITIES.map((c) => [c, c.weight]);

const FIRST_NAMES = [
  'Kagiso', 'Tumelo', 'Lesego', 'Mpho', 'Boitumelo', 'Thabo', 'Naledi', 'Kabelo',
  'Onkarabile', 'Goitseone', 'Tshepo', 'Bonolo', 'Keletso', 'Oratile', 'Gaone',
  'Botshelo', 'Karabo', 'Wame', 'Lorato', 'Tebogo', 'Refilwe', 'Amantle',
];
const LAST_NAMES = [
  'Modise', 'Kgosana', 'Seretse', 'Molefe', 'Tau', 'Dube', 'Phiri', 'Sebina',
  'Moeng', 'Khama', 'Pule', 'Ramotswe', 'Bogosi', 'Letsholo', 'Gabolwelwe',
  'Mogapi', 'Selepeng', 'Tlhomelang', 'Baruti', 'Disang',
];

/** Sample a city by population weight, then jitter to a nearby point. */
function sampleLocation(rng) {
  const city = rng.weighted(CITY_WEIGHTS);
  // ~ up to 12 km jitter (≈0.1 degree) so points spread around the city.
  const lat = city.lat + rng.float(-0.1, 0.1);
  const lng = city.lng + rng.float(-0.1, 0.1);
  return { lat: round6(lat), lng: round6(lng), address: `${randInt(rng, 1, 9999)} ${city.name}`, city: city.name };
}

function fullName(rng) {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function randInt(rng, a, b) {
  return rng.int(a, b);
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

module.exports = { CITIES, FIRST_NAMES, LAST_NAMES, sampleLocation, fullName };
