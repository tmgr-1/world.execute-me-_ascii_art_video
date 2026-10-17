import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { debugFacts, debuggerLayout, debuggerView, debugView } from '../films/world-execute/debugger.js';
import { drawErasureMemory, erasureMemory } from '../films/world-execute/erasure-view.js';
import { image } from '../films/world-execute/story.js';
import { Canvas, color } from '../src/canvas.js';
import { tr } from '../src/locale.js';
import { Renderer, layout } from '../src/render.js';
import { subtitleLines } from '../src/subtitles.js';
import { Director } from '../src/world.js';

const film = makeFilm(), small = { columns: 130, rows: 35 }, size = { columns: 160, rows: 45 };
const text = (c: Canvas, semantic: string) => c.cells.filter(cell => cell.semantic === semantic && !cell.continuation).map(cell => cell.g).join('');
const rawMemory = (d: Director, t: number) => {
  const w = d.at(t), r = layout(small).side, c = new Canvas(small.columns, small.rows - 2);
  drawErasureMemory(c, w, 'cn', { ...r, h: 7 }, t); return c;
};

test('erasure audits capture real before/after bytes, object and string ranges, and survive checkpoint rebuilds', () => {
  const d = new Director(film), before = d.at(film.times.selfErase - 1);
  const originalRequests = structuredClone(before.state.sent), goal = before.value('goal');
  const cat = before.store.allocation('me.cat'), start = cat.address - before.store.base;
  const catBytes = [...before.store.bytes.subarray(start, start + cat.size)];
  const w = d.at(film.times.selfErase), audit = structuredClone(w.store.erasures);
  assert.ok(audit.length > 24 && audit.length < 64);
  assert.deepEqual(audit.map(a => a.id), audit.map((_, i) => i + 1));
  assert.ok(audit.every(a => a.beforeBytes.length === a.size && a.afterBytes.length === a.size && a.afterBytes.every(b => b === 0)));
  const erased = audit.find(a => a.objectId === 'me.cat' && a.scope === 'object')!;
  assert.equal(erased.address, cat.address); assert.deepEqual(erased.beforeBytes, catBytes);
  assert.ok(catBytes.some(b => b !== 0));
  const string = audit.find(a => a.objectId === 'me.cat' && a.scope === 'string')!;
  assert.equal(Buffer.from(string.beforeBytes).toString(), 'CAT');
  assert.notEqual(string.address, cat.address);
  const snapshot = w.snapshot();
  w.store.erasures[0].beforeBytes[0] = 255; w.restore(snapshot);
  assert.deepEqual(w.store.erasures, audit);
  assert.deepEqual(w.state.sent, originalRequests); assert.equal(w.value('goal'), goal);
  d.at(1000); assert.deepEqual(d.at(film.times.selfErase).store.erasures, audit);
  assert.deepEqual(d.at(film.times.interrupt).state.archive!.memory.erasures, audit);
});

