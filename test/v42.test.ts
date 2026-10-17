import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { Director } from '../src/world.js';
import { Renderer, layout } from '../src/render.js';
import { MediaClock } from '../src/audio.js';
import { PlaybackClock } from '../src/playback-clock.js';
import { color, type Canvas } from '../src/canvas.js';
import { tr } from '../src/locale.js';

const film = makeFilm(), size = { columns: 130, rows: 35 };
const text = (c: Canvas, semantic: string) => c.cells.filter(cell => cell.semantic === semantic).map(cell => cell.g).join('');

test('the greeting is one second later; only display recording waits 300 ms, while lyric-bound requests keep their times', () => {
  const d = new Director(film), r = new Renderer(d), hello = film.interactions[0];
  assert.equal(hello.send, 18780); assert.equal(hello.response, 19480);
  assert.deepEqual(film.interactions.slice(1).map(i => i.send), [29770, 33440, 36960, 40780, 44340, 47780, 51480, 55260]);
  for (const lang of ['cn', 'en'] as const) for (const i of film.interactions) {
    assert.equal(i.recordAtMs, i.send + 300);
    assert.ok(!d.at(i.send - 1).state.sent.some(request => request.interactionId === i.id));
    for (const offset of [0, 100, 299]) {
      const frame = r.frame(i.send + offset, size, lang);
      assert.ok(text(frame, 'input.draft').includes(`user > ${tr(lang, i.key)}`));
      assert.ok(!text(frame, 'input.sent').includes(tr(lang, i.key)), 'pending input appeared in history twice');
      assert.ok(d.world.state.sent.some(request => request.interactionId === i.id));
      assert.equal(d.world.state.journal.filter(e => e.kind === 'rx' && e.payload.interactionId === i.id).length, 1);
    }
    const recorded = r.frame(i.recordAtMs, size, lang);
    assert.ok(text(recorded, 'input.sent').includes(tr(lang, i.key)));
    assert.ok(text(recorded, 'input.prompt').includes('user >'));
  }
});

test('the connected input always has a prompt and a deterministic ASCII cursor, including idle periods', () => {
  const r = new Renderer(new Director(film)), opened = film.cues.find(cue => cue.id === 'intro.open')!.atMs;
  for (let t = opened; t < film.times.close; t += 173) {
    const frame = r.frame(t, size, 'cn'), body = text(frame, 'input.draft') + text(frame, 'input.prompt');
    assert.ok(body.includes('user >'), `missing prompt at ${t}`);
    const cells = frame.cells.filter(cell => cell.semantic === 'input.cursor');
    assert.equal(cells.length, 1);
    assert.equal(cells[0].g, Math.floor((t - opened) / 400) % 2 === 0 ? '_' : ' ');
    assert.equal(cells[0].fg, color.green);
  }
  assert.ok(!r.frame(opened - 1, size, 'cn').cells.some(cell => cell.semantic === 'input.cursor'));
  assert.ok(!r.frame(film.times.close, size, 'cn').cells.some(cell => cell.semantic === 'input.cursor'));
  assert.equal(r.frame(opened + 450, size, 'cn').hash(), r.frame(opened + 450, size, 'cn').hash());
});

test('API calls share the cyan style of ordinary sim output in both logs and graphics', () => {
  const d = new Director(film), r = new Renderer(d);
  for (const cue of film.cues.filter(cue => cue.command.kind === 'ATTEMPT')) {
    const frame = r.frame(cue.atMs + 1, size, 'cn');
    const calls = frame.cells.filter(cell => cell.semantic?.startsWith('chat.attempt.') && cell.g.trim());
    assert.ok(calls.length && calls.every(cell => cell.fg === color.cyan && !cell.bold));
    const main = frame.cells.filter(cell => cell.semantic?.startsWith('api.') && cell.g.trim());
    assert.ok(main.length && main.every(cell => cell.fg === color.cyan && !cell.bold));
  }
});

