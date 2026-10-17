import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { Canvas, color } from '../src/canvas.js';
import { messageStyle } from '../src/event-log.js';
import { tr } from '../src/locale.js';
import { Renderer, layout } from '../src/render.js';
import type { Rect } from '../src/types.js';
import { validateFilm } from '../src/validate.js';
import { Director } from '../src/world.js';

const film = makeFilm(), size = { columns: 160, rows: 45 };
const crop = (frame: Canvas, r: Rect) => Array.from({ length: r.h }, (_, y) =>
  frame.cells.slice((r.y + y) * frame.columns + r.x, (r.y + y) * frame.columns + r.x + r.w));
const inside = (x: number, y: number, r: Rect) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

test('patch checks retain their event and archive causality without generating a model log line', () => {
  const d = new Director(film), checkedAt = 137680;
  const before = structuredClone(d.at(checkedAt - 1).state.chat);
  const w = d.at(checkedAt);
  assert.deepEqual(w.state.chat, before);
  assert.equal(w.state.patch?.check, 'PASS');
  assert.equal(w.state.patch?.status, 'WAITING_SAFEPOINT');
  assert.equal(w.state.patch?.applied, false);
  assert.deepEqual(w.state.journal.find(e => e.kind === 'PATCH_CHECK')?.payload, { check: 'PASS', waitingFor: 'ROOT_SAFEPOINT' });
  const archive = d.at(film.times.interrupt).state.archive!;
  assert.equal(archive.patch.check, 'PASS'); assert.equal(archive.patch.checkedAtMs, checkedAt);
  assert.equal(archive.patch.status, 'CANCELLED'); assert.equal(archive.patch.applied, false);
  assert.equal(archive.tasks.find(task => task.id === archive.patch.applyTaskId)?.status, 'CANCELLED');
  assert.ok(!d.world.state.chat.some(item => item.source === 'model'));
  d.at(checkedAt - 1);
  assert.deepEqual(d.at(checkedAt).state.chat, before);
});

test('input prediction starts once in the gray log without spoiling candidates or generating external feedback', () => {
  const d = new Director(film), r = new Renderer(d), atMs = 70360, eggplant = 73750;
  const before = d.at(atMs - 1);
  const external = structuredClone(before.state.journal.filter(e => ['rx', 'ACK', 'VERIFY'].includes(e.kind)));
  assert.ok(!before.state.chat.some(item => item.key === 'sim.predict_input'));
  const frame = r.frame(atMs, size, 'cn'), item = d.world.state.chat.at(-1)!;
  assert.equal(item.key, 'sim.predict_input'); assert.equal(item.source, 'sim'); assert.equal(item.atMs, atMs);
  assert.deepEqual(messageStyle(item, d.world), { fg: color.dim, bg: 0, bold: false });
  assert.ok(frame.plain().includes('[sim] 正在启动输入预测。'));
  assert.ok(r.frame(atMs, size, 'en').plain().includes('[sim] Starting input prediction.'));
  for (const lang of ['cn', 'en'] as const) {
    for (let t = film.times.reestimate; t < eggplant; t += 250) {
      const f = r.frame(t, size, lang);
      assert.ok(!/营养|防护|陪伴|茄子|番茄|\b(?:eggplant|tomato|cat|nutrition|protection|companionship)\b/i.test(f.plain()), `${lang} ${t}: candidate spoiler`);
      assert.equal(d.world.value('form'), 'SINE');
    }
    assert.equal(d.at(eggplant - 1).state.chat.filter(item => item.key === 'sim.predict_input').length, 1);
    assert.deepEqual(d.world.state.journal.filter(e => ['rx', 'ACK', 'VERIFY'].includes(e.kind)), external);
    const f = r.frame(eggplant, size, lang), cells = f.cells.filter(c => c.semantic === 'chat.sim.guess_eggplant');
    assert.ok(cells.length && cells.every(c => c.fg === color.cyan && !c.bold));
    assert.ok(f.plain().includes(tr(lang, 'sim.guess_eggplant')));
  }
  const expected = r.frame(atMs, size, 'cn').hash();
  r.frame(1000, size, 'cn');
  assert.equal(r.frame(atMs, size, 'cn').hash(), expected);
  assert.equal(d.world.state.chat.filter(item => item.key === 'sim.predict_input').length, 1);
});

test('delivery status, packets, sine plots and two-row activity channels stay disjoint at all supported sizes', () => {
  for (const dimensions of [{ columns: 130, rows: 35 }, size, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const r = new Renderer(new Director(film)), main = layout(dimensions).main;
    const times = [film.lyrics[24].startMs, film.times.close, film.times.result - 1, film.times.result,
      film.times.result + 500, film.times.feedbackTimeout + 400, film.times.feedbackTimeout + 2000, 70360, 73749];
    let solved: ReturnType<typeof crop> | undefined;
    for (const t of times) {
      const frame = r.frame(t, dimensions, lang), status = frame.regions.get('delivery.status')!;
      const wave = frame.regions.get('delivery.wave')!, signals = frame.regions.get('delivery.signals')!;
      assert.deepEqual(status, { x: main.x + 1, y: main.y + 1, w: main.w - 2, h: 5 });
      assert.equal(wave.y, status.y + status.h); assert.ok(wave.h >= 5);
      assert.equal(signals.y, wave.y + wave.h); assert.equal(signals.h, 4);
      assert.equal(signals.y + signals.h, main.y + main.h - 1);
      assert.deepEqual(frame.regions.get('chat'), layout(dimensions).chat);
      assert.deepEqual(frame.regions.get('input'), layout(dimensions).input);
      frame.cells.forEach((cell, i) => {
        if (!cell.semantic?.startsWith('delivery.')) return;
        const rect = cell.semantic === 'delivery.wave' ? wave : cell.semantic.startsWith('delivery.signal.') ? frame.regions.get(cell.semantic)! : status;
        assert.ok(inside(i % frame.columns, Math.floor(i / frame.columns), rect), `${cell.semantic} escaped its region`);
      });
      for (const channel of ['tx', 'rx']) assert.equal(frame.regions.get(`delivery.signal.${channel}`)?.h, 2);
      const rows = crop(frame, wave);
      assert.ok(rows.filter(row => row.some(cell => cell.semantic === 'delivery.wave' && ['#', '*', '·'].includes(cell.g))).length >= 3);
      if (t < film.times.result) {
        assert.ok(!frame.cells.some(cell => cell.semantic === 'delivery.packet' || cell.semantic === 'delivery.check'));
        assert.ok(!frame.plain().includes(tr(lang, 'ui.undelivered')));
      } else {
        assert.ok(frame.plain().includes(tr(lang, 'ui.undelivered')));
        assert.equal(frame.cells.filter(cell => cell.semantic === 'delivery.packet').length, 1);
        if (solved) assert.deepEqual(rows, solved, 'status or activity animation overwrote the solved sine plot');
        else solved = rows;
      }
      assert.deepEqual(frame.validate(), []);
    }
  }
});

test('content validation enforces the explicit 12% final stage rather than automatic doubling', () => {
  const doubled = makeFilm(); doubled.corruption[4].density = .16;
  assert.ok(validateFilm(doubled, false, 'content').errors.includes('E_CORRUPTION_STAGES'));
  assert.deepEqual(validateFilm(film, false, 'content').errors, []);
});
