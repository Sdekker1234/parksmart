// Den Bosch-specifieke configuratie. Alle bedragen incl. btw.

export const CITY = {
  name: "'s-Hertogenbosch",
  shortName: 'Den Bosch',
  areaManagerId: '796', // RDW gebiedsbeheerder (= CBS-gemeentecode 0796)
  center: { lat: 51.688684, lon: 5.303656 }, // Markt
  // Ruime box rond de gemeente (incl. Rosmalen, Vught-grens) voor zoeken/geocoding.
  bbox: { south: 51.64, west: 5.2, north: 51.75, east: 5.42 },
  // Kleinere box voor de OpenStreetMap-query.
  osmBBox: { south: 51.655, west: 5.235, north: 51.73, east: 5.37 },
};

export const WALK = {
  speedMPerMin: 80, // ~4,8 km/u
  detourFactor: 1.25, // hemelsbreed -> geschatte looproute
};

export const SEARCH = {
  walkRadiusM: 2500, // hemelsbreed, voor loop-opties
  shuttleRadiusM: 9000, // transferia met pendelbus/leenfiets
};

export const TTL = {
  rdw: 12 * 3600e3,
  spdpIndex: 24 * 3600e3,
  spdpStatic: 24 * 3600e3,
  spdpDynamic: 2 * 60e3,
  osm: 24 * 3600e3,
  places: 7 * 24 * 3600e3, // bedrijven veranderen langzaam; zware Overpass-query
};

// Live bezetting tonen we alleen als die recent is bijgewerkt.
export const LIVE_MAX_AGE_MIN = 60;

export const SOURCES = {
  rdwNpr: {
    key: 'rdw-npr',
    label: 'RDW Open Data Parkeren (NPR)',
    url: 'https://opendata.rdw.nl/browse?q=Open%20Data%20Parkeren',
    trust: 'official',
  },
  decree: {
    key: 'decree-2026',
    label: "Besluit privaatrechtelijke parkeertarieven 's-Hertogenbosch 2026",
    url: 'https://lokaleregelgeving.overheid.nl/CVDR750485',
    trust: 'official',
  },
  spdp: {
    key: 'rdw-spdp',
    label: 'RDW Shared Parking Data Platform',
    url: 'https://npropendata.rdw.nl/parkingdata/v2/',
    trust: 'operator',
  },
  osm: {
    key: 'osm',
    label: 'OpenStreetMap-bijdragers',
    url: 'https://www.openstreetmap.org/copyright',
    trust: 'community',
  },
};

// Tarieven per jaar uit het gemeentebesluit "privaatrechtelijke parkeertarieven" (art. 1).
// Nieuw jaar gepubliceerd? Voeg hier één blok toe (meestal half december op lokaleregelgeving.overheid.nl).
// Ligt een datum na het laatst bekende jaar, dan rekent de app met dat jaar en toont de prijs als schatting.
export const DECREE_TARIFFS = [
  {
    year: 2026,
    validFrom: '20260101',
    title: "Besluit privaatrechtelijke parkeertarieven 's-Hertogenbosch 2026",
    url: 'https://lokaleregelgeving.overheid.nl/CVDR750485',
    garages: { '796_WOLV': 4.12, '796_JOSE': 4.12, '796_PAL': 3.41, '796_STJAN': 3.41, '796_STAT': 3.41 },
    eveningRate: 1.5,
    eveningMax: 7.5,
    dayMax: 20,
    transferiumPerDay: 5,
  },
];

export function decreeFor(ymd) {
  const sorted = [...DECREE_TARIFFS].sort((a, b) => b.year - a.year);
  const d = sorted.find((x) => x.validFrom <= ymd) ?? sorted[sorted.length - 1];
  const year = Number(ymd.slice(0, 4));
  return { ...d, estimated: d.year < year, forYear: year };
}

// Garage + tarieven van een besluitjaar -> invoer voor priceGarage()
export const garageWithTariff = (g, d) => ({
  ...g,
  dayRate: d.garages[g.areaId],
  eveningRate: d.eveningRate,
  eveningMax: d.eveningMax,
  dayMax: d.dayMax,
});

// Gemeentelijke garages. Locatie komt live uit RDW SPDP via de UUID uit RDW "PARKEERGEBIED";
// fallback = waarde van 18-11-2026.
export const DECREE_GARAGES = [
  {
    areaId: '796_WOLV',
    name: 'Parkeergarage Wolvenhoek',
    match: /wolvenhoek/i,
    group: 'centrum',
    fallback: { lat: 51.686748, lon: 5.303124, address: 'Wolvenhoek 12', capacity: 471 },
  },
  {
    areaId: '796_JOSE',
    name: 'Parkeergarage Sint Josephstraat',
    match: /josephstraat|sint joseph/i,
    group: 'centrum',
    // "zondag: gratis parkeren van 07.00 tot 14.00 uur" (uitzondering in het besluit)
    sundayFree: { from: 7 * 60, to: 14 * 60 },
    fallback: { lat: 51.689482, lon: 5.308031, address: 'Sint Josephstraat 1', capacity: 175 },
  },
  {
    areaId: '796_PAL',
    name: 'Parkeergarage Paleiskwartier',
    match: /paleiskwartier/i,
    group: 'rand centrum',
    fallback: { lat: 51.689412, lon: 5.28975, address: 'Hugo de Grootlaan 84', capacity: 1059 },
  },
  {
    areaId: '796_STJAN',
    name: 'Parkeergarage Sint Jan',
    match: /\bst\.?-?\s?jan\b|sint jan/i,
    group: 'rand centrum',
    fallback: { lat: 51.685325, lon: 5.314114, address: 'Hekellaan 25', capacity: 1040 },
  },
  {
    areaId: '796_STAT',
    name: 'Parkeergarage Stationsplein',
    match: /stationsplein/i,
    group: 'rand centrum',
    fallback: { lat: 51.689372, lon: 5.294645, address: 'Colvenierstraat 20', capacity: 175 },
  },
];

