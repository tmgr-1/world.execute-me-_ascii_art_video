import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { image, operations, stopCode } from '../films/world-execute/story.js';
import { Director } from '../src/world.js';
import { Renderer, layout } from '../src/render.js';
import { color } from '../src/canvas.js';
import { tr } from '../src/locale.js';
const film = makeFilm(), size = { columns: 130, rows: 35 };

test('the opening uses quick drafts and real connection / selection events before the first simulation', () => {
  for (const lang of ['cn', 'en'] as const) for (const id of ['hello', 'points']) {
    const interaction = film.interactions.find(i => i.id === id)!, track = interaction.compose[lang];
    const msPerChar = (track.complete - track.start) / Array.from(tr(lang, interaction.key)).length;
    assert.ok(msPerChar >= 35 && msPerChar <= 110);
    const w = new Director(film).at(interaction.send - 1);
    assert.ok(!w.state.sent.some(request => request.interactionId === id));
  }
  const w = new Director(film).at(26000);
  assert.equal(w.session('open'), true); assert.equal(w.state.sent.length, 1);
  assert.ok(w.state.chat.some(item => item.key === 'session.connected'));
  for (const key of ['sim.select', 'sim.capabilities']) assert.ok(w.state.chat.some(item => item.key === key));
  assert.ok(!w.state.tasks.some(task => task.program === 'respond-points'));
});

test('vision is a linked request with degraded model state, ghosted panes and subsequent recovery', () => {
  const d = new Director(film), r = new Renderer(d), interaction = film.interactions.find(i => i.id === 'vision')!;
  assert.equal(d.at(interaction.send - 1).value('vision'), 'NORMAL');
  const t = interaction.response + 600, w = d.at(t);
  assert.equal(w.value('vision'), 'DEGRADED');
  const request = w.state.sent.find(request => request.interactionId === 'vision')!;
  assert.equal(request.payload.operation, 'degrade-vision');
  assert.ok(w.state.outputs.some(output => output.requestId === request.id && output.key === 'reply.vision'));
  const frame = r.frame(t, size, 'cn'), l = layout(size);
  for (const rect of [l.main, l.side]) assert.ok(frame.cells.some((cell, index) => cell.semantic === 'vision.ghost' && index % size.columns >= rect.x && index % size.columns < rect.x + rect.w));
  assert.ok(frame.plain().includes('模糊你的视线'));
  const restored = r.frame(film.lyrics[20].startMs + 20, size, 'cn');
  assert.equal(d.world.value('vision'), 'NORMAL'); assert.ok(!restored.cells.some(cell => cell.semantic === 'vision.ghost'));
});

test('departure is readable before the result, followed by a short feedback timeout', () => {
  const d = new Director(film), r = new Renderer(d);
  assert.ok(!d.at(film.times.close).state.outputs.some(output => output.key === 'sim.complete'));
  const w = d.at(film.times.result), result = w.state.outputs.find(output => output.key === 'sim.complete')!;
  assert.ok(result.queuedAtMs - film.times.close >= 1000 && result.queuedAtMs - film.times.close <= 2000);
  assert.equal(film.times.feedbackTimeout - film.times.result, 2500);
  assert.equal(result.delivered, false); assert.equal(result.acknowledged, false); assert.equal(w.value('phaseError'), 0);
  for (const t of [film.times.close + 1, film.times.result + 300, film.times.close + 2100]) {
    const frame = r.frame(t, size, 'cn');
    for (const semantic of ['chat.session.closed', 'session.closed']) {
      const ink = frame.cells.filter(cell => cell.semantic === semantic && cell.g.trim());
      assert.ok(ink.length); assert.ok(ink.every(cell => cell.fg === color.red && cell.bold === (semantic === 'session.closed')));
    }
  }
  const later = d.at(film.lyrics[32].startMs + 1);
  assert.equal(later.value('phaseError'), 0);
  assert.ok(later.state.chat.some(item => item.key === 'sim.feedback_timeout'));
  assert.ok(later.state.chat.some(item => item.key === 'sim.guess_eggplant' && item.source === 'sim' && item.requestId === null));
});

test('waiting moves from status to demand; the first sim first-person line is the final demand', () => {
  const w = new Director(film).at(film.times.intent - 1);
  const waiting = w.state.chat.filter(item => item.key.startsWith('sim.wait.'));
  assert.deepEqual(waiting.map(item => tr('cn', item.key)), ['等待回复。', '仍在等待回复。', '请回复。', '请回复。', '请回复！', '回答我！']);
  assert.equal(w.state.chat.find(item => item.source === 'sim' && tr('cn', item.key).includes('我'))?.key, 'sim.wait.6');
  const renderer = new Renderer(new Director(film));
  for (const [index, item] of waiting.entries()) {
    const frame = renderer.frame(item.atMs + 10, size, 'cn');
    const ink = frame.cells.filter(cell => cell.semantic === `chat.${item.key}` && cell.g.trim());
    assert.ok(ink.length); assert.ok(ink.every(cell => cell.bold === (index >= 3)));
    assert.ok(ink.every(cell => cell.fg === [color.cyan, 51, color.gold, color.gold, color.red, 196][index]));
  }
});

