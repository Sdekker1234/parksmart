// Bedrijven en voorzieningen in Den Bosch (winkels, horeca, kantoren, zorg, sport...) uit
// OpenStreetMap. Hiermee kun je een winkel als bestemming kiezen, ook via de AI-vraag.
// Communitydata: naam, adres en openingstijden kunnen verouderd zijn.
import { CITY, TTL } from './config.js';
import { loadWithFallback } from './cache.js';
import { overpass } from './osm.js';
import { haversine } from './geo.js';

let state = null;
let index = [];

// Geen bestemmingen (straatmeubilair, techniek, parkeren zelf)
const SKIP = {
  amenity: new Set(['atm', 'charging_station', 'parking', 'parking_entrance', 'parking_space', 'bicycle_parking', 'motorcycle_parking', 'recycling', 'fountain', 'public_bookcase', 'bench', 'waste_basket', 'waste_disposal', 'toilets', 'vending_machine', 'drinking_water', 'post_box', 'telephone', 'shelter', 'bicycle_rental', 'taxi', 'grit_bin', 'clock', 'bbq', 'compressed_air', 'water_point', 'device_charging_station', 'loading_dock', 'smoking_area', 'lounger', 'give_box', 'letter_box']),
  tourism: new Set(['information', 'artwork', 'viewpoint', 'picnic_site', 'camp_pitch']),
  leisure: new Set(['pitch', 'playground', 'picnic_table', 'outdoor_seating', 'track', 'slipway', 'bleachers', 'firepit', 'common', 'fitness_station', 'bandstand', 'schoolyard']),
};

