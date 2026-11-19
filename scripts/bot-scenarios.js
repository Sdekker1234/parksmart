// Testset voor de ingebouwde assistent: echte vragen in allerlei formuleringen.
// Elke scenario is een gesprek; elke beurt heeft verwachtingen die scripts/eval-bot.js controleert.
//
// expect-velden:
//   intent   'search' | 'refine' | 'detail' | 'hours' | 'navigate' | 'help' | 'thanks' | 'unclear' |
//            'notfound' | 'outside' | 'ask_destination' (of een array met toegestane waarden)
//   dest     regex op de gekozen bestemming     duration  minuten
//   date     'vandaag' | 'morgen' | weekdag ('zaterdag') | 'volgende zaterdag' | 'YYYY-MM-DD'
//   time     'HH:MM'                            now       true = aankomst "nu"
//   types    ['garage', ...] (exact)            maxWalk / maxPrice / sort
//   text     regex die in het antwoord moet staan     notText  regex die er niet in mag staan
//   results  true = er moeten opties met prijs zijn

export const SCENARIOS = [
  // ---------- Zoeken: verschillende formuleringen ----------
  { name: 'HEMA goedkoopst', turns: [{ q: 'Waar parkeer ik het goedkoopst bij de HEMA?', expect: { intent: 'search', dest: /HEMA/, duration: 120, results: true, text: /goedkoopst/ } }] },
  { name: 'Markt 2 uur', turns: [{ q: '2 uur parkeren bij de Markt', expect: { intent: 'search', dest: /Markt/, duration: 120, results: true } }] },
  { name: 'ziekenhuis morgen', turns: [{ q: 'ik moet morgen 3 uur naar het ziekenhuis', expect: { intent: 'search', dest: /Ziekenhuis/, duration: 180, date: 'morgen' } }] },
  { name: 'station kort', turns: [{ q: 'parkeren station 1 uur', expect: { intent: 'search', dest: /Station/, duration: 60 } }] },
  { name: 'auto kwijt sint jan', turns: [{ q: 'waar kan ik mijn auto kwijt bij de sint jan', expect: { intent: 'search', dest: /Sint-Jan/ } }] },
  { name: 'anderhalf uur museum', turns: [{ q: 'anderhalf uur naar het noordbrabants museum', expect: { intent: 'search', dest: /Noordbrabants/, duration: 90 } }] },
  { name: 'half uurtje jumbo', turns: [{ q: 'een half uurtje bij de jumbo', expect: { intent: 'search', dest: /Jumbo/, duration: 30 } }] },
  { name: 'vanavond theater', turns: [{ q: 'ik ga vanavond naar theater aan de parade', expect: { intent: 'search', dest: /Parade/, time: '19:00', date: 'vandaag' } }] },
  { name: 'adres', turns: [{ q: 'Vughterstraat 120, 2 uur', expect: { intent: 'search', dest: /Vughterstraat/, duration: 120 } }] },
  { name: 'hele dag station', turns: [{ q: 'hele dag parkeren bij het station', expect: { intent: 'search', dest: /Station/, duration: 480 } }] },
  { name: 'alles in een zin', turns: [{ q: 'zaterdag om 14:00 drie uur naar de Sint-Jan, max 10 minuten lopen', expect: { intent: 'search', dest: /Sint-Jan/, date: 'zaterdag', time: '14:00', duration: 180, maxWalk: 10 } }] },
  { name: 'zonder lidwoord', turns: [{ q: 'goedkoop parkeren brabanthallen 4 uur', expect: { intent: 'search', dest: /Brabanthallen/, duration: 240 } }] },
  { name: 'stadion', turns: [{ q: 'parkeren bij de vliert voor de wedstrijd', expect: { intent: 'search', dest: /Vliert/ } }] },
  { name: 'winkel in straat', turns: [{ q: 'Ik wil naar de Albert Heijn in de Vughterstraat', expect: { intent: 'search', dest: /Albert Heijn.*Vughterstraat/ } }] },
  { name: 'gratis centrum', turns: [{ q: 'kan ik ergens gratis parkeren bij het centrum?', expect: { intent: 'search', dest: /Markt/, types: ['free'] } }] },
  { name: 'garage markt', turns: [{ q: 'goedkoopste garage bij de markt', expect: { intent: 'search', dest: /Markt/, types: ['garage'] } }] },
  { name: 'maxprijs', turns: [{ q: 'waar parkeer ik voor 5 euro of minder bij de hema', expect: { intent: 'search', dest: /HEMA/, maxPrice: 5 } }] },
  { name: 'bakker', turns: [{ q: 'parkeren bij jan de groot', expect: { intent: 'search', dest: /Jan de Groot/ } }] },
  { name: 'mcdonalds', turns: [{ q: 'mcdonalds 1 uur', expect: { intent: 'search', dest: /McDonald/, duration: 60 } }] },
  { name: 'kort hema', turns: [{ q: 'hema 2 uur', expect: { intent: 'search', dest: /HEMA/, duration: 120 } }] },
  { name: 'p+r', turns: [{ q: 'P+R bij het station', expect: { intent: 'search', dest: /Station/, types: ['pr'] } }] },
  { name: 'engels', turns: [{ q: 'parking near the station for 2 hours', expect: { intent: 'search', dest: /Station/, duration: 120 } }] },
  { name: 'kwart over', turns: [{ q: 'om kwart over 2 naar de markt', expect: { intent: 'search', dest: /Markt/, time: '14:15' } }] },
  { name: 'kwart voor', turns: [{ q: 'om kwart voor 10 naar de markt voor 2 uur', expect: { intent: 'search', dest: /Markt/, time: '09:45', duration: 120 } }] },
  { name: 'morgenochtend', turns: [{ q: 'morgenochtend om 9 uur naar het provinciehuis voor 8 uur', expect: { intent: 'search', dest: /Provinciehuis/, date: 'morgen', time: '09:00', duration: 480 } }] },
  { name: 'volgende week', turns: [{ q: 'volgende week zaterdag 2 uur bij de hema', expect: { intent: 'search', dest: /HEMA/, date: 'volgende zaterdag', duration: 120 } }] },
  { name: 'tot tijd', turns: [{ q: 'van 13:00 tot 16:30 bij de bibliotheek', expect: { intent: 'search', dest: /Huis73|Bibliotheek/, time: '13:00', duration: 210 } }] },
  { name: 'bieb', turns: [{ q: 'ik zoek een parkeerplek bij de bieb', expect: { intent: 'search', dest: /Huis73|Bibliotheek/ } }] },
  { name: 'paar uur', turns: [{ q: 'een paar uurtjes bij de markt', expect: { intent: 'search', dest: /Markt/, duration: 120 } }] },
  { name: 'minuten', turns: [{ q: '90 minuten bij het station', expect: { intent: 'search', dest: /Station/, duration: 90 } }] },
  { name: 'komma uur', turns: [{ q: '2,5 uur hinthamerstraat', expect: { intent: 'search', dest: /Hinthamerstraat/, duration: 150 } }] },
  { name: 'alleen naam', turns: [{ q: 'sint janskathedraal', expect: { intent: 'search', dest: /Sint-Jan/, text: /Ik ga uit van 2 uur/ } }] },
  { name: 'ah afkorting', turns: [{ q: 'ah vughterstraat', expect: { intent: 'search', dest: /Albert Heijn/ } }] },
  { name: 'typfout', turns: [{ q: 'hemma 2 uur', expect: { intent: 'search', dest: /HEMA/ } }] },
  { name: 'binnenstad', turns: [{ q: 'hoe duur is parkeren in de binnenstad', expect: { intent: 'search', dest: /Markt|Binnenstad/ } }] },
  { name: 'wat kost bij jbz', turns: [{ q: 'wat kost parkeren bij het jbz', expect: { intent: 'search', dest: /Ziekenhuis/ } }] },
  { name: 'categorie', turns: [{ q: 'apotheek', expect: { intent: 'search', dest: /Apotheek/ } }] },
  { name: 'bioscoop', turns: [{ q: 'naar de bioscoop vanavond', expect: { intent: 'search', dest: /Vue|Kinepolis/, time: '19:00' } }] },
  { name: 'kledingwinkel', turns: [{ q: '1 uur bij de zara', expect: { intent: 'search', dest: /Zara/, duration: 60 } }] },

  // ---------- Bestaat niet / buiten Den Bosch / onzin ----------
  { name: 'ikea', turns: [{ q: 'parkeren bij de ikea', expect: { intent: ['notfound', 'unclear'], notText: /is het goedkoopst/ } }] },
  { name: 'efteling', turns: [{ q: 'ik wil naar de efteling', expect: { intent: ['notfound', 'outside', 'unclear'], notText: /is het goedkoopst/ } }] },
  { name: 'andere stad', turns: [{ q: 'parkeren in eindhoven', expect: { intent: ['outside', 'notfound', 'unclear'], notText: /is het goedkoopst/ } }] },
  { name: 'weer', turns: [{ q: 'wat voor weer wordt het morgen', expect: { intent: ['help', 'unclear'], notText: /is het goedkoopst/ } }] },
  { name: 'mop', turns: [{ q: 'vertel een mop', expect: { intent: ['help', 'unclear'], notText: /is het goedkoopst/ } }] },
  { name: 'gebrabbel', turns: [{ q: 'asdfgh', expect: { intent: ['help', 'unclear', 'notfound'], notText: /is het goedkoopst/ } }] },
  { name: 'alleen tijd', turns: [{ q: 'ik ben er om half 3', expect: { intent: 'ask_destination' } }] },
  { name: 'vergunning', turns: [{ q: 'hoeveel kost een parkeervergunning?', expect: { intent: ['help', 'unclear'], notText: /is het goedkoopst/ } }] },

  // ---------- Gesprekken met vervolgvragen ----------
  {
    name: 'gesprek HEMA',
    turns: [
      { q: '2 uur bij de HEMA', expect: { intent: 'search', dest: /HEMA/, duration: 120 } },
      { q: 'en voor 4 uur?', expect: { intent: 'refine', dest: /HEMA/, duration: 240 } },
      { q: 'en morgen om 10:00?', expect: { intent: 'refine', dest: /HEMA/, date: 'morgen', time: '10:00', duration: 240 } },
      { q: 'dichterbij?', expect: { intent: 'refine', text: /dichtstbij/ } },
      { q: 'alle opties', expect: { intent: 'refine', types: ['garage', 'street', 'pr', 'free'], maxWalk: 20 } },
      { q: 'wat kost de tweede?', expect: { intent: 'detail', text: /kost/ } },
      { q: 'navigeer', expect: { intent: 'navigate' } },
    ],
  },
  {
    name: 'gesprek garage',
    turns: [
      { q: 'ik wil naar de markt', expect: { intent: 'search', dest: /Markt/ } },
      { q: '3 uur', expect: { intent: 'refine', duration: 180 } },
      { q: 'liever een garage', expect: { intent: 'refine', types: ['garage'] } },
      { q: 'wat kost wolvenhoek', expect: { intent: 'detail', text: /Wolvenhoek/ } },
      { q: 'bedankt', expect: { intent: 'thanks' } },
    ],
  },
  {
    name: 'gesprek gratis',
    turns: [
      { q: 'parkeren bij het station', expect: { intent: 'search', dest: /Station/ } },
      { q: 'is er ook iets gratis?', expect: { intent: 'refine', types: ['free'] } },
    ],
  },
  {
    name: 'gesprek openingstijden',
    turns: [
      { q: 'is de HEMA zaterdag open?', expect: { intent: 'hours', text: /zaterdag.*09:00/ } },
      { q: 'en hoe laat sluit hij op zondag?', expect: { intent: 'hours', text: /zondag.*17:30/ } },
    ],
  },
  {
    name: 'gesprek begroeting',
    turns: [
      { q: 'hoi', expect: { intent: 'help' } },
      { q: 'wat kun je?', expect: { intent: 'help' } },
      { q: '2 uur bij de markt', expect: { intent: 'search', dest: /Markt/ } },
      { q: 'top', expect: { intent: 'thanks' } },
    ],
  },
  {
    name: 'gesprek andere bestemming',
    turns: [
      { q: '2 uur bij de markt', expect: { intent: 'search', dest: /Markt/, duration: 120 } },
      { q: 'en bij het station?', expect: { intent: 'search', dest: /Station/, duration: 120 } },
    ],
  },
  {
    name: 'gesprek prijs en lopen',
    turns: [
      { q: '2 uur bij de markt', expect: { intent: 'search', dest: /Markt/ } },
      { q: 'max 5 euro', expect: { intent: 'refine', maxPrice: 5 } },
      { q: 'zonder veel lopen', expect: { intent: 'refine', text: /dichtstbij/ } },
    ],
  },
  {
    name: 'gesprek is het open',
    turns: [
      { q: '3 uur bij de hema', expect: { intent: 'search', dest: /HEMA/ } },
      { q: 'is het daar open?', expect: { intent: 'hours', text: /HEMA/ } },
    ],
  },
  {
    name: 'gesprek tijdstip later',
    turns: [
      { q: 'parkeren bij de markt', expect: { intent: 'search', dest: /Markt/ } },
      { q: 'om 20:00', expect: { intent: 'refine', time: '20:00' } },
      { q: 'voor de hele dag', expect: { intent: 'refine', duration: 480 } },
      { q: 'zondag', expect: { intent: 'refine', date: 'zondag' } },
    ],
  },
  {
    name: 'gesprek waarom',
    turns: [
      { q: 'hema 2 uur', expect: { intent: 'search' } },
      { q: 'waarom deze?', expect: { intent: 'why' } },
      { q: 'meer over de eerste', expect: { intent: 'detail' } },
    ],
  },
  {
    // Gevonden bij testen in de browser: "Stationsplein" is ook de naam van een zone in de lijst
    name: 'gesprek andere vestiging',
    turns: [
      { q: 'hema 2 uur', expect: { intent: 'search', dest: /HEMA/ } },
      { q: 'die op de stationsplein', expect: { intent: 'search', dest: /HEMA, Stationsplein/ } },
    ],
  },
];