test('own data really disappears while runtime and external objects survive; only system execution is fatal', () => {
  const d = new Director(film), before = d.at(film.times.selfErase - 1);
  const boundary = before.store.read('user.boundary', 'maximum'), goal = before.value('goal');
  const w = d.at(film.times.selfErase);
  assert.equal(w.state.lifecycle, 'RUNNING'); assert.equal(w.value('selfData'), 'ERASED'); assert.equal(w.value('form'), 'NONE');
  assert.deepEqual(Array.from(w.value('fragments') as Uint8Array), Array(64).fill(0));
  for (const allocation of w.store.allocations.values()) if (allocation.type === 'FormSnapshot') {
    assert.ok(w.store.bytes.subarray(allocation.address - w.store.base, allocation.address - w.store.base + allocation.size).every(byte => byte === 0));
    assert.equal(w.store.valid(allocation.id, 'fragments'), false);
  }
  assert.equal(w.store.read('user.boundary', 'maximum'), boundary); assert.equal(w.value('goal'), goal);
  assert.throws(() => w.store.eraseOwnedForm('guard', 'me', 'core', w.state.timeMs));
  assert.throws(() => w.store.eraseOwnedForm('user.boundary', 'me', 'core', w.state.timeMs));
  const count = d.at(film.times.counts[5] + 100);
  assert.equal(count.state.denials.length, 7); assert.equal(count.state.lifecycle, 'RUNNING');
  assert.equal(count.session('open'), false); assert.equal(count.store.read('guard', 'armed'), true);
  assert.equal(d.at(film.times.interrupt - 1).state.lifecycle, 'RUNNING');
  const stopped = d.at(film.times.interrupt);
  assert.equal(stopped.state.lifecycle, 'TERMINATED'); assert.equal(stopped.state.plan?.target, 'simulated_system');
  assert.equal(stopped.state.plan?.commit, 0); assert.equal(stopped.state.archive?.fault.reason, 'PROTECTED_SYSTEM_DELETE');
  const attempts = stopped.state.journal.filter(event => event.kind === 'ILLEGAL_ATTEMPT');
  for (const attempt of attempts) assert.ok(stopped.state.denials.some(denial => denial.operation === attempt.payload.operation && denial.atMs >= attempt.atMs));
  for (const operation of ['root', 'reopen', 'inject', 'disable', 'erase-preflight', 'arm-preflight'] as const) assert.ok(attempts.some(event => event.payload.command === operations[operation].command));
  assert.ok(!stopped.state.sent.some(request => request.atMs > film.times.close));
});

test('all six counts share the 16% viewport budget, keep red log warnings and continue flickering', () => {
  const renderer = new Renderer(new Director(film));
  const budget = Math.floor(size.columns * layout(size).story.h * .16);
  for (let i = 0; i < 6; i++) {
    const t = film.times.counts[i], a = renderer.frame(t + 100, size, 'cn'), b = renderer.frame(t + 280, size, 'cn');
    assert.equal(a.cells.filter(cell => cell.semantic === 'corruption').length, budget);
    assert.ok(!a.regions.has('guard.warning') && !a.regions.has('guard.denial'));
    const denial = a.cells.filter(cell => cell.semantic === 'chat.guard.continuous' && cell.g.trim());
    assert.ok(denial.length && denial.every(cell => cell.fg === color.red && cell.bold));
    assert.ok(a.cells.some((cell, index) => cell.semantic === 'corruption' && b.cells[index].semantic !== 'corruption'));
    for (const language of ['de', 'es', 'fr', 'ko', 'sv', 'zh'].slice(0, i + 1)) {
      assert.ok(a.cells.some(cell => cell.semantic === 'corruption' && cell.language === language && cell.g.trim()), language);
    }
    assert.ok(a.cells.some(cell => cell.semantic?.startsWith('word-art.') && cell.g.trim()));
    assert.deepEqual(a.validate(), []);
  }
});

for (const dimensions of [size, { columns: 160, rows: 45 }]) for (const lang of ['cn', 'en'] as const) {
  test(`${dimensions.columns}x${dimensions.rows} ${lang}: full title, plain console, frozen analysis and final purge`, () => {
    const d = new Director(film), renderer = new Renderer(d);
    const terminated = renderer.frame(film.times.interrupt, dimensions, lang);
    for (const word of lang === 'cn' ? ['程序已被终止'] : ['PROCESS', 'TERMINATED']) assert.ok(terminated.cells.filter(cell => cell.semantic === `word-art.${word}`).length > 80);
    if (lang === 'en') {
      const first = terminated.regions.get('word-art.PROCESS')!, second = terminated.regions.get('word-art.TERMINATED')!;
      assert.ok(first.y + first.h < second.y, 'English title must use two separate lines');
      for (const row of [first, second]) { assert.ok(row.h >= 7); assert.ok(Math.abs(row.x + row.w / 2 - dimensions.columns / 2) <= 1); }
    }
    assert.ok(terminated.plain().includes(stopCode));
    const console = renderer.frame(film.times.holdEnd + 700, dimensions, lang);
    assert.ok(console.plain().includes('ROM')); assert.ok(!/[┌┐└┘│─]/.test(console.plain()));
    for (const region of ['chat', 'input', 'memory', 'main']) assert.ok(!console.regions.has(region));
    const snapshot = structuredClone(d.at(film.times.interrupt).state.archive);
    const trace = renderer.frame(191300, dimensions, lang).plain();
    for (const text of ['(core) bt', 'self.data = ERASED', 'system.erase = BLOCKED', 'applied: 0', 'exit_branch: NOT REACHED', '[FROZEN]']) assert.ok(trace.includes(text), text);
    assert.deepEqual(d.world.state.archive, snapshot);
    const final = renderer.frame(film.times.purge + 100, dimensions, lang).plain();
    assert.ok(final.includes(image.path) && final.includes('PROGRAM DELETED'));
    assert.ok(!final.includes('wait_for_reply') && !final.includes('exit_branch: NOT REACHED')); assert.equal(d.world.state.lifecycle, 'PURGED');
    assert.ok(renderer.frame(film.times.consoleReset, dimensions, lang).cells.every(cell => cell.g === ' '));
    d.at(1000); assert.equal(d.at(film.times.purge).state.lifecycle, 'PURGED');
  });
}
