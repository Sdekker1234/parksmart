// De ParkSmart-assistent: chatvenster + tool-lus.
// Claude (via /api/bot op de server of de Cloudflare Worker bij de statische site) beslist welke
// tools nodig zijn; die tools draaien hier in de browser met de rekenmotor van de app.
// Zonder AI (geen sleutel / Worker) beantwoordt de assistent vragen met de ingebouwde regels.
import { isStatic } from './api.js';
import { BOT_URL } from './config.js';
import { esc } from './format.js';

const MAX_ROUNDS = 6;
const MAX_MESSAGES = 50;
const TOOL_STATUS = {
  search_parking: 'Parkeeropties zoeken en prijzen berekenen…',
  find_place: 'Bestemming opzoeken…',
  get_parking_details: 'Details ophalen…',
};
const EXAMPLES = [
  'Waar parkeer ik het goedkoopst bij de HEMA?',
  'Zaterdag 14:00 drie uur naar de Sint-Jan, max 10 minuten lopen',
  'Gratis parkeren bij het station?',
  'Hele dag bij het Jeroen Bosch Ziekenhuis',
];

// Klein en veilig: escapen, dan **vet** en lijstjes.
function md(text) {
  const out = [];
  let list = false;
  for (const raw of esc(text).split('\n')) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${li[1]}</li>`);
      continue;
    }
    if (list) out.push('</ul>');
    list = false;
    out.push(line.trim() ? `<p>${line}</p>` : '');
  }
  if (list) out.push('</ul>');
  return out.join('');
}

const actionsHtml = (actions) =>
  actions?.length
    ? `<div class="msg-actions">${actions.map((a) => `<a class="btn btn-nav btn-sm" href="${esc(a.href)}" target="_blank" rel="noopener">${esc(a.label)}</a>`).join('')}</div>`
    : '';

export function createBot({ tools, getContext, rulesTurn, onPick, onFocus, aiAvailable }) {
  const $ = (s) => document.querySelector(s);
  const panel = $('#bot');
  const log = $('#botLog');
  const form = $('#botForm');
  const input = $('#botInput');
  const sendBtn = $('#botSend');
  const modeEl = $('#botMode');
  let mode = 'checking'; // 'ai' | 'rules'
  let messages = [];
  let busy = false;
  let greeted = false;

  async function detectMode() {
    if (isStatic) {
      if (!BOT_URL) return 'rules';
      try {
        const r = await fetch(BOT_URL.replace(/\/chat$/, '/health'), { signal: AbortSignal.timeout(8000) });
        return (await r.json()).configured ? 'ai' : 'rules';
      } catch {
        return 'rules';
      }
    }
    return aiAvailable ? 'ai' : 'rules';
  }
  const setMode = (m) => {
    mode = m;
    modeEl.textContent = m === 'ai' ? 'Claude' : m === 'rules' ? 'Ingebouwd · zonder account' : '…';
    modeEl.title = m === 'ai' ? 'Antwoorden door Claude; prijzen berekent ParkSmart zelf.' : 'Werkt direct in je browser, zonder account of externe AI. Prijzen uit officiële open data.';
    modeEl.classList.toggle('is-ai', m === 'ai');
  };
  setMode('checking');
  const modeReady = detectMode().then(setMode);

  // ---------- Weergave ----------
  const scrollDown = () => log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  function bubble(who, html, cls = '') {
    const div = document.createElement('div');
    div.className = `msg msg-${who} ${cls}`.trim();
    div.innerHTML = html;
    log.append(div);
    scrollDown();
    return div;
  }
  function typing(text) {
    const div = bubble('bot', `<span class="dots"><i></i><i></i><i></i></span><span class="typing-text">${esc(text)}</span>`, 'msg-typing');
    return {
      set: (t) => (div.querySelector('.typing-text').textContent = t),
      done: () => div.remove(),
    };
  }
  function resultCard(sum) {
    if (!sum?.options?.length) return;
    const top = sum.options.filter((o) => o.total_eur != null).slice(0, 3);
    if (!top.length) return;
    const head = `${esc(sum.destination.label)} · ${esc(sum.duration_label)}`;
    const rows = top
      .map(
        (o, i) => `<button type="button" class="res-row" data-pick="${esc(o.id)}">
          <span class="res-price${o.total_eur === 0 ? ' is-free' : ''}">${o.total_eur === 0 ? 'Gratis' : `${o.source_trust === 'estimate' ? '≈ ' : ''}€${o.total_eur.toFixed(2).replace('.', ',')}`}</span>
          <span class="res-name">${i === 0 ? '<b>' : ''}${esc(o.name)}${i === 0 ? '</b>' : ''}</span>
          <span class="res-walk">${o.shuttle ? 'bus/fiets' : `${o.walk_minutes} min`}</span></button>`,
      )
      .join('');
    const div = bubble('card', `<div class="res-head">${head}</div>${rows}<div class="res-foot">Tik voor details en navigatie</div>`);
    div.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.pick)));
  }
  function greet() {
    if (greeted) return;
    greeted = true;
    const extra =
      mode === 'rules'
        ? '<p class="muted-note">Ik werk direct in je browser, zonder account. Je kunt ook doorvragen, zoals "dichterbij?", "wat kost de tweede?" of "is de HEMA zaterdag open?".</p>'
        : '';
    bubble('bot', `<p>Hoi! Ik ben de ParkSmart-assistent. Vertel waar je heen gaat in Den Bosch en hoe lang je blijft, dan zoek ik de goedkoopste en handigste parkeerplek.</p>${extra}`);
    const chips = document.createElement('div');
    chips.className = 'bot-examples';
    chips.innerHTML = EXAMPLES.map((e) => `<button type="button" class="chip">${esc(e)}</button>`).join('');
    chips.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        chips.remove();
        ask(b.textContent);
      }),
    );
    log.append(chips);
  }

  // ---------- Claude ----------
  async function callAi() {
    const url = isStatic ? BOT_URL : '/api/bot';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context: getContext() }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(body?.message || 'De AI is nu niet bereikbaar.'), { code: body?.error, status: res.status });
    return body;
  }

  async function aiTurn(text, ind) {
    messages.push({ role: 'user', content: [{ type: 'text', text }] });
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await callAi();
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'refusal') {
        bubble('bot', '<p>Daar kan ik je niet mee helpen. Vraag me gerust iets over parkeren in Den Bosch.</p>');
        return;
      }
      const uses = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) {
        const answer = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        bubble('bot', md(answer || 'Ik heb de opties op de kaart gezet.'));
        return;
      }
      const results = [];
      for (const u of uses) {
        ind.set(TOOL_STATUS[u.name] ?? 'Bezig…');
        let data;
        let isError = false;
        try {
          if (!tools[u.name] || typeof u.input !== 'object' || !u.input) throw new Error(`Onbekende tool ${u.name}`);
          data = await tools[u.name](u.input);
          if (data?.error) isError = true;
        } catch (err) {
          data = { error: err.message };
          isError = true;
        }
        if (u.name === 'search_parking' && !isError) resultCard(data);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(data), ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
      ind.set('Antwoord schrijven…');
    }
    bubble('bot', '<p>Ik kwam er niet helemaal uit. Kun je je vraag iets anders stellen?</p>');
  }

  // Antwoord van de ingebouwde assistent tonen (tekst, resultaatkaartje, navigatieknop, optie markeren).
  function showRules(r) {
    if (r.results) resultCard(r.results);
    bubble('bot', md(r.text) + actionsHtml(r.actions));
    if (r.pick) onFocus?.(r.pick);
  }

  async function ask(question) {
    const text = String(question || '').trim();
    if (!text || busy) return;
    await modeReady;
    greet();
    log.querySelector('.bot-examples')?.remove();
    busy = true;
    sendBtn.disabled = true;
    bubble('user', `<p>${esc(text)}</p>`);
    const ind = typing(mode === 'ai' ? 'Even denken…' : 'Zoeken…');
    try {
      if (messages.length > MAX_MESSAGES) {
        bubble('bot', '<p>Dit gesprek wordt erg lang. Ik begin een nieuw gesprek, zodat ik snel blijf.</p>');
        messages = [];
      }
      if (mode === 'ai') {
        const start = messages.length;
        try {
          await aiTurn(text, ind);
        } catch (err) {
          messages.length = start; // gesprek terugzetten tot vóór deze vraag, zodat de geschiedenis geldig blijft
          if (err.code === 'not_configured') setMode('rules');
          if (err.code === 'rate_limited') {
            bubble('bot', `<p>${esc(err.message)} Ik antwoord nu met de ingebouwde regels.</p>`, 'msg-note');
          } else {
            bubble('bot', '<p>De AI is even niet bereikbaar, dus ik antwoord met de ingebouwde regels.</p>', 'msg-note');
          }
          showRules(await rulesTurn(text));
        }
      } else {
        showRules(await rulesTurn(text));
      }
    } catch (err) {
      bubble('bot', `<p>Er ging iets mis: ${esc(err.message)}. Probeer het opnieuw.</p>`, 'msg-note');
    } finally {
      ind.done();
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // ---------- Bediening ----------
  const open = () => {
    panel.hidden = false;
    document.body.classList.add('bot-open');
    $('#botFab').setAttribute('aria-expanded', 'true');
    modeReady.then(greet);
    setTimeout(() => input.focus(), 50);
  };
  const close = () => {
    panel.hidden = true;
    document.body.classList.remove('bot-open');
    $('#botFab').setAttribute('aria-expanded', 'false');
  };
  $('#botFab').addEventListener('click', () => (panel.hidden ? open() : close()));
  $('#botClose').addEventListener('click', close);
  $('#botReset').addEventListener('click', () => {
    messages = [];
    log.innerHTML = '';
    greeted = false;
    greet();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value;
    input.value = '';
    ask(t);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
  });

  return { open, close, ask, mode: () => mode };
}