test('timeout and re-estimation are separated once; the final vocal leaves a 750 ms alternative-search pause', () => {
  const d = new Director(film), r = new Renderer(d);
  const timeout = d.at(film.times.reestimate).state.chat.find(item => item.key === 'sim.feedback_timeout')!;
  const estimating = d.world.state.chat.find(item => item.key === 'sim.reestimate')!;
  assert.equal(timeout.atMs, 65470); assert.equal(estimating.atMs, 69610);
  assert.equal(tr('cn', timeout.key), '反馈已超时。');
  assert.equal(tr('cn', estimating.key), '正在重新估算需求。');
  assert.equal(film.times.eraseBegin - film.lyrics[58].endMs, 750);
  const waiting = r.frame(film.times.eraseBegin - 1, size, 'cn');
  assert.ok(text(waiting, 'absence.search').includes('检索其他解决方案'));
  assert.ok(!d.world.state.chat.some(item => item.key === 'sim.erase_self'));
  assert.ok(!d.world.state.journal.some(event => event.kind === 'ERASE_FRAGMENT'));
  assert.ok(r.frame(film.times.eraseBegin, size, 'cn').plain().includes('删除自身数据。'));
  assert.equal(d.at(120240).state.journal.find(event => event.kind === 'ERASE_FRAGMENT')?.atMs, 120240);
});

test('the final host closes debug, clears, prepares deletion, holds DELETED and leaves one blank row before test 329', () => {
  for (const dimensions of [size, { columns: 160, rows: 45 }, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const d = new Director(film), r = new Renderer(d);
    assert.ok(r.frame(film.times.debugClose, dimensions, lang).plain().includes(tr(lang, 'host.close_debug', { image: 'simtest_000328.elf' })));
    assert.ok(r.frame(film.times.consoleReset - 1, dimensions, lang).plain().includes('DEBUG SESSION CLOSED'));
    assert.ok(r.frame(film.times.consoleReset + 1, dimensions, lang).cells.every(cell => cell.g === ' '));
    const pending = r.frame(film.times.finalDelete, dimensions, lang).plain();
    assert.ok(pending.includes('/opt/sim/tests/simtest_000328.elf'));
    assert.ok(!pending.includes('PROGRAM DELETED') && !pending.includes('saved_pc'));
    const deleted = r.frame(film.times.purge, dimensions, lang), storyCells = layout(dimensions).story.h * dimensions.columns;
    assert.ok(deleted.plain().includes('PROGRAM DELETED'));
    assert.ok(film.times.purge - film.times.finalExecution <= 200);
    for (const t of [film.durationMs, film.times.easterEgg - 1]) {
      const hold = r.frame(t, dimensions, lang);
      assert.deepEqual(hold.cells.slice(0, storyCells), deleted.cells.slice(0, storyCells));
      assert.ok(!hold.plain().includes('000329'));
    }
    assert.equal(film.times.easterEgg - film.times.purge, 8000);
    const final = r.frame(film.times.easterEgg, dimensions, lang), rows = final.plain().split('\n');
    const deleteRow = rows.findIndex(row => row.includes('PROGRAM DELETED'));
    const nextRow = rows.findIndex(row => row.includes('simtest_000329.elf'));
    assert.equal(nextRow - deleteRow, 2); assert.equal(rows[nextRow - 1].trim(), '');
    const snapshot = structuredClone(d.world.state.archive);
    d.at(0); const w = d.at(film.presentationEndMs);
    assert.equal(w.state.host.filter(record => record.key === 'host.next_test').length, 1);
    assert.equal(w.state.lifecycle, 'PURGED'); assert.equal(w.value('status'), 'TERMINATED');
    assert.equal(w.state.sent.length, 9); assert.deepEqual(w.state.archive, snapshot);
    assert.ok(!w.state.journal.some(e => e.atMs > film.durationMs && e.source !== 'host'));
    assert.deepEqual(final.validate(), []);
  }
});

test('the post-EOF clock continues silently, freezes for pause, respects speed and returns to the media epoch', () => {
  let now = 1000;
  const media = new MediaClock(), p = new PlaybackClock(media, () => now);
  media.update({ mediaTimeMs: 211900, monotonicMs: now, paused: false, speed: 1, epoch: 1 });
  now += 44; assert.equal(p.read(), 211944);
  p.startTail(211944, 1, false); now += 500; assert.equal(p.read(), 212444);
  p.pauseTail(true, 1); now += 9000; assert.equal(p.read(), 212444);
  p.pauseTail(false, 2); now += 1000; assert.equal(p.read(), 214444);
  media.update({ mediaTimeMs: 190000, monotonicMs: now, paused: true, speed: 2, epoch: 2 });
  p.useMedia(); assert.equal(p.read(), 190000); assert.equal(p.inTail, false);
});
