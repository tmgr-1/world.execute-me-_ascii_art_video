import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { emitKeypressEvents, type Key } from 'node:readline';
import { MpvTransport } from './audio.js';
import { TerminalAdapter } from './terminal.js';
import { Director } from './world.js';
import { layout, Renderer } from './render.js';
import { tr } from './locale.js';
import { clamp, timeCode } from './math.js';
import type { Film, Language, Size } from './types.js';

export interface PlayOptions { musicFile: string; language: Language; rehearsal: boolean; seekMs: number; speed: number; offsetMs: number; originMs: number; seed: number; mpvPath: string; noColor: boolean; nullAudio: boolean; holdEnd: boolean; fps: number; exportDir?: string; loop?: { startMs: number; endMs: number } }
export async function play(film: Film, options: PlayOptions): Promise<void> {
  const lang = options.language;
  if (!process.stdout.isTTY || !process.stdin.isTTY) throw new Error(tr(lang, 'error.not_tty'));
  const size = (): Size => ({ columns: process.stdout.columns, rows: process.stdout.rows });
  const validSize = (): boolean => size().columns >= 130 && size().rows >= 35;
  if (!validSize()) throw new Error(tr(lang, 'error.terminal_small', { columns: 130, rows: 35 }));
  try { await access(options.musicFile, constants.R_OK); } catch { throw new Error(tr(lang, 'error.audio_unreadable', { path: options.musicFile })); }
  const audio = new MpvTransport(options.mpvPath, options.nullAudio), terminal = new TerminalAdapter(process.stdout, options.noColor);
  const director = new Director(film, options.seed), renderer = new Renderer(director);
  let state: 'READY' | 'PLAYING' | 'PAUSED' | 'SEEKING' | 'FINISHED' = 'READY';
  let force = true, resized = false, closing = false, operation = false, offset = options.offsetMs;
  let interval: NodeJS.Timeout | undefined, doneResolve!: () => void, doneReject!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
  const quitToken = Symbol('quit'); let quitRequested = false;
  // A player can fail during the preload, before the main await of `done`.
  done.catch(() => {});
  terminal.onFailure = error => doneReject(error);
  const renderTimes: number[] = [], encodeTimes: number[] = [], critical: { id: string; atMs: number; submittedAtMs?: number; errorMs?: number }[] = [
    ...film.interactions.map(i => ({ id: `send.${i.id}`, atMs: i.send })),
    { id: 'intent', atMs: film.times.intent }, { id: 'interrupt', atMs: film.times.interrupt },
  ];
  const markers: { id: string; atMs: number; mediaMs: number; source: string }[] = [];
  const story = (): number => audio.clock.read() - options.originMs + offset;
  let previousSubmit: number | undefined;
  terminal.onSubmission = submission => {
    encodeTimes.push(submission.encodeMs);
    if (state === 'READY') return;
    const actual = story();
    const previous = previousSubmit ?? options.seekMs - options.originMs + offset - 1;
    for (const node of critical) if (node.submittedAtMs === undefined && submission.storyMs >= node.atMs && previous < node.atMs) {
      node.submittedAtMs = actual; node.errorMs = actual - node.atMs;
    }
    previousSubmit = submission.storyMs;
  };
  const draw = (): void => {
    if (closing || state === 'SEEKING') return;
    try {
      const started = performance.now(), t = clamp(story(), 0, film.durationMs), dimensions = size();
      let frame;
      if (!validSize()) frame = renderer.slate(dimensions, lang, 'error.terminal_small');
      else if (state === 'READY') frame = renderer.slate(dimensions, lang, 'app.ready', options.rehearsal ? tr(lang, 'app.rough') : '');
      else {
        frame = renderer.frame(t, dimensions, lang);
        if (options.rehearsal && t < film.times.counts[0]) {
          // Calibration diagnostics stay inside the story status bar, away from captions.
          const y = layout(dimensions).status.y + 1, w = dimensions.columns - 42;
          const lyric = film.lyrics.findLast(line => line.startMs <= t);
          frame.fill({ x: 0, y, w, h: 1 });
          frame.text(2, y, `${timeCode(t)}  offset=${offset}ms  lyric.${String(lyric?.number ?? 1).padStart(2, '0')}`, { fg: 244 }, w - 4);
        }
      }
      terminal.submit(frame, force, t); force = false; renderTimes.push(performance.now() - started);
    } catch (error) { doneReject(error as Error); }
  };
  const seek = async (targetMs: number): Promise<void> => {
    const playing = state === 'PLAYING'; state = 'SEEKING';
    const position = await audio.seek(targetMs); director.at(Math.max(0, position - options.originMs + offset)); previousSubmit = position - options.originMs + offset - 1;
    state = 'PAUSED'; force = true; draw();
    if (playing && validSize()) { await audio.setPaused(false); state = 'PLAYING'; }
  };
  const onKey = async (_text: string, key: Key): Promise<void> => {
    if (key.name === 'q' || key.name === 'escape' || key.ctrl && key.name === 'c') { doneResolve(); return; }
    if (operation || closing) return; operation = true;
    try {
      if (key.name === 'return' && state === 'READY' && validSize()) { await audio.setPaused(false); state = 'PLAYING'; force = true; }
      else if (key.name === 'space' && ['PLAYING', 'PAUSED'].includes(state) && validSize()) {
        const pause = state === 'PLAYING'; await audio.setPaused(pause); state = pause ? 'PAUSED' : 'PLAYING'; resized = false;
      } else if (options.rehearsal && ['left', 'right'].includes(key.name ?? '') && state !== 'READY' && state !== 'FINISHED') await seek(audio.clock.read() + (key.name === 'right' ? 5000 : -5000));
      else if (options.rehearsal && ['up', 'down'].includes(key.name ?? '') && state !== 'READY' && state !== 'FINISHED') {
        const playing = state === 'PLAYING'; await audio.setPaused(true); state = 'PAUSED'; offset += key.name === 'up' ? 20 : -20;
        director.at(Math.max(0, story())); force = true; draw(); if (playing) { await audio.setPaused(false); state = 'PLAYING'; }
      } else if (options.rehearsal && ['[', ']'].includes(_text) && state !== 'READY' && state !== 'FINISHED') {
        const index = Math.max(0, film.lyrics.findLastIndex(l => l.startMs <= story()));
        const target = film.lyrics[clamp(index + (_text === ']' ? 1 : -1), 0, 92)].startMs + options.originMs - offset;
        await seek(target);
      } else if (options.rehearsal && key.name === 'a' && options.exportDir && state !== 'READY') {
        const lyric = [...film.lyrics].reverse().find(l => l.startMs <= story());
        markers.push({ id: `lyric.${String(lyric?.number ?? 1).padStart(2, '0')}.start`, atMs: Math.round(story()), mediaMs: Math.round(audio.clock.read()), source: 'rehearsal-key-marker' });
      }
      draw();
    } catch (error) { doneReject(error as Error); } finally { operation = false; }
  };
  const onResize = async (): Promise<void> => {
    if (closing) return;
    try {
      if (!validSize()) { if (state === 'PLAYING') await audio.setPaused(true); if (state !== 'READY') state = 'PAUSED'; resized = true; }
      // Restoring a legal size never resumes playback on its own.
      force = true; draw();
    } catch (error) { doneReject(error as Error); }
  };
  const quit = (): void => { quitRequested = true; doneResolve(); };
  const wasRaw = process.stdin.isRaw;
  const onEnded = (): void => { state = 'FINISHED'; force = true; draw(); if (!options.holdEnd) doneResolve(); };
  try {
    process.on('SIGINT', quit); process.on('SIGTERM', quit);
    audio.on('failure', error => doneReject(error as Error)); audio.on('ended', onEnded);
    await Promise.race([audio.load(resolve(options.musicFile)), done.then(() => { if (quitRequested) throw quitToken; })]);
    if (quitRequested) return;
    if (Math.abs(audio.durationMs - film.durationMs) > 2500 || film.anchors.some(a => a.atMs > audio.durationMs)) throw new Error(tr(lang, 'error.duration'));
    if (options.seekMs >= audio.durationMs) throw new Error(tr(lang, 'error.options', { detail: 'E_SEEK_RANGE' }));
    if (options.loop && options.loop.endMs > audio.durationMs - 250) throw new Error(tr(lang, 'error.loop'));
    await audio.setSpeed(options.speed); if (options.seekMs > 0) await audio.seek(options.seekMs);
    terminal.begin(); emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('keypress', onKey); process.stdout.on('resize', onResize);
    draw(); interval = setInterval(() => {
      if (options.loop && state === 'PLAYING' && !operation && audio.clock.read() >= options.loop.endMs) {
        operation = true;
        void seek(options.loop.startMs).catch(doneReject).finally(() => { operation = false; });
      } else draw();
    }, 1000 / options.fps);
    await done;
  } catch (error) { if (error !== quitToken) throw error; }
  finally {
    closing = true; if (interval) clearInterval(interval);
    process.stdin.off('keypress', onKey); process.stdout.off('resize', onResize); process.off('SIGINT', quit); process.off('SIGTERM', quit);
    try { await audio.close(); } finally { if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false); process.stdin.pause(); await terminal.close(); }
    if (options.exportDir) {
      const destination = resolve(options.exportDir); await mkdir(destination, { recursive: true });
      const sorted = [...renderTimes].sort((a, b) => a - b);
      const report = { environment: { platform: process.platform, arch: process.arch, node: process.version, size: size(), mpv: options.mpvPath, audioDevice: options.nullAudio ? 'null (integration test only)' : 'system default, unmeasured', terminal: process.env.TERM ?? 'unknown', font: 'not measured' },
        metrics: { frames: renderTimes.length, meanFrameMs: renderTimes.reduce((a, b) => a + b, 0) / Math.max(1, renderTimes.length), p95FrameMs: sorted[Math.floor(sorted.length * .95)] ?? 0, meanEncodeMs: encodeTimes.reduce((a,b)=>a+b,0)/Math.max(1,encodeTimes.length), rssBytes: process.memoryUsage().rss, dropped: terminal.dropped, bytes: terminal.bytes, ipcAgeMs: audio.clock.ageMs },
        critical, syncFailures: critical.filter(cue => cue.errorMs !== undefined && (cue.errorMs > 80 || cue.id === 'intent' && cue.submittedAtMs! >= film.times.interrupt)), markers, resized, anchorStatus: film.anchors.some(a => a.status === 'rough') ? 'unreviewed' : 'calibrated', synchronization: 'Submission timing only; sound-to-screen latency is not measured.' };
      await writeFile(join(destination, 'performance.json'), JSON.stringify(report, null, 2) + '\n');
      await writeFile(join(destination, 'events.json'), JSON.stringify(director.world.state.journal, null, 2) + '\n');
      if (markers.length) await writeFile(join(destination, 'review-markers.json'), JSON.stringify(markers, null, 2) + '\n');
    }
  }
}
