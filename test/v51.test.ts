import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { countLanguages } from '../films/world-execute/story.js';
import { drawCountLayer, makeCountLayer } from '../films/world-execute/count-overlay.js';
import { Canvas, color, width } from '../src/canvas.js';
import { corrupt } from '../src/corruption.js';
import { tr } from '../src/locale.js';
import { Director } from '../src/world.js';
import { Renderer, layout } from '../src/render.js';
import { subtitleLines } from '../src/subtitles.js';
import type { Rect } from '../src/types.js';

const film = makeFilm(), sizes = [{ columns: 130, rows: 35 }, { columns: 160, rows: 45 }, { columns: 220, rows: 60 }];
const rectText = (c: Canvas, r: Rect): string => c.cells.slice(r.y * c.columns + r.x, r.y * c.columns + r.x + r.w).filter(cell => !cell.continuation).map(cell => cell.g).join('');

test('only the current logged warning is forced clear at +60 ms; the next count removes its foreground status', () => {
  for (const size of sizes) for (const lang of ['cn', 'en'] as const) {
    const r = new Renderer(new Director(film)), chat = layout(size).chat;
    for (let step = 0; step < 6; step++) {
      const at = film.times.counts[step];
      for (const dt of [0, 59]) assert.ok(!r.frame(at + dt, size, lang).regions.has('guard.warning'));
      for (const dt of [60, 150]) {
        const frame = r.frame(at + dt, size, lang), warning = frame.regions.get('guard.warning')!;
        const expected = `[guard] ${tr(lang, 'guard.continuous')}`;
        assert.ok(warning); assert.equal(rectText(frame, warning), expected);
        assert.equal(warning.w, width(expected)); assert.equal(warning.x, chat.x + 2);
        assert.equal(warning.y, chat.y + chat.h - 2);
        for (let x = warning.x; x < warning.x + warning.w; x++) {
          const cell = frame.get(x, warning.y)!;
          assert.equal(cell.fg, color.red); assert.equal(cell.bg, color.bg); assert.equal(cell.bold, true);
          assert.equal(cell.semantic, 'chat.guard.continuous');
        }
        assert.equal(r.director.world.state.chat.filter(item => item.key === 'guard.continuous').length, step + 2);
        assert.ok(![...frame.regions.keys()].some(key => key.includes('.protected')));
        assert.deepEqual(frame.plain().split('\n').slice(-2).map(line => line.trim()), subtitleLines(film, at + dt, lang));
        assert.deepEqual(frame.validate(), []);
      }
    }
    const submitted = r.frame(film.times.intent + 1, size, lang), warning = submitted.regions.get('guard.warning')!;
    assert.equal(rectText(submitted, warning), `[guard] ${tr(lang, 'guard.continuous')}`);
    assert.equal(warning.y, chat.y + chat.h - 4, 'warning did not scroll above the real system call and denial');
    assert.equal(r.director.world.state.chat.filter(item => item.key === 'attempt.system-execute').length, 1);
  }
});

test('the Korean beat adds no old-language text or relocated translations, even when entered by a reverse seek', () => {
  const quiet = makeFilm(); quiet.corruption = [];
  for (const size of sizes) for (const lang of ['cn', 'en'] as const) {
    const r = new Renderer(new Director(quiet)), t = quiet.times.counts[3];
    const before = r.frame(t - 1, size, lang), after = r.frame(t + 60, size, lang);
    const old = new Set<string>(countLanguages.slice(0, 3));
    const foreground = [before, after].flatMap(c => ['word-art', 'guard.warning'].flatMap(key => c.regions.has(key) ? [c.regions.get(key)!] : []));
    let checked = 0;
    after.cells.forEach((cell, index) => {
      if (!cell.language || !old.has(cell.language)) return;
      const x = index % size.columns, y = Math.floor(index / size.columns);
      if (foreground.some(r => x >= r.x - 1 && x <= r.x + r.w && y >= r.y && y < r.y + r.h)) return;
      assert.deepEqual(cell, before.cells[index], 'Korean beat refilled or moved an older language'); checked++;
    });
    assert.ok(checked > 400);
    for (const language of old) {
      const regions = (c: Canvas) => [...c.regions].filter(([key]) => key.startsWith(`count.layer.${language}.`));
      assert.deepEqual(regions(after), regions(before));
    }
    const expected = after.hash(); r.frame(quiet.times.holdEnd + 1, size, lang);
    assert.equal(r.frame(t + 60, size, lang).hash(), expected);
    assert.equal(new Renderer(new Director(quiet)).frame(t + 60, size, lang).hash(), expected);
  }
});

test('12% resampled noise stays above the fixed language layers and does not consume their write budgets', () => {
  for (const size of sizes) {
    const source = new Canvas(size.columns, layout(size).story.h), writes = Math.floor(source.cells.length * .20);
    const composite = source.clone();
    for (let step = 1; step <= 6; step++) {
      const layer = makeCountLayer(source, film.defaultSeed, step);
      assert.equal(layer.writtenCells, writes); drawCountLayer(composite, layer);
    }
    const baseline = composite.hash(), a = composite.clone(), b = composite.clone(), t = film.times.counts[5];
    corrupt(a, film, film.defaultSeed, t, 6); corrupt(b, film, film.defaultSeed, t + 90, 6);
    const budget = Math.floor(source.cells.length * .12);
    for (const c of [a, b]) {
      const actual = c.cells.filter(cell => cell.semantic === 'corruption').length;
      assert.ok(actual >= budget - 1 && actual <= budget);
      assert.ok(c.cells.some((cell, i) => cell.semantic === 'corruption' && countLanguages.includes(composite.cells[i].language as typeof countLanguages[number])));
      assert.deepEqual(c.validate(), []);
      assert.deepEqual([...c.regions], [...composite.regions], 'noise regenerated language layouts');
    }
    assert.ok(a.cells.some((cell, i) => cell.semantic === 'corruption' && b.cells[i].semantic !== 'corruption'));
    assert.equal(composite.hash(), baseline);
  }
});