const NL = {
  shop: {
    supermarket: 'Supermarkt', convenience: 'Buurtsuper', bakery: 'Bakker', pastry: 'Banketbakker', butcher: 'Slager', greengrocer: 'Groenteboer', cheese: 'Kaaswinkel', deli: 'Delicatessen', confectionery: 'Snoepwinkel', chocolate: 'Chocolatier', alcohol: 'Slijterij', beverages: 'Drankenhandel', wine: 'Wijnhandel', coffee: 'Koffiewinkel', tea: 'Theewinkel', seafood: 'Viswinkel', health_food: 'Natuurwinkel', nutrition_supplements: 'Voedingssupplementen', ice_cream: 'IJssalon',
    clothes: 'Kledingwinkel', boutique: 'Boetiek', fashion_accessories: 'Accessoires', shoes: 'Schoenenwinkel', bag: 'Tassenwinkel', leather: 'Lederwaren', jewelry: 'Juwelier', watches: 'Horlogewinkel', optician: 'Opticien', hairdresser: 'Kapper', beauty: 'Schoonheidssalon', cosmetics: 'Cosmeticawinkel', perfumery: 'Parfumerie', chemist: 'Drogist', massage: 'Massagesalon', tattoo: 'Tattooshop',
    department_store: 'Warenhuis', mall: 'Winkelcentrum', variety_store: 'Budgetwinkel', general: 'Winkel', second_hand: 'Tweedehandswinkel', charity: 'Kringloopwinkel', gift: 'Cadeauwinkel', books: 'Boekwinkel', stationery: 'Kantoorartikelen', newsagent: 'Tijdschriftenwinkel', kiosk: 'Kiosk', tobacco: 'Tabakszaak', 'e-cigarette': 'Vapeshop',
    toys: 'Speelgoedwinkel', baby_goods: 'Babywinkel', games: 'Spellenwinkel', video_games: 'Gamewinkel', model: 'Modelbouw', craft: 'Hobbywinkel', party: 'Feestartikelen', art: 'Kunstwinkel', frame: 'Lijstenmaker', photo: 'Fotozaak', music: 'Muziekwinkel', musical_instrument: 'Muziekinstrumenten', fabric: 'Stoffenwinkel', sewing: 'Naaiwinkel',
    sports: 'Sportwinkel', outdoor: 'Outdoorwinkel', bicycle: 'Fietsenwinkel', car: 'Autodealer', car_repair: 'Autogarage', car_parts: 'Auto-onderdelen', tyres: 'Bandenservice', motorcycle: 'Motorzaak',
    electronics: 'Elektronicawinkel', mobile_phone: 'Telefoonwinkel', computer: 'Computerwinkel', hifi: 'Hifi-winkel', appliance: 'Witgoedwinkel',
    furniture: 'Meubelzaak', interior_decoration: 'Woonwinkel', houseware: 'Huishoudwinkel', bed: 'Beddenwinkel', kitchen: 'Keukenzaak', bathroom_furnishing: 'Badkamerwinkel', lighting: 'Verlichtingswinkel', paint: 'Verfwinkel', carpet: 'Tapijtwinkel', curtain: 'Gordijnenwinkel', doityourself: 'Bouwmarkt', hardware: 'IJzerwarenwinkel', garden_centre: 'Tuincentrum', florist: 'Bloemist', pet: 'Dierenwinkel',
    laundry: 'Wasserette', dry_cleaning: 'Stomerij', travel_agency: 'Reisbureau', copyshop: 'Copyshop', funeral_directors: 'Uitvaartverzorger', pawnbroker: 'Pandjeshuis', hearing_aids: 'Hoortoestellen', medical_supply: 'Medische hulpmiddelen', erotic: 'Erotiekwinkel', locksmith: 'Slotenmaker',
  },
  amenity: {
    restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Kroeg', fast_food: 'Snackbar', ice_cream: 'IJssalon', biergarten: 'Biertuin', food_court: 'Foodcourt',
    pharmacy: 'Apotheek', doctors: 'Huisarts', dentist: 'Tandarts', clinic: 'Kliniek', hospital: 'Ziekenhuis', veterinary: 'Dierenarts', social_facility: 'Zorginstelling', nursing_home: 'Verpleeghuis',
    bank: 'Bank', post_office: 'Postkantoor', library: 'Bibliotheek', cinema: 'Bioscoop', theatre: 'Theater', arts_centre: 'Cultureel centrum', nightclub: 'Club', casino: 'Casino', events_venue: 'Evenementenlocatie', conference_centre: 'Congrescentrum', exhibition_centre: 'Beurshal', marketplace: 'Markt',
    school: 'School', college: 'Hogeschool/mbo', university: 'Universiteit', kindergarten: 'Kinderopvang', childcare: 'Kinderopvang', music_school: 'Muziekschool', language_school: 'Taalschool', driving_school: 'Rijschool', dancing_school: 'Dansschool',
    community_centre: 'Buurthuis', place_of_worship: 'Kerk/gebedshuis', townhall: 'Gemeentehuis', police: 'Politie', courthouse: 'Rechtbank', fire_station: 'Brandweer', archive: 'Archief',
    car_rental: 'Autoverhuur', car_wash: 'Wasstraat', fuel: 'Tankstation', boat_rental: 'Bootverhuur',
  },
  office: { company: 'Bedrijf', government: 'Overheid', insurance: 'Verzekeraar', estate_agent: 'Makelaar', lawyer: 'Advocaat', accountant: 'Accountant', notary: 'Notaris', employment_agency: 'Uitzendbureau', it: 'IT-bedrijf', architect: 'Architect', financial: 'Financieel adviseur', tax_advisor: 'Belastingadviseur', coworking: 'Coworking', ngo: 'Organisatie', educational_institution: 'Onderwijsinstelling', association: 'Vereniging', consulting: 'Adviesbureau', advertising_agency: 'Reclamebureau', telecommunication: 'Telecombedrijf' },
  healthcare: { physiotherapist: 'Fysiotherapeut', psychotherapist: 'Psycholoog', dentist: 'Tandarts', doctor: 'Huisarts', pharmacy: 'Apotheek', optometrist: 'Optometrist', podiatrist: 'Podotherapeut', alternative: 'Alternatieve zorg', laboratory: 'Laboratorium', centre: 'Gezondheidscentrum', hospital: 'Ziekenhuis', clinic: 'Kliniek', speech_therapist: 'Logopedist' },
  tourism: { museum: 'Museum', hotel: 'Hotel', hostel: 'Hostel', guest_house: 'B&B', apartment: 'Vakantieappartement', gallery: 'Galerie', attraction: 'Bezienswaardigheid', theme_park: 'Pretpark', zoo: 'Dierentuin', motel: 'Motel', camp_site: 'Camping' },
  leisure: { sports_centre: 'Sportcentrum', fitness_centre: 'Sportschool', stadium: 'Stadion', swimming_pool: 'Zwembad', park: 'Park', bowling_alley: 'Bowlingbaan', escape_game: 'Escaperoom', dance: 'Dansschool', marina: 'Jachthaven', golf_course: 'Golfbaan', ice_rink: 'IJsbaan', amusement_arcade: 'Speelhal', sauna: 'Sauna', garden: 'Tuin', nature_reserve: 'Natuurgebied', horse_riding: 'Manege', sports_hall: 'Sporthal', trampoline_park: 'Trampolinepark', indoor_play: 'Indoorspeeltuin', hackerspace: 'Makerspace' },
};
const DEFAULT = { shop: 'Winkel', amenity: 'Voorziening', office: 'Kantoor', craft: 'Ambacht', healthcare: 'Zorg', tourism: 'Toerisme', leisure: 'Vrije tijd' };
const KEYS = ['shop', 'amenity', 'office', 'healthcare', 'craft', 'tourism', 'leisure'];

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/'s-/g, 's ')
    .replace(/['’`]/g, '') // McDonald's -> mcdonalds
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function categoryOf(tags) {
  for (const k of KEYS) {
    const v = tags[k];
    if (!v) continue;
    if (SKIP[k]?.has(v)) return null;
    return { key: k, value: v, label: NL[k]?.[v] ?? DEFAULT[k] };
  }
  return null;
}

// "Mo-Sa 09:00-18:00; Su 12:00-17:00" -> "ma–za 09:00–18:00 · zo 12:00–17:00"
export function hoursNl(oh) {
  if (!oh) return null;
  const days = { Mo: 'ma', Tu: 'di', We: 'wo', Th: 'do', Fr: 'vr', Sa: 'za', Su: 'zo', PH: 'feestdagen' };
  return String(oh)
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => days[d])
    .replace(/\boff\b|\bclosed\b/g, 'gesloten')
    .replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, '$1–$2')
    .replace(/([a-z]{2})-([a-z]{2})/g, '$1–$2')
    .replace(/,(?=\S)/g, ', ')
    .replace(/\s*;\s*/g, ' · ')
    .replace(/24\/7/, 'dag en nacht open');
}

