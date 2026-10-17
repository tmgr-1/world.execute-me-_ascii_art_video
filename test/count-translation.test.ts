import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { countLanguages } from '../films/world-execute/story.js';
import { Canvas, color } from '../src/canvas.js';
import { corrupt } from '../src/corruption.js';
import { Director } from '../src/world.js';
import { Renderer, layout } from '../src/render.js';
import { subtitleLines } from '../src/subtitles.js';

const sizes = [{ columns: 130, rows: 35 }, { columns: 160, rows: 45 }, { columns: 220, rows: 60 }];
const text = (c: Canvas, semantic: string): string => c.cells.filter(cell => cell.semantic === semantic && !cell.continuation).map(cell => cell.g).join('');

test('counts translate real semantic regions cumulatively even with all random noise disabled', () => {
  const film = makeFilm(); film.corruption = [];
  const changes = [
    { semantic: 'plan.wait', phrase: 'Warte auf Antwort.' },
    { semantic: 'session.closed', phrase: 'Sesión cerrada' },
    { semantic: 'memory.erase.label', phrase: 'EFFACÉ' },
    { semantic: 'watch.value', phrase: '태스크 #16 [WAITING]' },
    { semantic: 'plan.target', phrase: 'Mål: hela det simulerade systemet' },
    { semantic: 'plan.tree.system', phrase: '整个模拟系统 / [受保护]' },
  ];
  for (const size of sizes) for (const lang of ['cn', 'en'] as const) {
    const director = new Director(film), renderer = new Renderer(director);
    for (let step = 0; step < 6; step++) {
      const atMs = film.times.counts[step], before = renderer.frame(atMs - 1, size, lang);
      assert.ok(!text(before, changes[step].semantic).includes(changes[step].phrase), `premature translation at ${step + 1}`);
      const frame = renderer.frame(atMs, size, lang);
      for (let old = 0; old <= step; old++) {
        assert.ok(text(frame, changes[old].semantic).includes(changes[old].phrase), `${size.columns} ${lang} lost meaningful ${countLanguages[old]} translation at ${step + 1}`);
        assert.ok(frame.cells.some(cell => cell.semantic === changes[old].semantic && cell.language === countLanguages[old]));
      }
      if (step >= 1) {
        assert.ok(text(frame, 'input.sent').includes('#09 Enviado  Haz coincidir las dos trayectorias.'));
        assert.ok(frame.cells.filter(cell => cell.semantic === 'input.sent').every(cell => cell.fg === color.green));
      }
      if (step >= 2) {
        assert.ok(text(frame, 'watch.value').includes(`révision=${director.world.value('revision')}`));
        assert.ok(text(frame, 'memory.erase.range').includes('objets=5/5'));
      }
      if (step >= 3) {
        const task = director.world.state.tasks.at(-1)!;
        assert.ok(text(frame, 'watch.value').includes(`${task.frames.at(-1)!.program} PC=${task.pc} 깊이=${task.frames.length}`));
      }
      assert.ok(!frame.cells.some(cell => cell.semantic === 'corruption'), 'semantic translation was incorrectly implemented as noise');
      assert.deepEqual(frame.validate(), []);
      assert.deepEqual(frame.plain().split('\n').slice(-2).map(line => line.trim()), subtitleLines(film, atMs, lang));
    }
    const w = director.at(film.times.counts[5]), bytes = Buffer.from(w.store.bytes), journal = JSON.stringify(w.state.journal);
    renderer.normal(w, w.state.timeMs, size, lang);
    assert.ok(Buffer.from(w.store.bytes).equals(bytes)); assert.equal(JSON.stringify(w.state.journal), journal);
    assert.equal(w.session('open'), false); assert.equal(w.state.sent.length, 9);
  }
});

test('each count adds multilingual spill within the same 12% budget, crossing panes and resampling addresses', () => {
  const film = makeFilm();
  for (const size of sizes) for (const seed of [film.defaultSeed, 173]) {
    const story = layout(size).story, source = new Canvas(size.columns, story.h);
    // A mixed-width base also exercises replacement at both halves of a glyph.
    for (let y = 0; y < story.h; y++) source.text(0, y, '中네ABC '.repeat(size.columns), {}, size.columns, 'original');
    const budget = Math.floor(source.cells.length * .12);
    let previousSpill = 0;
    for (let step = 0; step < 6; step++) {
      const atMs = film.times.counts[step] + 100, c = source.clone();
      corrupt(c, film, seed, atMs, step + 1);
      const streams = [...c.regions].filter(([name]) => name.startsWith('spill.'));
      const spill = streams.reduce((n, [, r]) => n + r.w, 0);
      assert.ok(spill > previousSpill, `spill did not grow at ${step + 1}`); previousSpill = spill;
      for (const lang of countLanguages.slice(0, step + 1)) assert.ok(streams.some(([name]) => name.startsWith(`spill.${lang}.`)));
      assert.equal(c.cells.filter(cell => cell.semantic === 'corruption').length, budget);
      assert.deepEqual(c.validate(), []);
      const repeated = source.clone(); corrupt(repeated, film, seed, atMs, step + 1);
      assert.equal(c.hash(), repeated.hash());
    }
    const touched = new Set<number>(); let crossed = false;
    for (let tick = 0; tick < 8; tick++) {
      const c = source.clone(); corrupt(c, film, seed, film.times.counts[5] + tick * 90, 6);
      for (const [name, r] of c.regions) if (name.startsWith('spill.')) {
        crossed ||= r.x < layout(size).side.x && r.x + r.w > layout(size).side.x;
        for (let x = r.x; x < r.x + r.w; x++) touched.add(r.y * size.columns + x);
      }
    }
    assert.ok(crossed, 'text streams were constrained to pane interiors');
    for (const rect of [layout(size).chat, layout(size).input, layout(size).main, layout(size).side]) {
      assert.ok([...touched].some(i => i % size.columns >= rect.x && i % size.columns < rect.x + rect.w && Math.floor(i / size.columns) >= rect.y && Math.floor(i / size.columns) < rect.y + rect.h));
    }
    const r = new Renderer(new Director(film, seed)), atMs = film.times.counts[5] + 100;
    const expected = r.frame(atMs, size, 'cn').hash(); r.frame(film.times.holdEnd + 1, size, 'cn');
    assert.equal(r.frame(atMs, size, 'cn').hash(), expected);
  }
});
