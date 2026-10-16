import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { MpvTransport } from '../src/audio.js';
import { Canvas } from '../src/canvas.js';
import { TerminalAdapter } from '../src/terminal.js';
import { Renderer } from '../src/render.js';
import { Director } from '../src/world.js';
import { makeFilm } from '../films/world-execute/manifest.js';

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const fixture = fileURLToPath(new URL('./fixtures/fake-mpv.mjs', import.meta.url));
test('JSON protocol fixture: load paused, exact seek, speed, frozen pause, EOF and own-child cleanup', { skip: process.platform === 'win32' }, async () => {
  const a = new MpvTransport(fixture, true); const failures: Error[] = []; a.on('failure', error => failures.push(error as Error));
  try {
    await a.load(resolve('package.json')); assert.equal(a.durationMs, 211944); assert.equal(a.clock.read(), 0);
    await a.seek(120000); assert.ok(Math.abs(a.clock.read() - 120000) < 20);
    await a.setSpeed(2); await a.setPaused(false); await delay(80); assert.ok(a.clock.read() > 120080);
    await a.setPaused(true); const at = a.clock.read(); await delay(100); assert.equal(a.clock.read(), at);
    await a.seek(211800); const ended = new Promise<void>(resolve => a.once('ended', resolve)); await a.setPaused(false); await ended; assert.equal(a.clock.read(), a.durationMs);
    assert.deepEqual(failures, []);
  } finally { await a.close(); await a.close(); }
});
test('invalid files and missing players fail and clean up rather than becoming story termination', { skip: process.platform === 'win32' }, async () => {
  const a = new MpvTransport(fixture, true, 800);
  try { await assert.rejects(a.load('/path/that/does/not/exist.mp3'), /E_AUDIO_FAILED/); } finally { await a.close(); }
  const b = new MpvTransport('/nonexistent/player', true, 800);
  try { await assert.rejects(b.load(resolve('package.json'))); } finally { await b.close(); }
});
test('single output adapter uses terminal-kit, emits whole glyphs and restores terminal modes', async () => {
  const chunks: Buffer[] = [], output = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const adapter = new TerminalAdapter(output as NodeJS.WriteStream), c = new Canvas(15, 4);
  c.text(1, 1, '中文 네 é', { fg: 81 }); adapter.begin(); adapter.submit(c, true, 100); adapter.submit(c, false, 100); await adapter.close();
  const text = Buffer.concat(chunks).toString();
  assert.ok(text.includes('中')); assert.ok(text.includes('네')); assert.ok(text.includes('\x1b[?1049h')); assert.ok(text.endsWith('\x1b[?1049l'));
});
test('terminal output includes the side panels and bottom edge beyond the reference viewport after resizing', async () => {
  const chunks: Buffer[] = [], output = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const adapter = new TerminalAdapter(output as NodeJS.WriteStream), renderer = new Renderer(new Director(makeFilm()));
  adapter.begin();
  try {
    for (const size of [{ columns: 220, rows: 60 }, { columns: 130, rows: 35 }, { columns: 240, rows: 64 }]) {
      chunks.length = 0;
      const frame = renderer.frame(36700, size, 'cn'), edge = `EDGE_${size.columns}x${size.rows}`;
      frame.text(size.columns - edge.length, size.rows - 1, edge);
      adapter.submit(frame, false, 36700);
      const text = Buffer.concat(chunks).toString();
      assert.ok(text.includes('内存'), `memory panel missing at ${size.columns}x${size.rows}`);
      assert.ok(text.includes('revision='), `watch panel missing at ${size.columns}x${size.rows}`);
      assert.ok(text.includes(edge), `bottom/right edge clipped at ${size.columns}x${size.rows}`);
    }
  } finally { await adapter.close(); }
});
test('backpressure bounds pending work and only encodes the latest dropped-frame replacement', async () => {
  const callbacks: (() => void)[] = [], submissions: number[] = [];
  let slow = true;
  const output = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { if (slow) callbacks.push(callback); else callback(); } });
  const adapter = new TerminalAdapter(output as NodeJS.WriteStream); adapter.onSubmission = item => submissions.push(item.storyMs);
  adapter.begin();
  for (const [time, glyph] of [[1, 'a'], [2, 'b'], [3, 'c']] as const) { const c = new Canvas(10, 3); c.text(0, 0, glyph); adapter.submit(c, false, time); }
  assert.deepEqual(submissions, [1]); assert.equal(adapter.dropped, 1);
  slow = false; while (callbacks.length) callbacks.shift()!(); await delay(10);
  assert.deepEqual(submissions, [1, 3]); await adapter.close();
});