// Controle-set: nieuwe vragen die niet zijn gebruikt om de regels af te stellen.
// Draai met: npm run eval:bot -- --holdout
export const HOLDOUT = [
  { name: 'h tandarts', turns: [{ q: 'Ik moet om 11 uur bij de tandarts zijn, waar kan ik parkeren?', expect: { intent: 'search', dest: /tand/i, time: '11:00' } }] },
  { name: 'h kapper morgenmiddag', turns: [{ q: 'parkeren bij de kapper morgenmiddag', expect: { intent: 'search', dest: /kapper/i, date: 'morgen', time: '14:00' } }] },
  { name: 'h binnenstad 5 uur', turns: [{ q: 'Waar is het goedkoopst om te parkeren als ik 5 uur naar de binnenstad ga?', expect: { intent: 'search', dest: /Markt|Binnenstad/, duration: 300 } }] },
  { name: 'h gratis rosmalen', turns: [{ q: 'gratis parkeren rosmalen', expect: { intent: 'search', dest: /Rosmalen/, types: ['free'] } }] },
  { name: 'h garage dichtbij', turns: [{ q: 'parkeergarage dichtbij de markt', expect: { intent: 'search', dest: /Markt/, types: ['garage'] } }] },
  { name: 'h wijk', turns: [{ q: 'Wat kost 2 uur parkeren in Paleiskwartier?', expect: { intent: 'search', dest: /Paleiskwartier/, duration: 120 } }] },
  { name: 'h station dag', turns: [{ q: 'Kan ik bij het station gratis parkeren voor een dag?', expect: { intent: 'search', dest: /Station/, types: ['free'], duration: 1440 } }] },
  { name: 'h verkade avond', turns: [{ q: 'ik ga naar de verkadefabriek van 20:00 tot 23:00', expect: { intent: 'search', dest: /Verkade/, time: '20:00', duration: 180 } }] },
  { name: 'h beurs', turns: [{ q: 'brabanthallen beurs zaterdag hele dag', expect: { intent: 'search', dest: /Brabanthallen/, date: 'zaterdag', duration: 480 } }] },
  { name: 'h grote kerk', turns: [{ q: 'waar parkeer ik bij de Grote Kerk', expect: { intent: 'search', dest: /Grote Kerk/ } }] },
  { name: 'h starbucks', turns: [{ q: 'Starbucks station half uur', expect: { intent: 'search', dest: /Starbucks/, duration: 30 } }] },
  { name: 'h action straat', turns: [{ q: 'naar de action in de gruttostraat', expect: { intent: 'search', dest: /Action.*Gruttostraat/ } }] },
  { name: 'h garage als plek', turns: [{ q: 'hoeveel kost wolvenhoek voor 3 uur', expect: { intent: 'search', dest: /Wolvenhoek/, duration: 180 } }] },
  { name: 'h kruidvat open', turns: [{ q: 'Is de Kruidvat op de Hooge Steenweg open?', expect: { intent: 'hours', text: /Kruidvat/ } }] },
  { name: 'h zara open', turns: [{ q: 'Wanneer gaat de Zara open?', expect: { intent: 'hours', text: /Zara/ } }] },
  { name: 'h zonder plek', turns: [{ q: 'goedkoop parkeren', expect: { intent: 'ask_destination' } }] },
  { name: 'h met de auto', turns: [{ q: 'en als ik met de auto naar de markt ga voor 4 uur', expect: { intent: 'search', dest: /Markt/, duration: 240 } }] },
  { name: 'h engels', turns: [{ q: 'Hi, I need parking near the Sint Jan cathedral tomorrow at 10', expect: { intent: 'search', dest: /Sint-Jan/, date: 'morgen', time: '10:00' } }] },
  { name: 'h anderhalf komma', turns: [{ q: 'parkeren jbz bezoek 1,5 uur', expect: { intent: 'search', dest: /Ziekenhuis/, duration: 90 } }] },
  { name: 'h gratis vandaag', turns: [{ q: 'is parkeren bij de markt vandaag gratis?', expect: { intent: 'search', dest: /Markt/, types: ['free'] } }] },
  { name: 'h vergadering', turns: [{ q: 'Waar parkeer ik het beste bij het provinciehuis voor een vergadering van 2 uur', expect: { intent: 'search', dest: /Provinciehuis/, duration: 120 } }] },
  { name: 'h parking at', turns: [{ q: 'parking at the station', expect: { intent: 'search', dest: /Station/ } }] },
  {
    name: 'h gesprek vestiging',
    turns: [
      { q: '2 uur bij de jumbo', expect: { intent: 'search', dest: /Jumbo/ } },
      { q: 'die op de tolbrugstraat', expect: { intent: 'search', dest: /Tolbrugstraat/, duration: 120 } },
    ],
  },
  {
    name: 'h gesprek middernacht',
    turns: [
      { q: 'ik ga naar het theater aan de parade', expect: { intent: 'search', dest: /Parade/ } },
      { q: 'om 20:00', expect: { intent: 'refine', time: '20:00' } },
      { q: 'tot middernacht', expect: { intent: 'refine', duration: 240 } },
    ],
  },
  {
    name: 'h gesprek goedkoper',
    turns: [
      { q: '3 uur bij de markt', expect: { intent: 'search' } },
      { q: 'kan het goedkoper?', expect: { intent: 'refine' } },
      { q: 'en op zondag?', expect: { intent: 'refine', date: 'zondag' } },
      { q: 'wat kost de derde', expect: { intent: 'detail' } },
    ],
  },
];
