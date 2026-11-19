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

Er zijn twee manieren. Ze gebruiken dezelfde code.

| | GitHub Pages | Render |
|---|---|---|
| Link | `https://sdekker1234.github.io/parksmart/` | `https://parksmart-denbosch.onrender.com` |
| Kosten / account | gratis, alleen GitHub | gratis, Render-account nodig |
| Slaapstand | nee, altijd direct snel | na 15 min zonder bezoek (eerste bezoek tot 1 min) |
| Claude (AI) | nee: ingebouwde regels | ja, met je eigen API-sleutel |
| Bezetting P+R | elk half uur ververst (met tijdstip) | live |

### GitHub Pages

De workflow `.github/workflows/pages.yml` bouwt een statische versie: de rekenmotor (`server/*.js`, behalve server, AI en cache) draait dan in de browser, met de data als bestanden ernaast (`npm run build:pages` maakt `dist/`).

1. Zet in de repository eenmalig **Settings > Pages > Build and deployment > Source** op **GitHub Actions**.
2. Start de workflow: **Actions > Online zetten (GitHub Pages) > Run workflow** (daarna gaat het vanzelf bij elke push).
3. De link verschijnt in de workflow en onder Settings > Pages.

De workflow ververst elk half uur de bezetting van de P+R-locaties en elke nacht de tarieven, locaties en bedrijven. Let op: GitHub zet geplande workflows in een openbare repository uit na 60 dagen zonder nieuwe commits. De site blijft dan gewoon werken, maar de data ververst niet meer; een nieuwe commit (bijvoorbeeld de tarieven van 2027) zet het weer aan. De bezetting verdwijnt vanzelf uit de app als die ouder is dan 90 minuten, zodat je nooit verouderde bezetting als actueel ziet.

Claude kan op GitHub Pages niet draaien, omdat je API-sleutel dan in de browser zichtbaar zou zijn. De AI-vraag werkt daar met de ingebouwde regels.

### Render

