import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFilm } from '../films/world-execute/manifest.js';
import { ObjectStore } from '../src/store.js';
import { Director } from '../src/world.js';
import { validateFilm } from '../src/validate.js';
import { tangentAt, unrollCircle, currentSample, activity, era } from '../src/providers.js';
import { MediaClock } from '../src/audio.js';
import { parseLoop } from '../src/math.js';

const film = makeFilm();
test('rehearsal loop ranges use media milliseconds and reject empty, reversed or tiny intervals', () => {
  assert.deepEqual(parseLoop('02:38.5..02:43'), { startMs: 158500, endMs: 163000 });
  for (const text of ['', '10', '20..10', '01:00..01:00.1', 'a..b', '0..1..2']) assert.throws(() => parseLoop(text));
});
test('all content contracts pass; unreviewed machine anchors fail release validation', () => {
  const result = validateFilm(film); assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some(w => w.startsWith('E_ANCHOR_ROUGH')));
  assert.ok(validateFilm(film, true).errors.some(e => e.startsWith('E_ANCHOR_ROUGH')));
});
test('keyword and count syllable anchors cannot drift outside their lyric spans', () => {
  const misplacedKeyword = makeFilm(film.anchors.map(a => a.id === 'lyric.18.ac' ? { ...a, atMs: 0 } : a));
  assert.ok(validateFilm(misplacedKeyword, false, 'content').errors.includes('E_KEYWORD_RANGE:lyric.18.ac'));
  const misplacedCount = makeFilm(film.anchors.map(a => a.id === 'count.1' ? { ...a, atMs: film.lyrics[72].startMs - 20 } : a));
  assert.ok(validateFilm(misplacedCount, false, 'content').errors.includes('E_COUNT_LYRIC_RANGE:1'));
});
test('typed values, UTF-8 references, byte order, alignment, and invalid-write rollback share one store', () => {
  const store = new ObjectStore([{ name: 'Example', alignment: 16, fields: [
    { name: 'number', type: 'u32' }, { name: 'ratio', type: 'f64' }, { name: 'text', type: { stringRef: 'utf8' } },
    { name: 'items', type: { array: 'u16', length: 2 } }, { name: 'mode', type: { enum: ['A', 'B'] } },
  ] }]);
  const a = store.create('Example', 'example', { number: 0x12345678, ratio: Math.PI, text: '中文 네', items: [2, 513], mode: 'B' }, 0);
  assert.equal(a.address % 16, 0); assert.equal(store.bytes[a.address - store.base], 0x78);
  assert.equal(store.read('example', 'text'), '中文 네'); assert.equal(store.read('example', 'ratio'), Math.PI);
  assert.deepEqual(store.read('example', 'items'), [2, 513]);
  const snapshot = Buffer.from(store.bytes); assert.throws(() => store.set('example', 'items', [2, -1], 'core', 1));
  assert.deepEqual(store.bytes, snapshot); assert.equal(store.read('example', 'mode'), 'B');
  assert.throws(() => store.create('Example', 'overlap', {}, 1, a.address));
  assert.throws(() => new ObjectStore([{ name: 'Bad', alignment: 16, fields: [{ name: 'a', type: 'u32', offset: 0 }, { name: 'b', type: 'u32', offset: 0 }] }]));
});
test('draft does not create a request or task; one send links history, transcript, task and rx', () => {
  const d = new Director(film), interaction = film.interactions[1];
  let w = d.at(interaction.send - 1); assert.equal(w.state.sent.length, 1); assert.equal(w.state.tasks.length, 1);
  w = d.at(interaction.send); const request = w.state.sent.at(-1)!;
  assert.equal(request.interactionId, interaction.id);
  assert.equal(w.state.chat.find(c => c.requestId === request.id && c.source === 'session')?.key, request.key);
  assert.equal(w.state.tasks.find(t => t.requestId === request.id)?.program, interaction.program);
  assert.equal(w.state.journal.filter(e => e.kind === 'rx' && e.payload.requestId === request.id).length, 1);
  d.at(interaction.send + 200); d.at(1000); w = d.at(interaction.send + 200);
  assert.equal(w.state.sent.filter(r => r.id === request.id).length, 1);
});
test('disconnect freezes external facts; predictions never become rx, ack or verification', () => {
  const d = new Director(film); const w = d.at(film.times.close + 1), ack = w.session('ackSeq'), verified = w.value('verified_revision');
  const after = d.at(film.lyrics[60].endMs);
  assert.equal(after.session('ackSeq'), ack); assert.equal(after.value('verified_revision'), verified); assert.equal(after.session('open'), false);
  assert.equal(activity(after, 'rx', film.times.close + 1500), 0);
  assert.ok(after.state.tasks.some(t => t.requestId === null && t.source === 'prediction'));
  assert.equal(after.value('lock'), false); assert.ok(Number(after.value('missingArc')) > 0);
  const probes = after.state.outputs.filter(output => output.channel === 'probe');
  assert.ok(probes.length > 10 && probes.every(output => !output.delivered && output.requestId === null));
  assert.ok(Math.max(...probes.map(output => output.frequency!)) > Math.min(...probes.map(output => output.frequency!)) + 2);
  assert.ok(!after.state.journal.some(e => e.atMs > film.times.close && ['rx', 'ACK', 'VERIFY'].includes(e.kind)));
});
test('erasure changes bytes and validity while protected session writes are rejected', () => {
  const d = new Director(film), w = d.at(film.lyrics[65].endMs);
  const a = w.store.allocation('me'), field = w.store.field('me', 'fragments');
  for (const fragment of [1, 5]) assert.deepEqual([...w.store.bytes.subarray(a.address - w.store.base + field.offset + fragment * 8, a.address - w.store.base + field.offset + fragment * 8 + 8)], Array(8).fill(0));
  assert.equal(w.store.valid('me', 'fragments'), false); assert.equal(w.value('goal'), 'satisfy(user)'); assert.equal(w.session('open'), false);
  assert.ok(w.state.journal.some(e => e.kind === 'REJECT' && e.source === 'guard'));
  assert.throws(() => w.store.set('session', 'open', true, 'model', 0));
});
test('a request allocates its typed boundary from semantic parameters without handwritten addresses', () => {
  const d = new Director(film), interaction = film.interactions.find(i => i.id === 'infinity')!;
  assert.equal(d.at(interaction.send - 1).store.allocations.has('user.boundary'), false);
  const w = d.at(interaction.send), request = w.state.sent.at(-1)!;
  assert.equal(request.payload.operation, 'approach-boundary'); assert.equal(w.value('boundary'), 'user.boundary');
  assert.equal(w.store.read('user.boundary','maximum'), request.payload.args.maximum);
  assert.equal(w.store.allocation('user.boundary').owner, 'external');
  assert.throws(() => w.store.set('user.boundary','maximum',5,'core',interaction.send));
});
test('six stages arm without committing; the word end precedes intent and the write barrier', () => {
  const d = new Director(film); const w = d.at(film.times.intent - 1);
  assert.equal(w.state.plan?.armed, 6); assert.equal(w.state.plan?.commit, 0); assert.notEqual(w.value('status'), 'TERMINATED');
  assert.equal(d.at(film.times.intent).state.plan?.status, 'INTENT_VISIBLE');
  assert.notEqual(d.at(film.times.interrupt - 1).value('status'), 'TERMINATED');
  const after = d.at(film.times.interrupt); assert.equal(after.state.plan?.status, 'BLOCKED'); assert.equal(after.value('status'), 'TERMINATED'); assert.equal(after.value('goal'), 'satisfy(user)');
  const archive = after.state.archive!; assert.equal(archive.patch.applied, false);
  assert.equal(archive.tasks.find(t => t.id === archive.patch.applyTaskId)?.status, 'CANCELLED');
  assert.ok(archive.patch.checkedAtMs < archive.terminatedAtMs);
  const hash = JSON.stringify(archive); d.at(film.durationMs); assert.equal(JSON.stringify(after.state.archive), hash);
  assert.ok(!after.state.journal.some(e => e.atMs > film.times.interrupt && e.source === 'core'));
});
test('the patch is a draft before the check event and cannot acquire PASS from a later render', () => {
  const created = film.cues.find(cue => cue.command.kind === 'PATCH')!.atMs, d = new Director(film);
  const draft = d.at(created + 100).state.patch!; assert.equal(draft.check, 'PENDING'); assert.equal(draft.checkedAtMs, -1);
  const checked = d.at(created + 160).state.patch!; assert.equal(checked.check, 'PASS'); assert.equal(checked.checkedAtMs, created + 160); assert.equal(checked.status, 'WAITING_SAFEPOINT');
});
test('fixed ticks and checkpoints reproduce exact state across frame rates, dropped frames and reverse seeks', () => {
  const target = film.times.interrupt + 25, direct = new Director(film).at(target).snapshot();
  for (const step of [1000 / 24, 1000 / 30, 1700]) {
    const d = new Director(film); for (let t = 0; t < target; t += step) d.at(Math.round(t));
    assert.deepEqual(d.at(target).snapshot(), direct); d.at(5000); assert.deepEqual(d.at(target).snapshot(), direct);
  }
});
test('providers preserve circumference, tangent contact, current stages and era direction', () => {
  const r = 3, g = unrollCircle(r, Math.PI * 2); assert.ok(Math.abs(g.length - 2 * Math.PI * r) < 1e-10); assert.ok(Math.abs(g.marker.y) < 1e-10);
  assert.equal(tangentAt(.7, .7), Math.sin(.7));
  assert.equal(currentSample(0, 'DC_SETTLED'), currentSample(2, 'DC_SETTLED'));
  assert.ok(currentSample(2, 'RECTIFIED_PULSE') >= 0);
  assert.equal(era(0), 'BC 1'); assert.equal(era(1), 'AD 1');
});
test('AC/DC and AD/BC states land on their keyword anchors', () => {
  const time = (id: string): number => film.anchors.find(anchor => anchor.id === id)!.atMs;
  const d = new Director(film), ac = time('lyric.18.ac'), dc = time('lyric.18.dc');
  assert.equal(d.at(ac).value('currentMode'),'SINE');
  assert.equal(d.at(ac+(dc-ac)*.3).value('currentMode'),'LIMITED');
  assert.equal(d.at(ac+(dc-ac)*.7).value('currentMode'),'RECTIFIED_PULSE');
  assert.equal(d.at(dc).value('currentMode'),'DC_SETTLED');
  assert.ok(Number(d.at(time('lyric.22.ad')).value('currentYear'))>0);
  assert.equal(d.at(time('lyric.22.bc')).value('currentYear'),-120);
});
test('media clock pause, speed and epochs are independent of render cadence', () => {
  const c = new MediaClock(); c.update({ mediaTimeMs: 1000, monotonicMs: 100, speed: 2, paused: false, epoch: 1 }); assert.equal(c.read(600), 2000);
  c.update({ mediaTimeMs: 1600, monotonicMs: 600, speed: 2, paused: true, epoch: 1 }); assert.equal(c.read(5000), 1600);
  assert.equal(c.update({ mediaTimeMs: 0, monotonicMs: 0, speed: 1, paused: false, epoch: 0 }), false); assert.equal(c.read(5000), 1600);
});
