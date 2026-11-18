# ParkSmart Den Bosch

ParkSmart laat je in een paar seconden zien waar je het goedkoopst parkeert in 's-Hertogenbosch. Je kiest een bestemming (een adres, een plek of een van de ruim 2.300 winkels, horecazaken en andere bedrijven in de stad) en hoe lang je blijft. De app rekent dan voor elke optie de totaalprijs uit: gemeentelijke garages, betaalzones op straat, P+R, transferia en gratis plekken. Je ziet ook hoe ver je moet lopen, en je kunt direct navigeren.

## Starten

Je hebt Node.js 24 nodig.

```bash
npm install
npm start
```

Open daarna <http://localhost:3000>.

Wil je het op je telefoon testen (zelfde wifi)? Start dan met `HOST=0.0.0.0` en open `http://<ip-van-je-pc>:3000`. Locatiebepaling werkt op een telefoon alleen via https, dus kies daar je bestemming met zoeken of door op de kaart te tikken.

## Online zetten (testlink)

ParkSmart is klaar voor [Render](https://render.com) (gratis web service). In `render.yaml` staat de configuratie.

1. Zet deze map in een GitHub-repository.
2. Ga in Render naar **New > Blueprint**, kies de repository en klik op **Apply**. Render voert `npm ci` en `npm start` uit.
3. Optioneel: vul in het dashboard `ANTHROPIC_API_KEY` in om Claude aan te zetten.
4. Je krijgt een vaste link zoals `https://parksmart-denbosch.onrender.com`.

Goed om te weten over de gratis versie: na 15 minuten zonder bezoek valt de app in slaap, en het eerste bezoek daarna duurt tot een minuut. Je hebt 750 gratis uren per maand, genoeg om één app de hele maand te laten draaien. De server start met de meegeleverde momentopname en haalt daarna op de achtergrond de live data op, zodat testers niet hoeven te wachten.

**Limieten voor testers.** Omdat de link openbaar is, zitten er limieten op:

| Variabele | Standaard | Wat |
|---|---|---|
| `AI_LIMIT_PER_HOUR` | 30 | AI-verzoeken per bezoeker per uur |
| `AI_DAILY_LIMIT` | 200 | AI-verzoeken per dag voor alle bezoekers samen |
| `API_LIMIT_PER_10_MIN` | 600 | Alle API-verzoeken per bezoeker per 10 minuten |

Boven de AI-limiet valt de app terug op de ingebouwde regels, dus hij blijft werken. De testversie staat op `noindex`, zodat zoekmachines hem niet opnemen.

## Tarieven bijwerken (jaarlijks)

- **Straatparkeren** gaat vanzelf: RDW publiceert de tarieven van het volgende jaar al vooruit (2027 staat er al in).
- **Garages en transferia** komen uit het gemeentebesluit. Dat verschijnt meestal half december op [lokaleregelgeving.overheid.nl](https://lokaleregelgeving.overheid.nl). Voeg dan in `server/config.js` bij `DECREE_TARIFFS` een blok toe voor het nieuwe jaar. Tot die tijd toont de app garageprijzen in het nieuwe jaar met **≈** en het label **Schatting**.

## AI (Claude)

ParkSmart gebruikt Claude (`claude-opus-5-5`) voor twee dingen:

1. **Vraag het AI**: je typt een zin als *"waar parkeer ik het goedkoopst voor de HEMA, zaterdag om 14:00 voor 2 uur?"* en Claude maakt daar zoekparameters van (bestemming, datum, tijd, duur, filters). De bestemming mag een winkel- of bedrijfsnaam zijn; heeft een keten meerdere vestigingen, dan kun je met één tik wisselen.
2. **Advies**: Claude krijgt de door de app berekende opties en legt in een paar zinnen uit wat de slimste keuze is, inclusief de afweging tussen prijs en looptijd. Ga je naar een winkel waarvan de openingstijden bekend zijn, dan meldt Claude ook als die dicht is bij aankomst of sluit tijdens je bezoek.

Prijzen rekent de app altijd zelf uit. Claude krijgt alleen die berekende feiten en heeft de opdracht niets te verzinnen. De antwoorden komen terug als gestructureerde JSON (`output_config.format`), zodat de app ze veilig kan gebruiken. Ik heb ook server-side fallbacks aangezet (`fallbacks: "default"`): als het model een verzoek weigert, probeert de API automatisch een passend ander model.

Zet je sleutel in een `.env`-bestand (zie `.env.example`):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Zonder sleutel werkt alles ook. De app gebruikt dan een ingebouwde Nederlandstalige regelparser en een advies-sjabloon, en laat in de interface zien dat de AI uit staat.

## Waar komen de gegevens vandaan?

| Bron | Wat | Betrouwbaarheid |
|---|---|---|
| [Besluit privaatrechtelijke parkeertarieven 's-Hertogenbosch 2026](https://lokaleregelgeving.overheid.nl/CVDR750485) | Tarieven van de garages Wolvenhoek, Sint Josephstraat, Paleiskwartier, Sint Jan en Stationsplein, plus de transferia | Officieel |
| [RDW Open Data Parkeren](https://opendata.rdw.nl/browse?q=Open%20Data%20Parkeren) (NPR) | Betaalzones (polygonen), betaaltijden per dag, tarieven 2026, maximale parkeerduur, feestdagen | Officieel, dagelijks bijgewerkt |
| [RDW Shared Parking Data Platform](https://npropendata.rdw.nl/parkingdata/v2/) | Ingangen en capaciteit van garages, tarieven van P+R Mayweg, P+R Magistratenlaan en het ziekenhuis, **live vrije plekken** | Exploitant |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass) | Extra gratis parkeerplekken en particuliere garages zonder open tarief | Community |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass) | Ruim 2.300 bedrijven in de gemeente: winkels, horeca, kantoren, zorg, sport, hotels, met adres en (vaak) openingstijden | Community, wekelijks ververst |
| [PDOK Locatieserver](https://www.pdok.nl/) en BRT Achtergrondkaart | Adressen zoeken en de kaart | Officieel (Kadaster) |
| OSRM voetprofiel (routing.openstreetmap.de) | Echte looproute als je een optie opent | Community |

Een paar keuzes die ik bewust heb gemaakt:

- **Geen geschatte bezetting.** Live vrije plekken toon ik alleen als de bron in het afgelopen uur is bijgewerkt. Op dit moment geldt dat voor P+R Mayweg en P+R Magistratenlaan. De gemeentelijke garages publiceren geen actuele bezetting in open data.
- **RDW wint van OpenStreetMap.** Een plek die in OSM "gratis" heet maar binnen een RDW-betaalzone ligt, laat ik weg.
- **Prijs onbekend blijft onbekend.** Garages zonder open tarief (zoals Q-Park Tolbrug) staan met een vraagteken in de lijst en tellen niet mee voor "goedkoopst".
- **Offline terugval.** Als een bron niet bereikbaar is, gebruikt de server de laatste cache of de meegeleverde momentopname in `data/snapshot/`. De app laat dat dan duidelijk zien onderaan de lijst. Een nieuwe momentopname maak je met `npm run snapshot` (alleen de bedrijven: `npm run snapshot -- places`).
- **Bedrijven zijn communitydata.** Een officieel, vrij register van alle bedrijven met locatie bestaat niet (het KvK-handelsregister is niet open). Naam, adres en openingstijden uit OpenStreetMap kunnen dus verouderd zijn; de app zegt dat er altijd bij.

## Aannames en beperkingen

- Garages: het besluit noemt een tarief "per 60 minuten". Ik reken per minuut, zoals de gemeentelijke garages in eerdere RDW-data deden.
- Avondtarief garages: 18:00–07:00, op donderdag (koopavond) vanaf 21:00, en op zon- en feestdagen 07:00–12:00. Extra koopavonden zitten er niet in.
- Transferia: RDW-data noemt €3,00 per dag, het gemeentebesluit €5,00 (inclusief bus of leenfiets voor max. 4 personen). Ik toon het bedrag uit het besluit.
- Looptijden in de lijst zijn schattingen (hemelsbreed × 1,25 bij 4,8 km/u). Als je een optie opent, haalt de app de echte looproute op.
- Bij straatparkeren staat de pin op het punt van de zone dat het dichtst bij je bestemming ligt.
- Inrijtijden van sommige garages komen uit RDW-gegevens uit 2018. Ik toon ze alleen als waarschuwing.
- ParkSmart werkt voorlopig alleen binnen de gemeente 's-Hertogenbosch.

Controleer ter plaatse altijd de borden en de automaat.

## Projectstructuur

```
server/
  index.js        HTTP-server, API-routes en statische bestanden
  config.js       Den Bosch-instellingen, tarieven uit het besluit, snelkeuzes
  rdw.js          RDW Open Data Parkeren: zones, tijdvakken, tariefdelen
  spdp.js         RDW SPDP: locaties, operatortarieven, live bezetting
  osm.js          OpenStreetMap via Overpass (parkeerplekken)
  places.js       Bedrijven uit OpenStreetMap: zoeken op naam, merk, categorie en straat
  pricing.js      Tariefberekening (straat, garage, transferium, SPDP)
  search.js       Combineert alle bronnen tot vergelijkbare opties
  geocode.js      PDOK + Nominatim + snelkeuzes
  ai.js           Claude: zoekvraag begrijpen en advies schrijven
  rules.js        Terugval zonder AI
public/           Frontend (HTML, CSS, JavaScript, Leaflet-kaart)
data/snapshot/    Momentopname van de bronnen voor offline gebruik
scripts/          make-snapshot.js
```

## Testen

```bash
npm test
```

De tests controleren de tariefregels (dag-, avond- en dagmaximum, zondag gratis, eerste 2 uur gratis, feestdagen, maximale parkeerduur) en de regelparser.
