# Bezetting P+R Den Bosch (meetreeks)

Deze branch bevat alleen data. Elke keer dat de GitHub Action van ParkSmart draait (ongeveer elk half uur), bewaart `scripts/record-occupancy.js` de actuele bezetting van de locaties met live data. Daarmee willen we later voorspellen hoe vol een P+R waarschijnlijk is als je aankomt.

- **Bron:** RDW Shared Parking Data Platform (open data), dezelfde stand die de app live toont.
- **Locaties:** alleen locaties die een actuele stand doorgeven. Op 25 november 2026 zijn dat P+R Mayweg en P+R Magistratenlaan. Garage Sint Josephstraat geeft sinds maart 2025 geen nieuwe stand meer en wordt overgeslagen.
- **Geen persoonsgegevens:** alleen het aantal vrije plekken per locatie.
- **Bestanden:** één CSV per maand (`bezetting-JJJJ-MM.csv`), plus `laatste.json` met per locatie de laatst bewaarde meting, zodat dezelfde stand niet twee keer wordt opgeslagen.

## Kolommen

| Kolom | Betekenis |
|---|---|
| `meting_lokaal` | Tijdstip van de meting, Nederlandse tijd |
| `meting_utc` | Hetzelfde tijdstip in UTC |
| `opgehaald_utc` | Wanneer de Action de stand ophaalde |
| `dag`, `uur`, `minuut` | Weekdag (ma t/m zo) en tijd van de meting, Nederlandse tijd |
| `locatie_id`, `locatie` | RDW-id en naam van de locatie |
| `vrij`, `capaciteit` | Vrije plekken en totaal aantal plekken |
| `bezet_pct` | Percentage bezet: (capaciteit − vrij) / capaciteit × 100 |
| `open`, `vol` | Zoals de exploitant ze doorgeeft |

## Bekende gaten

GitHub draait geplande Actions niet altijd precies op tijd, en soms een keer niet. Er kunnen dus gaten in de reeks zitten. Een stand die meer dan 3 uur oud is, wordt niet bewaard.