async function fetchAll() {
  const area = `area["boundary"="administrative"]["admin_level"="8"]["name"="${CITY.name}"]->.a;`;
  const sel = KEYS.map((k) => `nwr["${k}"]["name"](area.a);`).join('');
  const els = await overpass(`[out:json][timeout:150];${area}(${sel});out center tags;`, { timeoutMs: 170000 });
  if (els.length < 200) throw new Error(`Te weinig bedrijven ontvangen (${els.length})`);
  const out = [];
  for (const e of els) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const cat = categoryOf(t);
    if (!cat || lat == null || !t.name) continue;
    out.push({
      id: `${e.type}/${e.id}`,
      name: t.name,
      brand: t.brand ?? null,
      cat: cat.label,
      catKey: `${cat.key}=${cat.value}`,
      street: t['addr:street'] ?? null,
      nr: t['addr:housenumber'] ?? null,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      hours: t.opening_hours ?? null,
    });
  }
  return out;
}

function buildIndex(list) {
  index = list.map((p) => ({
    p,
    n: norm(p.name),
    b: norm(p.brand),
    c: norm(p.cat),
    s: norm(`${p.street ?? ''} ${p.nr ?? ''}`),
  }));
}

export async function loadPlaces(opts = {}) {
  state = await loadWithFallback('places', TTL.places, fetchAll, opts);
  buildIndex(state.data ?? []);
  return state;
}

export function placesStatus() {
  if (!state) return { origin: 'none' };
  return { origin: state.origin, savedAt: state.savedAt, error: state.error, count: index.length };
}

// Token aan het begin van een woord ("hint" matcht "hinthamerstraat", niet "achterhint").
const wordStart = (text, tok) => text.startsWith(tok) || text.includes(` ${tok}`);

// Zoek bedrijven op naam, merk, categorie en straat. "Jumbo Hinthamerstraat" werkt ook.
export function searchPlaces(query, { near = CITY.center, limit = 6 } = {}) {
  const q = norm(query)
    .replace(/^(de|het|een) /, '')
    .replace(/\b(in |te )?(den bosch|s hertogenbosch|hertogenbosch)\b/g, '')
    .trim();
  if (q.length < 2) return [];
  const toks = q.split(' ').filter((t) => t.length >= 2 && !['de', 'het', 'een', 'in', 'aan', 'op', 'bij', 'van'].includes(t));
  if (!toks.length) return [];
  const hits = [];
  for (const it of index) {
    const all = `${it.n} ${it.b} ${it.c} ${it.s}`;
    const nameHit = toks.some((t) => wordStart(it.n, t) || (it.b && wordStart(it.b, t)));
    let score = 0;
    if (it.n === q || (it.b && it.b === q)) score = 100;
    else if (it.n.startsWith(q)) score = 85;
    else if (nameHit && toks.every((t) => wordStart(all, t))) score = 70; // naam/merk + straat of categorie
    else if (it.n.includes(q) && q.length >= 4) score = 55;
    else if (toks.every((t) => wordStart(it.c, t))) score = 45; // alleen categorie, bijv. "apotheek"
    else if (nameHit && q.length >= 4) score = 30;
    if (!score) continue;
    hits.push({ score, d: haversine(near, it.p), p: it.p });
  }
  hits.sort((a, b) => b.score - a.score || a.d - b.d);
  return hits.slice(0, limit).map((h) => ({ ...h.p, score: h.score }));
}

export const placeAddress = (p) => [p.street, p.nr].filter(Boolean).join(' ') || null;

export const STRONG_MATCH = 55; // vanaf deze score is een bedrijf een betrouwbare treffer

// Andere vestigingen met dezelfde naam (bijv. 3× HEMA), dichtstbijzijnde bij het centrum eerst.
export function branchesOf(p, limit = 6) {
  const n = norm(p.name);
  return index
    .filter((it) => it.n === n && it.p.id !== p.id)
    .map((it) => ({ d: haversine(CITY.center, it.p), p: it.p }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => placeInfo(x.p));
}

// Voor de frontend en de AI: compacte bestemmingsinfo.
export function placeInfo(p) {
  const address = placeAddress(p);
  return {
    id: `place-${p.id}`,
    label: address ? `${p.name}, ${address}` : p.name,
    name: p.name,
    kind: p.cat,
    address,
    hours: p.hours,
    hoursNl: hoursNl(p.hours),
    lat: p.lat,
    lon: p.lon,
    source: 'OpenStreetMap',
  };
}
