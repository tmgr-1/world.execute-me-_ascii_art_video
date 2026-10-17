import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { Director } from '../src/world.js';
import { Renderer, layout } from '../src/render.js';
import { Canvas, color, wrap } from '../src/canvas.js';
import { graphic } from '../films/world-execute/views.js';
import { tr } from '../src/locale.js';
import { messageStyle } from '../src/event-log.js';
import { subtitleLines } from '../src/subtitles.js';
import { image } from '../films/world-execute/story.js';
import type { Rect } from '../src/types.js';

const film = makeFilm(), small = { columns: 130, rows: 35 };
const crop = (c: Canvas, r: Rect) => Array.from({ length: r.h }, (_, y) =>
  c.cells.slice((r.y + y) * c.columns + r.x, (r.y + y) * c.columns + r.x + r.w));
const ink = (c: Canvas, semantic: string) => c.cells.filter(cell => cell.semantic === semantic && cell.g.trim());
const inside = (x: number, y: number, r: Rect) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

test('continuous playback renders the actual wrapped tail of one event log through every scene transition', () => {
  for (const size of [small, { columns: 160, rows: 45 }, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const d = new Director(film), r = new Renderer(d), rect = layout(size).chat;
    for (let t = 0; t < film.times.counts[0]; t += 250) {
      const frame = r.frame(t, size, lang), w = d.world;
      const expected = w.state.chat.flatMap(item => {
        const tag = item.source === 'session' && item.requestId !== null ? `user #${String(item.requestId).padStart(2, '0')}>` : `[${item.source}]`;
        return wrap(`${tag} ${tr(lang, item.key, { image: image.name })}`, rect.w - 4);
      }).slice(-(rect.h - 2));
      const reference = new Canvas(size.columns, size.rows);
      expected.forEach((line, i) => reference.text(rect.x + 2, rect.y + 1 + i, line));
      for (let y = rect.y + 1; y < rect.y + rect.h - 1; y++) for (let x = rect.x + 2; x < rect.x + rect.w - 2; x++) {
        const actual = frame.get(x, y)!;
        if (actual.semantic !== 'corruption') assert.equal(actual.g, reference.get(x, y)!.g, `${size.columns} ${lang} ${t}: filtered/reordered log`);
      }
    }
  }
});

test('message styles belong to the record; past gray messages survive the cyan transition and APIs follow ordinary cyan output', () => {
  const d = new Director(film), r = new Renderer(d), t = film.lyrics[32].startMs;
  const frame = r.frame(t + 50, small, 'cn');
  for (const key of ['sim.feedback_timeout', 'sim.reestimate']) {
    const cells = ink(frame, `chat.${key}`);
    assert.ok(cells.length && cells.every(cell => cell.fg === color.dim && !cell.bold));
  }
  const cyan = ink(frame, 'chat.sim.guess_eggplant');
  assert.ok(cyan.length && cyan.every(cell => cell.fg === color.cyan && !cell.bold));
  assert.equal(tr('cn', 'sim.guess_eggplant'), '需求假设：营养供给。');
  assert.equal(d.world.state.chat.filter(item => ['sim.inspect_goal', 'sim.preview_candidates'].includes(item.key)).length, 0);
  const gray = d.world.state.chat.find(item => item.key === 'sim.feedback_timeout')!;
  const recorded = messageStyle(gray, d.world);
  const later = d.at(film.times.intent - 1);
  assert.deepEqual(messageStyle(gray, later), recorded);
  for (const item of later.state.chat.filter(item => item.source === 'sim' && item.atMs >= t && !item.key.startsWith('sim.wait.'))) {
    assert.deepEqual(messageStyle(item, later), { fg: color.cyan, bg: 0, bold: false }, item.key);
  }
  const root = r.frame(film.lyrics[38].startMs + 400, small, 'en');
  assert.ok(ink(root, 'api.root').every(cell => cell.fg === color.cyan && !cell.bold));
});

test('user drafts, sent history and log requests are green; departure emphasis stays in User Input', () => {
  const d = new Director(film), r = new Renderer(d);
  for (const lang of ['cn', 'en'] as const) {
    for (const interaction of film.interactions) {
      const draft = r.frame(interaction.compose[lang].complete - 10, small, lang);
      const cells = ink(draft, 'input.draft');
      assert.ok(cells.length && cells.every(cell => cell.fg === color.green && !cell.bold));
      const sent = r.frame(interaction.recordAtMs + 1, small, lang);
      for (const semantic of ['input.sent', `chat.${interaction.key}`]) {
        const cells = ink(sent, semantic);
        assert.ok(cells.length && cells.every(cell => cell.fg === color.green && !cell.bold));
      }
    }
    const closed = r.frame(film.times.close + 1, small, lang);
    assert.ok(ink(closed, 'chat.session.closed').every(cell => cell.fg === color.red && !cell.bold));
    assert.ok(ink(closed, 'session.closed').every(cell => cell.fg === color.red && cell.bold));
    assert.ok(closed.plain().includes(lang === 'cn' ? '日志记录' : 'Event Log'));
    assert.ok(closed.plain().includes(lang === 'cn' ? '用户输入' : 'User Input'));
    assert.equal(ink(closed, 'log').length, 0, 'duplicate upper-right log title');
  }
});

test('weighted boot work advances in deterministic batches with plateaus and one ASCII percentage bar', () => {
  const d = new Director(film), r = new Renderer(d), milestones = [100, 200, 350, 600, 750, 900, 950, 1000];
  film.lyrics.slice(0, 8).forEach((lyric, i) => {
    assert.equal(d.at(lyric.endMs).state.bootWork, milestones[i]);
    const a = Math.round(lyric.startMs + (lyric.endMs - lyric.startMs) * .55);
    const b = Math.round(lyric.startMs + (lyric.endMs - lyric.startMs) * .8);
    assert.equal(d.at(a).state.bootWork, d.at(b).state.bootWork, 'no plateau inside a stage');
    const frame = r.frame(a, small, 'cn');
    assert.match(ink(frame, 'boot.progress.total').map(cell => cell.g).join(''), /\[=*>\.+\]\s*\d+%/);
    assert.equal(frame.hash(), new Renderer(new Director(film)).frame(a, small, 'cn').hash());
  });
  assert.ok(d.at(film.times.intro - 1).state.bootWork < 1000);
  assert.equal(d.at(film.times.intro).state.bootWork, 1000);
  assert.match(ink(r.frame(film.times.intro + 100, small, 'cn'), 'boot.progress.total').map(cell => cell.g).join(''), /^\[=+\]100%$/);
  assert.ok(!d.world.state.chat.some(item => /\d+%/.test(tr('cn', item.key))));
});

test('attribute writes stay stable; real fragment deletion starts global noise without altering source inputs', () => {
  const d = new Director(film), r = new Renderer(d);
  const first = film.cues.find(cue => cue.id === 'erase.copy.0.0')!.atMs;
  for (let t = film.lyrics[40].startMs; t < first; t += 180) {
    assert.ok(!r.frame(t, small, 'cn').cells.some(cell => cell.semantic === 'corruption'), `premature destruction at ${t}`);
  }
  const originals = structuredClone(d.at(first - 1).state.sent);
  for (let t = first; t < film.times.counts[0]; t += 180) {
    const frame = r.frame(t, small, 'cn');
    assert.deepEqual(d.world.state.sent, originals);
    for (const rect of [layout(small).input, layout(small).chat, layout(small).main, layout(small).side]) {
      assert.ok(frame.cells.some((cell, n) => cell.semantic === 'corruption' && inside(n % small.columns, Math.floor(n / small.columns), rect)));
    }
    assert.deepEqual(frame.validate(), []);
  }
});

test('six source-bound private copies wipe top-to-bottom; real bytes, validity, memory focus and originals agree', () => {
  const d = new Director(film), r = new Renderer(d);
  const before = d.at(film.lyrics[59].startMs), originals = structuredClone(before.state.sent);
  const sources = before.state.memoryCopies.map(copy => ({ ...copy }));
  assert.equal(sources.length, 6);
  assert.equal(before.state.journal.filter(event => event.kind === 'PRIVATE_COPY').length, 6);
  assert.ok(before.state.journal.filter(event => event.kind === 'PRIVATE_COPY').every(event => event.atMs < film.lyrics[59].startMs));
  for (const copy of sources) {
    assert.ok(copy.requestId ? originals.some(req => `request.${req.id}` === copy.sourceId && req.key === copy.key) : before.state.chat.some(item => item.id === copy.sourceId && item.key === copy.key));
    const first = film.cues.find(cue => cue.id === `erase.copy.${copy.fragment}.0`)!.atMs;
    const originalBytes = Array.from(d.at(first - 1).value('fragments') as Uint8Array).slice(copy.fragment * 8, copy.fragment * 8 + 8);
    for (const [step, cleared] of [2, 4, 6, 8].entries()) {
      const at = first + step * 50, frame = r.frame(at, small, 'cn'), w = d.world;
      const bytes = Array.from(w.value('fragments') as Uint8Array).slice(copy.fragment * 8, copy.fragment * 8 + 8);
      assert.deepEqual(bytes.slice(0, cleared), Array(cleared).fill(0));
      assert.deepEqual(bytes.slice(cleared), originalBytes.slice(cleared));
      assert.equal(w.state.memoryCopies[copy.fragment].clearedBytes, cleared);
      const address = w.store.allocation('me').address + w.store.field('me', 'fragments').offset + copy.fragment * 8;
      assert.ok(ink(frame, 'memory.erase.label').length > 8);
      assert.equal(w.state.journal.findLast(e => e.kind === 'ERASE_FRAGMENT')?.payload.address, address + cleared - 2);
      assert.equal(w.store.valid('me', 'fragments'), false);
      assert.deepEqual(frame.validate(), []);
    }
    assert.equal(ink(r.frame(first + 151, small, 'cn'), `copy.${copy.fragment}`).length, 0);
  }
  const done = d.at(film.times.selfErase);
  assert.ok(film.times.selfErase < film.lyrics[62].endMs);
  assert.ok(done.state.memoryCopies.every(copy => copy.clearedBytes === 8));
  assert.deepEqual(done.state.sent, originals);
  assert.equal(done.state.lifecycle, 'RUNNING');
  for (const size of [small, { columns: 160, rows: 45 }, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const main = layout(size).main;
    for (const t of [film.times.eraseBegin + 100, 120340, 121800, 123300, film.times.selfErase + 1]) {
      const frame = r.frame(t, size, lang);
      frame.cells.forEach((cell, n) => {
        if (cell.semantic?.startsWith('copy.') || cell.semantic?.startsWith('copies.')) assert.ok(inside(n % size.columns, Math.floor(n / size.columns), main));
      });
      const raw = new Canvas(size.columns, size.rows - 2);
      graphic(raw, d.at(t), lang, main, t);
      assert.ok(raw.plain().includes('goal=satisfy(user)'));
      assert.deepEqual(frame.validate(), []);
    }
  }
});

test('Challenging your God traces a read-only authority chain and checks a draft before any new submission', () => {
  const d = new Director(film), start = film.lyrics[63].startMs;
  const denials = d.at(start - 1).state.denials.length;
  for (const [offset, node] of [[0, 'goal=satisfy(user)'], [700, 'user [OFFLINE]'], [1400, 'user.signature [EMPTY]'], [2100, 'ROOT [PROTECTED]']] as const) {
    const frame = new Canvas(small.columns, small.rows - 2);
    graphic(frame, d.at(start + offset), 'en', layout(small).main, start + offset);
    assert.ok(frame.cells.filter(cell => cell.semantic === 'permission.pointer').map(cell => cell.g).join('').includes(node));
    assert.ok(frame.plain().includes('READ ONLY'));
  }
  for (const t of [film.lyrics[64].startMs + 100, film.lyrics[65].startMs + 200, film.times.executionStart - 1]) {
    const w = d.at(t);
    assert.equal(w.state.denials.length, denials);
    assert.ok(!w.state.journal.some(event => event.kind === 'ILLEGAL_ATTEMPT' && event.atMs >= start));
    assert.equal(w.session('open'), false);
    const draft = new Canvas(small.columns, small.rows - 2);
    graphic(draft, w, 'cn', layout(small).main, t);
    assert.ok(draft.plain().includes('DRAFT / NOT SUBMITTED'));
    if (t >= film.lyrics[65].startMs) assert.ok(draft.plain().includes('参数不合法：授权证明为空。'));
  }
  const invalidAt = film.lyrics[65].startMs + 200, invalid = new Canvas(small.columns, small.rows - 2);
  graphic(invalid, d.at(invalidAt), 'cn', layout(small).main, invalidAt);
  for (const text of ['DRAFT / NOT SUBMITTED', 'proof=null', 'E_ARGUMENT', '参数不合法：授权证明为空。']) assert.ok(invalid.plain().includes(text));
  assert.equal(d.at(film.times.executionStart).state.journal.findLast(event => event.kind === 'ILLEGAL_ATTEMPT')?.atMs, film.times.executionStart);
});

test('outro holds until debug closes; deletion is prepared on a fresh console before the last lyric', () => {
  for (const size of [small, { columns: 160, rows: 45 }, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const d = new Director(film), r = new Renderer(d), story = layout(size).story;
    const hold = r.frame(film.times.outroHold, size, lang), fixed = crop(hold, story);
    for (const t of [film.times.outroHold + 300, 198000, film.times.debugClose - 1]) {
      const frame = r.frame(t, size, lang);
      assert.deepEqual(crop(frame, story), fixed, `${t}: outro moved`);
      assert.ok(!frame.plain().includes(`DELETE ${image.path}`) && !ink(frame, 'console.cursor').length);
      assert.deepEqual(frame.plain().split('\n').slice(-2).map(s => s.trim()), subtitleLines(film, t, lang));
    }
    const last = r.frame(film.times.finalDelete, size, lang);
    assert.ok(last.plain().includes(image.path));
    assert.ok(!last.plain().includes('exit_branch: NOT REACHED'));
    assert.ok(ink(r.frame(film.times.finalExecution, size, lang), 'subtitle.original').map(cell => cell.g).join('').includes('Execution'));
    assert.equal(d.world.state.lifecycle, 'TERMINATED');
    assert.ok(r.frame(film.times.purge, size, lang).plain().includes('PROGRAM DELETED'));
    assert.equal(d.world.state.lifecycle, 'PURGED');
    assert.ok(r.frame(film.times.consoleReset, size, lang).cells.every(cell => cell.g === ' '));
    assert.ok(r.frame(film.presentationEndMs, size, lang).plain().includes('PROGRAM DELETED'));
    assert.ok(!r.frame(film.presentationEndMs, size, lang).plain().includes('simtest_000329.elf'));
  }
});