// Transferia: dagtarief incl. max. 4 personen per bus of 4 leenfietsen (zie DECREE_TARIFFS).
export const DECREE_TRANSFERIA = [
  {
    areaId: '796_PRPET',
    name: 'Transferium Pettelaarpark',
    fallback: { lat: 51.677949, lon: 5.335747, address: 'Pettelaarpark 59', capacity: 450 },
  },
  {
    areaId: '796_PRVLI',
    name: 'Transferium De Vliert',
    note: 'Volgens de ANWB gesloten op feestdagen (behalve Hemelvaart).',
    fallback: { lat: 51.699862, lon: 5.322, address: 'Stadionlaan 9', capacity: 700 },
  },
  {
    areaId: '796_PRDEU',
    name: 'Transferium Deutersestraat',
    fallback: { lat: 51.685394, lon: 5.271441, address: 'Deutersestraat 2', capacity: 1100 },
  },
];

// Avond/nacht/zondagochtend volgens het besluit (voor de gemeentelijke garages).
export const GARAGE_EVENING = {
  eveningFrom: 18 * 60, // avond 18.00-02.00
  koopavondFrom: 21 * 60, // donderdag (koopavond) 21.00-02.00
  nightUntil: 7 * 60, // nacht 02.00-07.00
  sundayMorning: { from: 7 * 60, to: 12 * 60 }, // zondag 07.00-12.00
  // Feestdagen met het ochtendregime 07.00-12.00 (namen zoals in RDW SPECIALE DAG):
  holidays: ['NIEUWJAARSDAG', '1E PAASDAG', '2E PAASDAG', '1E PINKSTERDAG', '2E PINKSTERDAG', '1E KERSTDAG', '2E KERSTDAG'],
};

// Extra SPDP-locaties in Den Bosch die we tonen (op naam). Prijzen/bezetting komen live uit SPDP.
export const SPDP_NAME_FILTER = /hertogenbosch|rosmalen/i;
export const SPDP_SKIP = /blauwe zone|afgesloten gebied|ze zone|vlijmenseweg|^garage (paleiskwartier|wolvenhoek|stationsplein|sint josephstraat)/i;

// Snelkeuze-bestemmingen (coördinaten via OpenStreetMap Nominatim, 18-11-2026).
export const LANDMARKS = [
  { id: 'lm-sintjan', label: 'Sint-Janskathedraal', aliases: ['sint jan', 'sint-jan', 'st jan', 'kathedraal', 'basiliek'], lat: 51.688072, lon: 5.308444 },
  { id: 'lm-markt', label: 'Markt', aliases: ['markt', 'centrum', 'binnenstad', 'stadhuis'], lat: 51.688684, lon: 5.303656 },
  { id: 'lm-station', label: "Station 's-Hertogenbosch", aliases: ['station', 'centraal station', 'ns'], lat: 51.690387, lon: 5.294519 },
  { id: 'lm-nbm', label: 'Het Noordbrabants Museum', aliases: ['noordbrabants museum', 'museum'], lat: 51.68658, lon: 5.304685 },
  { id: 'lm-design', label: 'Design Museum Den Bosch', aliases: ['design museum'], lat: 51.685743, lon: 5.30417 },
  { id: 'lm-jbac', label: 'Jheronimus Bosch Art Center', aliases: ['jheronimus bosch', 'art center', 'jbac'], lat: 51.688016, lon: 5.312166 },
  { id: 'lm-parade', label: 'Theater aan de Parade', aliases: ['theater', 'parade', 'theater aan de parade'], lat: 51.686935, lon: 5.308668 },
  { id: 'lm-jbz', label: 'Jeroen Bosch Ziekenhuis', aliases: ['ziekenhuis', 'jbz', 'jeroen bosch ziekenhuis'], lat: 51.68513, lon: 5.276013 },
  { id: 'lm-brabanthallen', label: 'Brabanthallen', aliases: ['brabanthallen'], lat: 51.700137, lon: 5.290316 },
  { id: 'lm-vliert', label: 'Stadion De Vliert', aliases: ['de vliert', 'stadion', 'fc den bosch'], lat: 51.701655, lon: 5.32982 },
  { id: 'lm-provinciehuis', label: 'Provinciehuis Noord-Brabant', aliases: ['provinciehuis', 'provincie'], lat: 51.677904, lon: 5.329621 },
  { id: 'lm-verkade', label: 'Verkadefabriek', aliases: ['verkadefabriek', 'verkade'], lat: 51.695792, lon: 5.297797 },
  { id: 'lm-bibliotheek', label: 'Bibliotheek Huis73', aliases: ['bibliotheek', 'huis73', 'huis 73'], lat: 51.688876, lon: 5.307967 },
];
