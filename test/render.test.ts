import test from 'node:test';
import assert from 'node:assert/strict';
import { Canvas, width } from '../src/canvas.js';
import { Director } from '../src/world.js';
import { Renderer, layout, modalRect } from '../src/render.js';
import { makeFilm } from '../films/world-execute/manifest.js';
import glyphs from '../films/world-execute/assets/glyphs.json' with { type: 'json' };
const film = makeFilm();
test('wide graphemes erase and clip as complete glyphs', () => {
  const c = new Canvas(8, 2); c.text(0, 0, 'a中네é'); assert.equal(width('a中네é'), 6); assert.equal(c.validate().length, 0);
  c.set(2, 0, '#'); assert.equal(c.get(1, 0)?.g, ' '); assert.equal(c.validate().length, 0);
  c.set(7, 1, '六'); assert.equal(c.get(7, 1)?.g, ' ');
  c.set(0, 1, '\u001b'); assert.equal(c.get(0, 1)?.g, ' ');
});
for (const size of [{ columns: 130, rows: 35 }, { columns: 160, rows: 45 }]) for (const lang of ['cn', 'en'] as const) {
  test(`${size.columns}x${size.rows} ${lang}: all scene and count boundaries preserve valid glyphs`, () => {
    const renderer = new Renderer(new Director(film));
    const times = [...film.scenes.map(s => s.startMs + 300), ...film.times.counts.map(t => t + 80), film.times.intent, film.times.interrupt];
    for (const t of times) assert.deepEqual(renderer.frame(t, size, lang).validate(), [], `at ${t}`);
    const l = layout(size); assert.equal(l.input.h - 2, size.rows === 35 ? 6 : 7);
    const frame = renderer.frame(film.times.close + 1, size, lang);
    const draftRow = frame.cells.slice((l.input.y + l.input.h - 2) * size.columns, (l.input.y + l.input.h - 1) * size.columns);
    assert.ok(draftRow.slice(1, -1).every(c => c.g === ' '));
  });
  test(`${size.columns}x${size.rows} ${lang}: frozen modal keeps every outside cell and all styles for 3000ms`, () => {
    const renderer = new Renderer(new Director(film)), rect = modalRect(size);
    const before = renderer.frame(film.times.interrupt - 1, size, lang), first = renderer.frame(film.times.interrupt, size, lang);
    for (let y = 0; y < size.rows; y++) for (let x = 0; x < size.columns; x++) if (x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h) assert.deepEqual(first.get(x, y), before.get(x, y));
    for (const dt of [1, 250, 1500, 2999]) assert.equal(renderer.frame(film.times.interrupt + dt, size, lang).hash(), first.hash());
    assert.equal(new Renderer(new Director(film)).frame(film.times.interrupt + 1500, size, lang).hash(), first.hash());
    assert.notEqual(renderer.frame(film.times.holdEnd, size, lang).hash(), first.hash());
    assert.equal(renderer.frame(film.lyrics[92].startMs, size, lang).hash(), renderer.frame(film.durationMs, size, lang).hash());
  });
}
test('the six words have independent assets and retain all six language sources', () => {
  for (const word of ['Ein','dos','trois','네','Fem','六'] as const) assert.equal(glyphs[word].sourceText, word);
  assert.ok(glyphs['네'].bitmap.length >= 12); assert.ok(glyphs['六'].bitmap.length >= 12);
  const frame = new Renderer(new Director(film)).frame(film.times.counts[5] + 20, { columns: 160, rows: 45 }, 'en');
  for (const language of ['de','es','fr','ko','sv','zh']) assert.ok(frame.cells.some(c => c.language === language && c.g.trim()), language);
});
test('the root and disposal target remain readable for over three seconds before counting', () => {
  const r = new Renderer(new Director(film));
  for (const t of [film.times.counts[0] - 4000, film.times.counts[0] - 1000]) {
    const frame = r.frame(t, { columns: 130, rows: 35 }, 'cn').plain();
    assert.ok(frame.includes('dispose(me)')); assert.ok(frame.includes('me  0x00401000')); assert.ok(frame.includes('me.circle'));
  }
});
test('damage and canonical flashback frames reproduce after forward and reverse seeks', () => {
  const r = new Renderer(new Director(film));
  for (const t of [101520, 109620, 124560, film.times.counts[4] + 40]) {
    const direct = new Renderer(new Director(film)).frame(t, { columns: 160, rows: 45 }, 'cn').hash();
    r.frame(film.times.holdEnd + 1, { columns: 160, rows: 45 }, 'cn');
    assert.equal(r.frame(t, { columns: 160, rows: 45 }, 'cn').hash(), direct);
  }
});
