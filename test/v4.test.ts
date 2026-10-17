import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { Director } from '../src/world.js';
import { Renderer, layout, modalRect } from '../src/render.js';
import { currentLyric, subtitleLines } from '../src/subtitles.js';
import { color, width } from '../src/canvas.js';
import { tr } from '../src/locale.js';

const film = makeFilm(), small = { columns: 130, rows: 35 };

test('boot percentages are monotonic and complete at simulation readiness', () => {
  const r = new Renderer(new Director(film));
  let last = -1;
  for (let t = 0; t < film.times.intro; t += 500) {
    const frame = r.frame(t, small, 'cn');
    const text = frame.cells.filter(c => c.semantic === 'boot.progress.total').map(c => c.g).join('');
    const percent = Number(/(\d+)%/.exec(text)![1]);
    assert.ok(percent >= last && percent <= 100); last = percent;
    assert.ok(!frame.plain().includes('[##]'));
  }
  const ready = r.frame(film.times.intro, small, 'cn');
  assert.ok(ready.cells.filter(c => c.semantic === 'boot.progress.total').map(c => c.g).join('').includes('100%'));
  assert.equal(new Director(film).at(film.times.intro).value('status'), 'RUNNABLE');
});

test('the closed session remains alone for 1.5 seconds; timeout starts inspection, not another long wait', () => {
  const d = new Director(film), r = new Renderer(d);
  assert.ok(!d.at(film.times.result - 1).state.outputs.some(output => output.key === 'sim.complete'));
  assert.ok(!d.at(film.times.feedbackTimeout - 1).state.chat.some(item => item.key === 'sim.feedback_timeout'));
  assert.ok(d.at(film.times.feedbackTimeout).state.chat.some(item => item.key === 'sim.feedback_timeout'));
  assert.ok(r.frame(film.times.feedbackTimeout + 400, small, 'cn').plain().includes('检查投递状态'));
  assert.ok(r.frame(film.times.feedbackTimeout + 2000, small, 'cn').plain().includes('检查未确认目标'));
});

test('each autonomous candidate has one combined cyan hypothesis; God needs ROOT and user proof', () => {
  const d = new Director(film), r = new Renderer(d), w = d.at(film.lyrics[40].startMs - 1);
  for (const id of ['eggplant', 'tomato', 'cat']) assert.equal(w.state.chat.filter(c => c.key === `sim.guess_${id}`).length, 1);
  assert.ok(!w.state.chat.some(c => c.key === 'sim.no_reply'));
  assert.equal(tr('cn', 'sim.request_root'), '未收到回复。需求假设：全能响应。所需权限：ROOT。');
  for (const [n, key] of [[33, 'sim.guess_eggplant'], [35, 'sim.guess_tomato'], [37, 'sim.guess_cat'], [39, 'sim.request_root'], [41, 'sim.modify_attributes'], [45, 'sim.switch_role'], [50, 'sim.probe_signal'], [51, 'sim.probe_calibrate'], [52, 'sim.probe_empty']] as const) {
    const frame = r.frame(film.lyrics[n - 1].startMs + 30, small, 'cn');
    const guided = frame.cells.filter(c => c.semantic === `chat.${key}` && c.g.trim());
    assert.ok(guided.length && guided.every(c => c.fg === color.cyan && !c.bold));
  }
  const proof = r.frame(film.lyrics[39].startMs + 100, small, 'cn').plain();
  assert.ok(proof.includes('全能响应') && proof.includes('授权证明缺失：用户确认'));
  assert.equal(d.world.session('open'), false);
});

test('attribute write focus follows the actual field, address and changed bytes without delaying lyrics', () => {
  const d = new Director(film), r = new Renderer(d);
  for (const [id, field, value] of [['gender.F', 'gender', 'F'], ['gender.M', 'gender', 'M'], ['period.AM', 'period', 'AM'], ['period.PM', 'period', 'PM'], ['role.S', 'role', 'S'], ['role.M', 'role', 'M']] as const) {
    const atMs = film.cues.find(cue => cue.id === id)!.atMs;
    assert.notEqual(d.at(atMs - 1).value(field), value);
    const frame = r.frame(atMs + 50, small, 'cn'), change = d.world.store.changes.get(`me:${field}`)!;
    assert.equal(d.world.value(field), value);
    assert.ok(frame.plain().includes(`WRITE ${field}: ${change.before} → ${value}`));
    assert.ok(frame.plain().includes(change.address.toString(16).toUpperCase().padStart(8, '0')));
    const bytesChanged = change.beforeBytes!.filter((byte, i) => byte !== change.afterBytes![i]).length;
    const ink = frame.cells.filter(c => c.semantic === `field.me.${field}` && c.fg === color.gold && c.bold);
    assert.equal(ink.length, bytesChanged * 2, 'unchanged bytes must not flash as writes');
    assert.ok(frame.cells.some(c => c.semantic === 'memory.write.value' && c.bold));
    assert.deepEqual(frame.validate(), []);
  }
  assert.ok(!r.frame(film.lyrics[48].startMs, small, 'cn').cells.some(c => c.semantic?.startsWith('memory.write.')));
});

