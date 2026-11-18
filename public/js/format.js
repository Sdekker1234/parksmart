// Nederlandse opmaak voor prijzen, tijden en afstanden.
const EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });

export const eur = (x) => EUR.format(x).replace(/ /g, ' ');
export const eurShort = (x) => (x === 0 ? 'Gratis' : eur(x).replace(',00', '').replace('€ ', '€'));

export function duration(min) {
  if (min < 60) return `${min} min`;
  const days = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'dag' : 'dagen'}`);
  if (h) parts.push(`${h} uur`);
  if (m) parts.push(`${m} min`);
  return parts.join(' ');
}

export const distance = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

const pad = (n) => String(n).padStart(2, '0');
export const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function nowRounded(stepMin = 5) {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / stepMin) * stepMin);
  return d;
}

const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
export function arrivalLabel(iso) {
  const [date, time] = iso.split('T');
  const d = new Date(`${date}T00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400e3);
  const day = diff === 0 ? 'vandaag' : diff === 1 ? 'morgen' : `${DAYS[d.getDay()]} ${d.getDate()}-${d.getMonth() + 1}`;
  return `${day} ${time}`;
}

export function timeAgo(ts) {
  const min = Math.round((Date.now() - ts) / 60e3);
  if (min < 1) return 'zojuist';
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} uur geleden`;
  return new Date(ts).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
