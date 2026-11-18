// Leaflet-kaart: zones, bestemming, prijs-pins en looproute.
/* global L */
import { eurShort, esc, distance } from './format.js';

// BRT Achtergrondkaart (Kadaster via PDOK): gratis, geen sleutel nodig.
const TILE_LIGHT = 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/pastel/EPSG:3857/{z}/{x}/{y}.png';
const TILE_DARK = 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png';
const ATTR = 'Kaart &copy; <a href="https://www.kadaster.nl" target="_blank" rel="noopener">Kadaster</a> · Data: RDW, gemeente \'s-Hertogenbosch, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-bijdragers';

const zoneColor = (perHour) => (perHour >= 4 ? '#1e3a5f' : perHour >= 3.5 ? '#2b6cb0' : '#5b9be0');

export function createMap(el, center, { onMapClick, onMarkerClick }) {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lon], 15);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer(dark ? TILE_DARK : TILE_LIGHT, { attribution: ATTR, maxZoom: 19, minZoom: 6 }).addTo(map);
  map.attributionControl.setPrefix(false);

  const zoneLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  let destMarker = null;
  const markers = new Map();
  const zonePolys = new Map();

  map.on('click', (e) => onMapClick?.({ lat: e.latlng.lat, lon: e.latlng.lng }));

  return {
    map,
    setZones(zones) {
      zoneLayer.clearLayers();
      zonePolys.clear();
      for (const z of zones) {
        const color = zoneColor(z.perHour);
        const layer = L.polygon(z.polygons, {
          color,
          weight: 1,
          opacity: 0.55,
          fillColor: color,
          fillOpacity: 0.07,
          bubblingMouseEvents: true,
        });
        const extra = z.freeFirstMin ? ` · eerste ${z.freeFirstMin / 60} uur gratis` : '';
        layer.bindTooltip(`<b>${esc(z.name)}</b><br>${esc(z.fareDesc)} · €${z.perHour.toFixed(2).replace('.', ',')}/u${extra}<br><small>${esc(z.paidTimes)}</small>`, {
          sticky: true,
          className: 'zone-tip',
        });
        layer.addTo(zoneLayer);
        zonePolys.set(z.id, layer);
      }
    },
    highlightZone(id) {
      for (const [zid, layer] of zonePolys) {
        const on = zid === id;
        layer.setStyle({ weight: on ? 3 : 1, fillOpacity: on ? 0.22 : 0.07, opacity: on ? 0.95 : 0.55 });
        if (on) layer.bringToFront();
      }
    },
    setDestination(dest) {
      if (destMarker) destMarker.remove();
      if (!dest) return;
      destMarker = L.marker([dest.lat, dest.lon], {
        icon: L.divIcon({ className: 'ps-marker', html: '<div class="dest-pin"></div>', iconSize: [0, 0] }),
        zIndexOffset: 2000,
        keyboard: false,
        title: dest.label || 'Bestemming',
      }).addTo(map);
    },
    setOptions(options, { cheapestId, selectedId, fullIds = new Set() }) {
      markerLayer.clearLayers();
      markers.clear();
      options.forEach((o, i) => {
        const known = o.price.known && o.price.feasible;
        const typeCls = o.id === cheapestId ? 'pin-cheapest' : !known ? 'pin-unknown' : `pin-${o.type}`;
        const label = known ? `${o.price.estimated && o.price.total > 0 ? '≈' : ''}${eurShort(o.price.total)}` : '?';
        // Alleen een selectie krijgt een prijslabel; de rest een stip (minder rommel op de kaart).
        const full = fullIds.has(o.id) || o.id === cheapestId || o.id === selectedId;
        const cls = [full ? 'pin' : 'dot', typeCls, o.id === selectedId ? 'pin-selected' : ''].join(' ');
        const html = full
          ? `<div class="${cls}" title="${esc(o.name)}">${o.live ? '● ' : ''}${esc(label)}</div>`
          : `<div class="${cls}" title="${esc(o.name)} · ${esc(label)}"></div>`;
        const marker = L.marker([o.lat, o.lon], {
          icon: L.divIcon({ className: 'ps-marker', html, iconSize: [0, 0] }),
          zIndexOffset: o.id === selectedId ? 1500 : o.id === cheapestId ? 1000 : full ? 500 - i : known ? 0 : -500,
          riseOnHover: true,
          title: o.name,
          alt: `${o.name}, ${label}`,
        });
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onMarkerClick?.(o.id);
        });
        if (!full) marker.bindTooltip(`${esc(o.name)} · ${esc(label)}`, { direction: 'top', offset: [0, -6] });
        marker.addTo(markerLayer);
        markers.set(o.id, marker);
      });
    },
    fitTo(dest, options) {
      // Inzoomen op de bestemming en de beste opties op loopafstand (transferia liggen ver weg).
      const near = options.filter((o) => !o.shuttle).slice(0, 6);
      const pts = [[dest.lat, dest.lon], ...near.map((o) => [o.lat, o.lon])];
      if (pts.length < 2) return map.setView([dest.lat, dest.lon], 16);
      map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16, animate: true });
    },
    focus(o, dest) {
      const b = L.latLngBounds([[o.lat, o.lon], [dest.lat, dest.lon]]).pad(0.35);
      map.fitBounds(b, { maxZoom: 17, animate: true });
    },
    showRoute(coords, o) {
      routeLayer.clearLayers();
      if (!coords?.length) return;
      L.polyline(coords, { color: '#16a34a', weight: 5, opacity: 0.9, dashArray: '2 9', lineCap: 'round' })
        .bindTooltip(`Looproute${o ? ` vanaf ${esc(o.name)}` : ''}`, { sticky: true })
        .addTo(routeLayer);
    },
    showStraight(o, dest) {
      routeLayer.clearLayers();
      L.polyline([[o.lat, o.lon], [dest.lat, dest.lon]], { color: '#16a34a', weight: 3, opacity: 0.6, dashArray: '4 8' })
        .bindTooltip(`Hemelsbreed ${distance(o.walk.straightM)}`, { sticky: true })
        .addTo(routeLayer);
    },
    clearRoute() {
      routeLayer.clearLayers();
    },
    invalidate() {
      map.invalidateSize();
    },
  };
}