test('the execution sequence ends before Ein; guard warning refreshes never issue new operations', () => {
  const w = new Director(film).at(film.times.interrupt);
  const attempts = w.state.journal.filter(e => e.kind === 'ILLEGAL_ATTEMPT' && e.atMs >= film.times.executionStart);
  assert.equal(attempts[0].atMs - film.lyrics[65].endMs, 1500);
  assert.ok(attempts.every(e => e.atMs < film.times.executionEnd && e.atMs < film.times.counts[0]));
  const notices = w.state.journal.filter(e => e.kind === 'VIOLATIONS_DETECTED');
  assert.equal(notices.length, 7);
  assert.equal(notices[0].atMs, film.lyrics[71].startMs + 120);
  assert.deepEqual(notices.slice(1).map(e => e.payload.ordinal), [1, 2, 3, 4, 5, 6]);
  assert.ok(!w.state.journal.some(e => ['ILLEGAL_ATTEMPT', 'REJECT'].includes(e.kind) && e.atMs >= film.times.counts[0] && e.atMs < film.times.intent));
});

test('count warnings append to the full log and scroll its tail; old lines acquire persistent scars while new warnings remain legible', () => {
  const size = { columns: 160, rows: 45 }, r = new Renderer(new Director(film));
  for (let i = 1; i < 6; i++) {
    const frame = r.frame(film.times.counts[i] + 100, size, 'cn'), region = frame.regions.get('guard.warning')!;
    assert.equal(region.y, layout(size).chat.y + layout(size).chat.h - 2);
    const previous = frame.regions.get(`guard.warning.${i}`)!;
    const cells = frame.cells.slice(previous.y * size.columns + previous.x, previous.y * size.columns + previous.x + previous.w);
    assert.ok(cells.some(c => c.semantic === 'corruption'));
    const current = frame.cells.slice(region.y * size.columns + region.x, region.y * size.columns + region.x + region.w);
    assert.ok(current.filter(c => c.g.trim()).every(c => c.semantic === 'chat.guard.continuous' && c.bold && c.fg === color.red));
    const direct = new Renderer(new Director(film)).frame(film.times.counts[i] + 100, size, 'cn');
    assert.equal(frame.hash(), direct.hash());
  }
});

test('all 93 translations fit; English count meanings occupy only the second caption row', () => {
  for (const lyric of film.lyrics) {
    assert.ok(lyric.translation.trim() && width(lyric.translation) <= 126);
    assert.deepEqual(subtitleLines(film, lyric.startMs, 'cn'), [lyric.text, lyric.translation]);
    assert.equal(subtitleLines(film, lyric.startMs, 'en')[1], lyric.englishMeaning ?? '');
  }
  for (const [n, translation] of [[73, '(one, two)'], [74, '(three, four)'], [75, '(five, six)']] as const) assert.equal(subtitleLines(film, film.lyrics[n - 1].startMs, 'en')[1], translation);
  assert.equal(subtitleLines(film, film.lyrics[75].startMs, 'en')[1], '');
  assert.equal(currentLyric(film, film.lyrics[65].endMs + 301), undefined);
  assert.equal(currentLyric(film, film.lyrics[92].endMs + 301), undefined);
});

test('captions survive corruption, frozen termination, POST, core analysis and final deletion at every supported size', () => {
  for (const size of [small, { columns: 160, rows: 45 }, { columns: 220, rows: 60 }]) for (const lang of ['cn', 'en'] as const) {
    const r = new Renderer(new Director(film));
    for (const t of [film.times.counts[5] + 100, film.times.interrupt + 1200, film.times.holdEnd + 400, film.times.patch + 500, film.times.finalExecution + 500]) {
      const frame = r.frame(t, size, lang), texts = frame.plain().split('\n').slice(-2).map(s => s.trim());
      assert.deepEqual(texts, subtitleLines(film, t, lang));
      const ink = frame.cells.slice((size.rows - 2) * size.columns).filter(c => c.g.trim());
      assert.ok(ink.length && ink.every(c => c.fg === 15 && c.bg === 0 && c.bold && c.semantic?.startsWith('subtitle.')));
      assert.deepEqual(frame.validate(), []);
    }
    const panel = modalRect(size, lang), chat = layout(size).chat;
    assert.ok(panel.y > chat.y + chat.h && panel.y + panel.h < size.rows - 2);
  }
});
