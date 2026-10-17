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
  test(`${size.columns}x${size.rows} ${lang}: story freezes for 3000ms while captions follow the music`, () => {
    const renderer = new Renderer(new Director(film)), rect = modalRect(size, lang), storyH = layout(size).story.h;
    const story = (c: Canvas): string => JSON.stringify(c.cells.slice(0, size.columns * storyH));
    const before = renderer.frame(film.times.interrupt - 1, size, lang), first = renderer.frame(film.times.interrupt, size, lang);
    assert.ok(rect.y > layout(size).chat.y + layout(size).chat.h);
    assert.ok(rect.y + rect.h < storyH);
    for (let y = 0; y < storyH; y++) for (let x = 0; x < size.columns; x++) if (x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h) assert.deepEqual(first.get(x, y), before.get(x, y));
    for (const dt of [1, 250, 1500, 2999]) assert.equal(story(renderer.frame(film.times.interrupt + dt, size, lang)), story(first));
    assert.equal(story(new Renderer(new Director(film)).frame(film.times.interrupt + 1500, size, lang)), story(first));
    assert.notDeepEqual(renderer.frame(film.times.interrupt + 1500, size, lang).cells.slice(storyH * size.columns), first.cells.slice(storyH * size.columns));
    assert.notEqual(renderer.frame(film.times.holdEnd, size, lang).hash(), first.hash());
    assert.ok(renderer.frame(film.durationMs, size, lang).cells.every(cell => cell.g === ' '));
  });
}
test('the six words have independent assets and retain all six language sources', () => {
  for (const word of ['Ein','dos','trois','네','Fem','六'] as const) assert.equal(glyphs[word].sourceText, word);
  assert.ok(glyphs['네'].bitmap.length >= 12); assert.ok(glyphs['六'].bitmap.length >= 12);
  const frame = new Renderer(new Director(film)).frame(film.times.counts[5] + 20, { columns: 160, rows: 45 }, 'en');
  for (const language of ['de','es','fr','ko','sv','zh']) assert.ok(frame.cells.some(c => c.language === language && c.g.trim()), language);
});
test('the complete Chinese title stays on one line at native size with both background borders intact', () => {
  const cases = [
    { columns: 130, rows: 35, asset: '程序已被终止.compact', w: 125, h: 12 },
    { columns: 160, rows: 45, asset: '程序已被终止', w: 154, h: 14 },
    { columns: 220, rows: 60, asset: '程序已被终止.large', w: 214, h: 18 },
    { columns: 240, rows: 64, asset: '程序已被终止.large', w: 214, h: 18 },
    { columns: 280, rows: 64, asset: '程序已被终止.xlarge', w: 250, h: 20 },
  ] as const;
  for (const size of cases) {
    const renderer = new Renderer(new Director(film)), before = renderer.frame(film.times.interrupt - 1, size, 'cn');
    const frame = renderer.frame(film.times.interrupt, size, 'cn'), panel = modalRect(size);
    const title = frame.regions.get('word-art.程序已被终止')!;
    assert.equal(panel.x, 1); assert.equal(panel.w, size.columns - 2);
    assert.ok(title.x >= panel.x + 1 && title.x + title.w <= panel.x + panel.w - 1);
    assert.equal(title.w, size.w); assert.equal(title.h, size.h);
    const expectedInk = glyphs[size.asset].bitmap.join('').split('#').length - 1;
    assert.equal(frame.cells.filter(cell => cell.semantic === 'word-art.程序已被终止').length, expectedInk, 'title strokes were clipped or resampled');
    assert.ok(!frame.regions.has('word-art.程序') && !frame.regions.has('word-art.已被终止'));
    for (let y = 0; y < size.rows; y++) for (const x of [0, size.columns - 1]) assert.deepEqual(frame.get(x, y), before.get(x, y));
    assert.deepEqual(frame.validate(), []);
  }
});
test('the simulation keeps the deletion target readable while its log declaration scrolls', () => {
  const r = new Renderer(new Director(film));
  assert.ok(film.times.counts[0] - film.times.deletionAnnouncement >= 3000);
  for (const t of [film.times.deletionAnnouncement + 1, film.times.counts[0] - 1000]) {
    const frame = r.frame(t, { columns: 130, rows: 35 }, 'cn').plain();
    assert.ok(frame.includes('正在删除系统')); assert.ok(frame.includes('整个模拟系统，包括我自己'));
    assert.ok(frame.includes('erase_system_root()')); assert.ok(frame.includes('simulated_system / [PROTECTED]'));
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
