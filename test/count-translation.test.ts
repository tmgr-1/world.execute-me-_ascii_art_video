import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { countLanguages } from '../films/world-execute/story.js';
import { Canvas, color } from '../src/canvas.js';
import { Director } from '../src/world.js';
import { Renderer, layout } from '../src/render.js';
import { subtitleLines } from '../src/subtitles.js';
import { makeCountLayer, drawCountLayer } from '../films/world-execute/count-overlay.js';

const sizes = [{ columns: 130, rows: 35 }, { columns: 160, rows: 45 }, { columns: 220, rows: 60 }];
const text = (c: Canvas, semantic: string): string => c.cells.filter(cell => cell.semantic === semantic && !cell.continuation).map(cell => cell.g).join('');

test('each language introduces its real translations once, while later overwrites may break them', () => {
  const film = makeFilm(); film.corruption = [];
  const changes = [
    { semantic: 'plan.wait', phrase: 'Warte auf Antwort.' },
    { semantic: 'session.closed', phrase: 'Sesión cerrada' },
    { semantic: 'memory.erase.label', phrase: 'EFFACÉ' },
    { semantic: 'watch.value', phrase: '태스크 #16 [WAITING]' },
    { semantic: 'plan.target', phrase: 'Mål: hela det simulerade' },
  ];
  for (const size of sizes) for (const lang of ['cn', 'en'] as const) {
    const director = new Director(film), renderer = new Renderer(director);
    for (let step = 0; step < 6; step++) {
      const atMs = film.times.counts[step], before = renderer.frame(atMs - 1, size, lang);
      if (step < 5) assert.ok(!text(before, changes[step].semantic).includes(changes[step].phrase), `premature translation at ${step + 1}`);
      const frame = renderer.frame(atMs, size, lang);
      if (step < 5) assert.ok(text(frame, changes[step].semantic).includes(changes[step].phrase), `${size.columns} ${lang} missing current translation at ${step + 1}`);
      for (const language of countLanguages.slice(0, step + 1)) assert.ok(frame.cells.some(cell => cell.language === language && cell.g.trim()));
      if (step === 1) {
        assert.ok(text(frame, 'input.sent').includes('#09 Enviado  Haz coincidir las dos trayectorias.'));
        assert.ok(frame.cells.filter(cell => cell.semantic === 'input.sent').every(cell => cell.fg === color.green));
      }
      if (step === 2) {
        assert.ok(text(frame, 'watch.value').includes(`révision=${director.world.value('revision')}`));
        assert.ok(text(frame, 'memory.erase.range').includes('objets=5/5'));
      }
      if (step === 3) {
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

test('each fixed 20% layer only writes its own language and may overwrite previous layers across panes', () => {
  const film = makeFilm();
  for (const size of sizes) for (const seed of [film.defaultSeed, 173]) {
    const story = layout(size).story, source = new Canvas(size.columns, story.h);
    // A mixed-width base also exercises replacement at both halves of a glyph.
    for (let y = 0; y < story.h; y++) source.text(0, y, '中네ABC '.repeat(size.columns), {}, size.columns, 'original');
    const budget = Math.floor(source.cells.length * .20), composite = source.clone();
    const touched = new Set<number>(); let crossed = false, overlapped = false;
    for (let step = 0; step < 6; step++) {
      const layer = makeCountLayer(source, seed, step + 1), mask = new Set<number>(), before = composite.clone();
      assert.equal(layer.writtenCells, budget); assert.equal(layer.language, countLanguages[step]);
      assert.deepEqual(layer, makeCountLayer(source, seed, step + 1));
      for (const write of layer.writes) {
        crossed ||= write.x < layout(size).side.x && write.x + write.columns > layout(size).side.x;
        for (let x = write.x; x < write.x + write.columns; x++) {
          const index = write.y * size.columns + x;
          assert.ok(!mask.has(index), 'one write double-counted an address'); mask.add(index);
          overlapped ||= touched.has(index); touched.add(index);
        }
      }
      assert.equal(mask.size, budget);
      // Cutting either half of an underlying wide glyph also clears its mate.
      const affected = new Set(mask);
      for (const index of mask) {
        if (before.cells[index].continuation) affected.add(index - 1);
        else if (before.cells[index].width === 2) affected.add(index + 1);
      }
      drawCountLayer(composite, layer);
      composite.cells.forEach((cell, index) => {
        if (!affected.has(index)) assert.deepEqual(cell, before.cells[index], `${layer.language} changed a previous language outside its write`);
        if (mask.has(index)) assert.equal(cell.language, layer.language);
      });
      assert.deepEqual(composite.validate(), []);
    }
    assert.ok(crossed, 'text streams were constrained to pane interiors'); assert.ok(overlapped, 'languages avoided previously used addresses');
    for (const rect of [layout(size).chat, layout(size).input, layout(size).main, layout(size).side]) {
      assert.ok([...touched].some(i => i % size.columns >= rect.x && i % size.columns < rect.x + rect.w && Math.floor(i / size.columns) >= rect.y && Math.floor(i / size.columns) < rect.y + rect.h));
    }
    const r = new Renderer(new Director(film, seed)), atMs = film.times.counts[5] + 100;
    const expected = r.frame(atMs, size, 'cn').hash(); r.frame(film.times.holdEnd + 1, size, 'cn');
    assert.equal(r.frame(atMs, size, 'cn').hash(), expected);
  }
});
