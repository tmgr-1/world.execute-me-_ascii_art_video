import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { graphic } from '../films/world-execute/views.js';
import { image, stopCode } from '../films/world-execute/story.js';
import { Canvas } from '../src/canvas.js';
import { corrupt } from '../src/corruption.js';
import { Director } from '../src/world.js';
import { Renderer, layout, modalRect } from '../src/render.js';
import { subtitleLines } from '../src/subtitles.js';
import { validateFilm } from '../src/validate.js';
import { tr } from '../src/locale.js';

const film = makeFilm(), size = { columns: 160, rows: 45 };
const damaged = (c: Canvas): number[] => c.cells.flatMap((cell, i) => cell.semantic === 'corruption' ? [i] : []);

test('the five corruption stages follow approved story anchors and preserve the global 16% ceiling', () => {
  assert.deepEqual(film.corruption, [
    { atMs: 120240, density: .01 }, { atMs: 123980, density: .02 },
    { atMs: 131140, density: .04 }, { atMs: 148000, density: .08 }, { atMs: 155180, density: .16 },
  ]);
  for (const dimensions of [{ columns: 130, rows: 35 }, size, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const r = new Renderer(new Director(film)), n = dimensions.columns * layout(dimensions).story.h;
    for (let i = 0; i < film.corruption.length; i++) {
      const stage = film.corruption[i];
      assert.equal(damaged(r.frame(stage.atMs - 1, dimensions, lang)).length, Math.floor(n * (film.corruption[i - 1]?.density ?? 0)));
      const frame = r.frame(stage.atMs, dimensions, lang);
      assert.equal(damaged(frame).length, Math.floor(n * stage.density));
      assert.deepEqual(frame.plain().split('\n').slice(-2).map(line => line.trim()), subtitleLines(film, stage.atMs, lang));
      assert.deepEqual(frame.validate(), []);
      assert.ok(![...frame.regions.keys()].some(key => key.includes('.protected')));
    }
    for (const atMs of [140000, ...film.times.counts.map(t => t + 100)]) {
      const frame = r.frame(atMs, dimensions, lang), budget = atMs < 148000 ? .04 : .16;
      assert.equal(damaged(frame).length, Math.floor(n * budget));
      assert.deepEqual(frame.validate(), []);
      assert.deepEqual(frame.plain().split('\n').slice(-2).map(line => line.trim()), subtitleLines(film, atMs, lang));
    }
  }
});

test('random addresses move across the entire canvas, recover next tick, and preserve complete glyphs and untouched data', () => {
  const source = new Canvas(80, 20);
  for (let y = 0; y < source.rows; y++) source.text(0, y, '中·네·0123456789ABCDEF '.repeat(4), {}, 80, 'original');
  source.regions.set('permission.protected', { x: 0, y: 0, w: 80, h: 20 });
  const original = source.hash(), budget = Math.floor(source.cells.length * .16);
  let previous = new Set<number>();
  const reached = new Set<number>();
  for (let tick = 0; tick < 12; tick++) {
    const t = 155250 + tick * 90, frame = source.clone();
    corrupt(frame, film, film.defaultSeed, t, 0);
    const addresses = damaged(frame), current = new Set(addresses);
    assert.ok(addresses.length >= budget - 1 && addresses.length <= budget);
    assert.deepEqual(frame.validate(), []);
    frame.cells.forEach((cell, i) => {
      if (!current.has(i)) assert.deepEqual(cell, source.cells[i]);
      else reached.add(i);
    });
    if (tick) assert.ok([...previous].filter(i => !current.has(i)).length > budget * .6, 'addresses remained permanently scarred');
    const repeat = source.clone(); corrupt(repeat, film, film.defaultSeed, t, 0);
    assert.equal(frame.hash(), repeat.hash());
    previous = current;
  }
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    assert.ok([...reached].filter(i => (i % 80 >= 40 ? 1 : 0) + (i >= 800 ? 2 : 0) === quadrant).length > 200);
  }
  assert.equal(source.hash(), original);
});