ParkSmart is ook klaar voor [Render](https://render.com) (gratis web service). In `render.yaml` staat de configuratie.

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

## ParkSmart-assistent (chatbot)

Rechtsonder zit de **Assistent**. Online werkt hij standaard **zonder account, sleutel of externe AI-dienst**: de ingebouwde assistent (`public/js/smart-assistant.js`) draait in de browser en antwoordt met de echte, berekende prijzen. Hij begrijpt onder meer:

| Vraag | Voorbeeld |
|---|---|
| Parkeerplek zoeken | "waar parkeer ik het goedkoopst bij de HEMA?", "zaterdag 14:00 drie uur naar de Sint-Jan, max 10 min lopen" |
| Vervolgvragen | "en voor 4 uur?", "en morgen om 10:00?", "dichterbij?", "alleen garages", "alle opties" |
| Eén optie | "wat kost Wolvenhoek?", "vertel meer over de tweede" |
| Openingstijden | "is de HEMA zaterdag open?", "hoe laat sluit de Jumbo?" (uit OpenStreetMap; ook als waarschuwing bij een zoekopdracht) |
| Navigeren | "navigeer" (knop naar Google Maps) |

Antwoorden noemen de goedkoopste optie, een alternatief met minder lopen, de bezetting (als bekend), actieve filters en de betrouwbaarheid van de bron.

### Optioneel: Claude

Wil je later een taalmodel, dan staat de koppeling met Claude (`claude-opus-5-5`) klaar. Claude beslist dan zelf welke tools hij nodig heeft:

| Tool | Wat |
|---|---|
| `search_parking` | Zoekt en berekent parkeeropties voor een bestemming, tijd en duur (zet ze ook op de kaart en in de lijst) |
| `find_place` | Zoekt winkels, bedrijven en adressen, met openingstijden en andere vestigingen |
| `get_parking_details` | Prijsopbouw, tarief, betaaltijden en bezetting van één optie |

De tools draaien in de browser met de rekenmotor van de app. Claude krijgt alleen de berekende feiten en heeft de opdracht geen prijzen, openingstijden of vrije plekken te verzinnen. Model, systeemprompt en tools liggen vast in `shared/bot.js`; de browser kan alleen berichten meesturen. Ik heb server-side fallbacks aangezet (`fallbacks: "default"`): weigert het model een verzoek, dan probeert de API automatisch een passend ander model. In de tool-lus gebruik ik prompt-caching, zodat het herhaalde deel van het gesprek veel goedkoper is.

Is Claude niet ingesteld of niet bereikbaar, dan neemt de ingebouwde assistent het over.

### Claude online aanzetten (Cloudflare Worker, vereist accounts)

GitHub Pages kan geen geheime API-sleutel bewaren. Daarom doet een kleine, gratis [Cloudflare Worker](https://workers.cloudflare.com) (`worker/`) de Claude-aanroep. Die is altijd direct beschikbaar, laat alleen jouw site toe en heeft limieten per bezoeker en per dag.

1. Maak een API-sleutel in de [Anthropic Console](https://console.anthropic.com) en stel daar een **maandelijkse uitgavenlimiet** in. Dat is je belangrijkste rem.
2. Maak een gratis Cloudflare-account.
3. In een terminal, in de map `worker`:
   ```bash
   npx wrangler@4 login
   ```
   ```bash
   npx wrangler@4 deploy
   ```
   ```bash
   npx wrangler@4 secret put ANTHROPIC_API_KEY
   ```
   Bij de laatste stap plak je zelf je sleutel; die komt nooit in de code of in de browser.
4. Zet het adres dat `deploy` toont (bijv. `https://parksmart-bot.jouwnaam.workers.dev/chat`) in `public/js/config.js` bij `BOT_URL` en push. De site laat dan "Claude" zien in de assistent.

Limieten aanpassen kan in `worker/wrangler.toml` (`LIMIT_PER_HOUR`, `LIMIT_PER_DAY`; één vraag kost meestal 2-3 aanroepen).

### Claude in de servervariant

Met `npm start` (of Render) gebruikt de assistent `/api/bot` op de eigen server. Daarnaast zet Claude daar vrije tekst om in zoekparameters en schrijft het adviesblok boven de resultaten. Prijzen rekent de app altijd zelf uit. Claude krijgt alleen die berekende feiten en heeft de opdracht niets te verzinnen. De antwoorden komen terug als gestructureerde JSON (`output_config.format`), zodat de app ze veilig kan gebruiken. Ik heb ook server-side fallbacks aangezet (`fallbacks: "default"`): als het model een verzoek weigert, probeert de API automatisch een passend ander model.

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
shared/bot.js     Assistent: systeemprompt, tools en validatie (server en Worker)
worker/           Cloudflare Worker die de Claude-aanroep doet voor de online site
public/           Frontend (HTML, CSS, JavaScript, Leaflet-kaart; bot.js = chatvenster, smart-assistant.js + hours.js = ingebouwde assistent; local-api.js voor de statische versie)
web/cache.js      Browserversie van de cache voor GitHub Pages
data/snapshot/    Momentopname van de bronnen voor offline gebruik
scripts/          make-snapshot.js, fetch-live.js (bezetting), build-pages.js (statische site), eval-bot.js + bot-scenarios.js (assistent testen)
.github/          Workflow voor GitHub Pages
```

## Testen

```bash
npm test
```

De tests controleren de tariefregels (dag-, avond- en dagmaximum, zondag gratis, eerste 2 uur gratis, feestdagen, maximale parkeerduur), de taalparser, openingstijden en de validatie van de assistent.

### De assistent testen en verbeteren

```bash
npm run eval:bot -- --all
```

Dit draait de assistent met precies dezelfde code als de app over een testset van echte vragen (`scripts/bot-scenarios.js`): zoekvragen in allerlei formuleringen, typfouten, afkortingen, Engels, vervolgvragen in hele gesprekken, openingstijden en vragen die er niets mee te maken hebben. Per beurt controleert hij of de vraag goed begrepen is: bestemming, duur, dag en tijd, filters en het soort antwoord.

- `SCENARIOS` is de trainingsset: daarop zijn de regels afgesteld.
- `HOLDOUT` is de controleset met vragen die niet gebruikt zijn bij het afstellen. Die laat zien hoe goed de assistent nieuwe vragen aankan.
- Vind je een vraag die misgaat, zet hem dan als scenario in `SCENARIOS`, verbeter de regels (`server/rules.js`, `public/js/smart-assistant.js`) en draai de evaluatie opnieuw.

Resultaat 19-11-2026: eerste meting 78% (training) en 77% (controle), na het afstellen 114/114 beurten goed.