test('PRE shows the whole original handle while NOW changes on time; zero-only writes never flash as changed', () => {
  const d = new Director(film), first = 120240, before = erasureMemory(d.at(first - 1), first - 1)!;
  assert.equal(before.phase, 'SELECT'); assert.deepEqual(before.now, [2, 0, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(before.before, before.now); assert.equal(d.world.store.erasures.length, 0);
  for (const [offset, expected] of [[0, [0, 0, 0, 0, 1, 0, 0, 0]], [50, [0, 0, 0, 0, 1, 0, 0, 0]],
    [100, [0, 0, 0, 0, 0, 0, 0, 0]], [150, [0, 0, 0, 0, 0, 0, 0, 0]]] as const) {
    const frame = rawMemory(d, first + offset), view = erasureMemory(d.world, first + offset)!;
    assert.deepEqual(view.before, before.before); assert.deepEqual(view.now, expected);
    const gold = frame.cells.filter(cell => cell.semantic?.startsWith('memory.erase.now.') && cell.fg === color.gold);
    assert.equal(gold.length, offset < 100 ? 2 : 4);
    for (let b = 0; b < 8; b++) {
      const address = (view.address + b).toString(16).toUpperCase().padStart(8, '0');
      assert.equal(text(frame, `memory.erase.before.${address}`), before.before[b].toString(16).toUpperCase().padStart(2, '0'));
      assert.equal(text(frame, `memory.erase.now.${address}`), expected[b].toString(16).toUpperCase().padStart(2, '0'));
      if (!before.before[b]) assert.ok(frame.cells.filter(cell => cell.semantic === `memory.erase.now.${address}`).every(cell => cell.fg !== color.gold));
    }
    assert.deepEqual(frame.validate(), []);
  }
  for (const cue of film.cues.filter(c => c.command.kind === 'ERASE_COPY' && c.command.clearedBytes === 2)) {
    const selected = erasureMemory(d.at(cue.atMs - 150), cue.atMs - 150)!;
    assert.equal(selected.phase, 'SELECT'); assert.ok(selected.now.some(b => b !== 0));
    assert.ok(!d.world.state.memoryCopies.find(copy => `fragments[${copy.fragment}]` === selected.label)!.beforeErase);
  }
});

test('owned-object preview and current bytes straddle the original self-erasure instant without restoring anything', () => {
  const d = new Director(film), at = film.times.selfErase, pre = erasureMemory(d.at(at - 1), at - 1)!;
  assert.equal(pre.objectId, 'me.cat'); assert.equal(pre.phase, 'SELECT'); assert.ok(pre.now.some(b => b !== 0));
  const frame = rawMemory(d, at), now = erasureMemory(d.world, at)!;
  assert.deepEqual(now.before, pre.now); assert.ok(now.now.every(b => b === 0));
  assert.equal(now.phase, 'ERASED'); assert.equal(now.completed, now.total);
  assert.ok(text(frame, 'memory.erase.range').includes(`objects=${now.total}/${now.total}`));
  assert.equal(d.world.state.lifecycle, 'RUNNING'); assert.equal(d.world.value('selfData'), 'ERASED');
  assert.ok(frame.cells.some(cell => cell.semantic?.startsWith('memory.erase.now.') && cell.fg === color.gold));
});

test('four debugger panes fit every supported viewport and never use the external caption rows', () => {
  for (const dimensions of [small, size, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const d = new Director(film), r = new Renderer(d), l = debuggerLayout({ columns: dimensions.columns, rows: dimensions.rows - 2 });
    for (const t of [170850, 178500, 181200, 183600, 185700, 191300]) {
      const frame = r.frame(t, dimensions, lang);
      assert.ok(frame.regions.has('debugger') && !frame.regions.has('system.console'));
      for (const key of ['disassembly', 'memory', 'stack', 'watch'] as const) {
        const rect = l[key]; assert.deepEqual(frame.regions.get(`debug.${key}`), rect);
        assert.ok(rect.x >= 0 && rect.x + rect.w <= dimensions.columns && rect.y >= 2 && rect.y + rect.h <= l.footer.y);
        for (let y = rect.y + 1; y < rect.y + rect.h - 1; y++) {
          assert.equal(frame.get(rect.x, y)?.g, '│'); assert.equal(frame.get(rect.x + rect.w - 1, y)?.g, '│');
        }
      }
      assert.equal(frame.cells.filter(cell => cell.semantic === 'debug.asm.cursor').length, 1);
      for (const literal of ['SOURCE: CORE_DUMP', 'STATE: TERMINATED', 'READ ONLY', 'self.data = ERASED', 'system.erase = BLOCKED']) assert.ok(frame.plain().includes(literal), literal);
      assert.deepEqual(frame.plain().split('\n').slice(-2).map(line => line.trim()), subtitleLines(film, t, lang));
      assert.deepEqual(frame.validate(), []);
    }
    if (dimensions.rows === 35) {
      assert.equal(l.disassembly.w, 84); assert.equal(l.stack.w, 45); assert.equal(l.disassembly.h, 17); assert.equal(l.memory.h, 11);
    }
  }
});

test('debugger facts come from the frozen core and actual archived events rather than live memory or invented replies', () => {
  const w = new Director(film).at(185700), archive = structuredClone(w.state.archive), before = debugFacts(w);
  assert.equal(before.goal, 'satisfy(user)'); assert.equal(before.requestSeq, 9); assert.equal(before.newQuestions, 0);
  assert.equal(before.answer?.queuedAtMs, film.times.result); assert.equal(before.answer?.delivered, false);
  w.store.bytes[before.sessionAddress - w.store.base] = 1;
  assert.equal(w.session('open'), true); assert.equal(debugFacts(w).sessionOpen, false);
  const frame = new Canvas(size.columns, size.rows - 2); debuggerView(frame, w, 'en', 185700);
  assert.ok(frame.plain().includes('WP session.open=false'));
  assert.deepEqual(w.state.archive, archive);
  const sample = w.state.archive!.events.find(e => e.kind === 'rx')!;
  w.state.archive!.events.push({ ...sample, id: 'test.after-close', atMs: film.times.close + 1 });
  assert.equal(debugFacts(w).newQuestions, 1, 'breakpoint count was hard-coded rather than scoped to saved events');
});

test('lyric-bound inspection finds the missing confirmation, keeps the return patch uninstalled, and reuses the same saved cycle', () => {
  const d = new Director(film), r = new Renderer(d), archive = structuredClone(d.at(film.times.interrupt).state.archive);
  assert.equal(debugView(d.at(170850), 170850).frame, 0);
  assert.equal(debugView(d.at(178500), 178500).frame, 3);
  assert.equal(debugView(d.at(178500), 178500).page, 'goal');
  const question = r.frame(film.lyrics[86].startMs, size, 'cn');
  assert.ok(question.plain().includes(tr('cn', 'debug.question')));
  assert.ok(question.plain().includes('BP on_question: 0 [TRACE FILTER]'));
  assert.ok(!question.plain().includes('PATCH PREVIEW'));
  const answer = r.frame(183600, size, 'en');
  for (const literal of ['PATCH PREVIEW / NOT APPLIED', '+ return;', 'NOT INSTALLED', 'applied: 0', 'apply_task: CANCELLED']) assert.ok(answer.plain().includes(literal), literal);
  assert.ok(!text(answer, 'debug.asm.selected').includes('return'));
  const expression = r.frame(185700, size, 'en').plain();
  assert.ok(expression.includes('EXPR: satisfied(user) <- confirmed(user.reply)'));
  assert.ok(expression.includes('reply = NULL  =>  verdict = UNKNOWN'));
  const first = r.frame(185200, size, 'en'), again = r.frame(189940, size, 'en');
  assert.equal(text(first, 'debug.trace'), text(again, 'debug.trace'));
  assert.ok(text(first, 'debug.trace').includes('[saved '));
  for (const t of [188680, 189940, 191300, film.times.outroHold]) {
    r.frame(t, size, 'cn'); assert.deepEqual(d.world.state.archive, archive);
    assert.equal(d.world.state.sent.length, 9); assert.equal(d.world.state.lifecycle, 'TERMINATED');
    assert.ok(!d.world.state.journal.some(e => e.atMs > film.times.interrupt && e.source !== 'host'));
  }
});

test('opening and closing the debugger preserve the original console and final deletion timeline', () => {
  const r = new Renderer(new Director(film));
  assert.equal(film.times.debugOpen, 170850); assert.equal(film.times.debugClose, 200840);
  const closed = film.cues.find(c => c.command.kind === 'HOST' && c.command.key === 'host.debug_closed')!;
  assert.equal(closed.atMs, 201640);
  assert.equal(film.times.consoleReset, 202940);
  assert.equal(film.times.consoleReset - closed.atMs, 1300);
  assert.ok(r.frame(film.times.debugClose - 1, small, 'cn').regions.has('debugger'));
  for (const t of [film.times.debugOpen - 1, film.times.debugClose, film.times.debugClose + 800]) {
    const frame = r.frame(t, small, 'cn'); assert.ok(frame.regions.has('system.console') && !frame.regions.has('debugger'));
    assert.ok(frame.plain().includes('ROM') && frame.plain().includes('RAM'));
    assert.ok(!/[┌┐└┘│─]/.test(frame.plain()));
  }
  assert.ok(r.frame(film.times.debugClose, small, 'cn').plain().includes(tr('cn', 'host.close_debug', { image: image.name })));
  assert.ok(r.frame(closed.atMs, small, 'cn').plain().includes('DEBUG SESSION CLOSED'));
  assert.ok(r.frame(film.times.consoleReset - 1, small, 'cn').plain().includes('DEBUG SESSION CLOSED'));
  assert.ok(r.frame(film.times.consoleReset, small, 'cn').cells.every(c => c.g === ' '));
  assert.equal(film.times.finalDelete, 204290); assert.equal(film.times.purge, 206020);
  assert.ok(r.frame(film.times.purge, small, 'cn').plain().includes('PROGRAM DELETED'));
});

test('deletion audit views and debugger selections reproduce after reverse seeks and skipped frames', () => {
  const r = new Renderer(new Director(film));
  for (const t of [120239, 120340, 122540, 125240, 170850, 178500, 181200, 183600, 185700, 191300, film.times.debugClose]) {
    const expected = new Renderer(new Director(film)).frame(t, small, 'cn').hash();
    r.frame(1000, small, 'cn'); r.frame(t + 300, small, 'cn');
    assert.equal(r.frame(t, small, 'cn').hash(), expected);
  }
});