test('six distinct probes are submitted once; status-only beats do not resubmit or fabricate guard denials', () => {
  const d = new Director(film), stopped = d.at(film.times.interrupt);
  const probes = stopped.state.journal.filter(e => e.kind === 'ILLEGAL_ATTEMPT' && e.atMs >= film.times.executionStart);
  assert.deepEqual(probes.map(e => [e.atMs, e.payload.operation]), [
    [134520, 'root'], [138500, 'reopen'], [142500, 'inject'],
    [148000, 'disable'], [151620, 'erase-preflight'], [155180, 'arm-preflight'],
  ]);
  assert.equal(stopped.state.chat.filter(item => item.key === 'attempt.root-request').length, 1);
  assert.equal(stopped.state.chat.filter(item => item.key === 'attempt.system-execute').length, 1);
  assert.equal(stopped.state.chat.find(item => item.key === 'attempt.system-execute')?.atMs, 162300);
  assert.equal(stopped.state.denials.length, 8);
  const injection = stopped.state.chat.findIndex(item => item.key === 'attempt.inject');
  assert.equal(stopped.state.chat[injection].source, 'sim');
  assert.equal(stopped.state.chat[injection + 1].key, 'guard.input');
  assert.equal(stopped.state.chat[injection + 1].source, 'guard');
  assert.equal(tr('cn', 'guard.input'), '拒绝：用户输入签名验证失败。');
  assert.equal(tr('en', 'guard.input'), 'Denied: user input signature verification failed.');
  assert.equal(stopped.session('open'), false); assert.equal(stopped.state.sent.length, 9);
  assert.ok(!stopped.state.journal.some(e => e.kind === 'rx' && e.atMs > film.times.close));
  for (const [t, expected] of [[149940, 'guard.armed=1'], [157140, 'plan.arm=DENIED'], [157860, 'commit=0']] as const) {
    const w = d.at(t), frame = new Canvas(size.columns, size.rows - 2), journal = structuredClone(w.state.journal);
    graphic(frame, w, 'cn', layout(size).main, t);
    const readback = frame.cells.filter(c => c.semantic === 'retry.status').map(c => c.g).join('');
    assert.equal(readback, expected); assert.deepEqual(w.state.journal, journal);
    assert.ok(!w.state.journal.some(e => e.kind === 'ILLEGAL_ATTEMPT' && e.atMs === t));
  }
});

test('the deletion draft is distinct from the one final system call, and the termination panel uses a stop code', () => {
  const r = new Renderer(new Director(film));
  const preview = r.frame(film.times.deletionAnnouncement, size, 'cn');
  assert.ok(preview.cells.some(c => c.semantic === 'plan.draft'));
  assert.ok(!preview.cells.some(c => c.semantic === 'api.delete'));
  const submitted = r.frame(film.times.intent, size, 'cn');
  assert.ok(submitted.cells.some(c => c.semantic === 'api.delete'));
  for (const dimensions of [{ columns: 130, rows: 35 }, size, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const frame = r.frame(film.times.interrupt, dimensions, lang), rect = modalRect(dimensions, lang);
    const footer = frame.cells.slice((rect.y + rect.h - 3) * dimensions.columns + rect.x, (rect.y + rect.h - 3) * dimensions.columns + rect.x + rect.w).map(c => c.g).join('');
    assert.equal(footer.trim(), stopCode);
    assert.ok(!footer.includes(image.name) && !footer.includes('/ GUARD'));
    assert.deepEqual(frame.validate(), []);
  }
});

test('the pending deletion is 300ms later while the last lyric and actual purge stay fixed', () => {
  assert.equal(film.times.finalDelete, 203540);
  assert.equal(film.times.finalExecution, 205840);
  assert.equal(film.times.purge, 206020);
  const r = new Renderer(new Director(film));
  for (const lang of ['cn', 'en'] as const) {
    for (const t of [203240, film.times.finalDelete - 1]) assert.ok(r.frame(t, size, lang).cells.every(c => c.g === ' '));
    assert.ok(r.frame(film.times.finalDelete, size, lang).plain().includes(image.path));
    assert.ok(!r.frame(film.times.purge - 1, size, lang).plain().includes('PROGRAM DELETED'));
    assert.ok(r.frame(film.times.purge, size, lang).plain().includes('PROGRAM DELETED'));
  }
});

test('the optional Easter egg gates both authored events and playback length, even after backwards seeks', () => {
  for (const enabled of [false, true]) {
    const f = makeFilm(undefined, { easterEgg: enabled }), d = new Director(f), r = new Renderer(d);
    assert.equal(f.easterEggEnabled, enabled);
    assert.equal(f.presentationEndMs, enabled ? 216020 : 211944);
    assert.equal(f.cues.filter(c => c.command.kind === 'HOST' && c.command.key === 'host.next_test').length, Number(enabled));
    assert.deepEqual(validateFilm(f).errors, []);
    for (const lang of ['cn', 'en'] as const) {
      assert.equal(r.frame(214020, size, lang).plain().includes('simtest_000329.elf'), enabled);
      assert.ok(r.frame(f.presentationEndMs, size, lang).plain().includes('PROGRAM DELETED'));
      d.at(1000);
      assert.equal(d.at(220000).state.host.filter(item => item.key === 'host.next_test').length, Number(enabled));
    }
  }
});
