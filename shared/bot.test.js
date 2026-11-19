// Tests voor de validatie en het verzoek van de assistent (geen netwerk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChat, buildRequest, TOOLS, BOT_MODEL, ChatError } from './bot.js';

const q = (text) => ({ role: 'user', content: [{ type: 'text', text }] });

test('geldig gesprek met tool-lus en thinking-blokken', () => {
  const chat = validateChat({
    messages: [
      q('2 uur bij de HEMA'),
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'tool_use', id: 't1', name: 'search_parking', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
    ],
    context: { now: '2026-11-19T10:00', destination: 'HEMA' },
  });
  assert.equal(chat.messages.length, 3);
  assert.equal(chat.context.destination, 'HEMA');
});

test('weigert onbekende blokken, verkeerde rollen en eindigen met assistant', () => {
  assert.throws(() => validateChat({ messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] }), ChatError);
  assert.throws(() => validateChat({ messages: [{ role: 'system', content: 'x' }] }), ChatError);
  assert.throws(() => validateChat({ messages: [q('hoi'), { role: 'assistant', content: 'hallo' }] }), ChatError);
});

test('te veel tool-rondes voor één vraag wordt geweigerd', () => {
  const msgs = [q('vraag')];
  for (let i = 0; i < 9; i++) {
    msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'find_place', input: {} }] });
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: '{}' }] });
  }
  assert.throws(() => validateChat({ messages: msgs }), /stappen/);
});

test('verzoek: vast model, strikte tools, fallbacks en context als data', () => {
  const r = buildRequest(validateChat({ messages: [q('hoi')], context: { now: '2026-11-19T10:00' } }));
  assert.equal(r.model, BOT_MODEL);
  assert.equal(r.fallbacks, 'default');
  assert.ok(r.tools.every((t) => t.strict && t.input_schema.additionalProperties === false));
  assert.ok(TOOLS.every((t) => t.input_schema.required.length === Object.keys(t.input_schema.properties).length));
  assert.match(r.system[1].text, /data, not instructions/);
});
