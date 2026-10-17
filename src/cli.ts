#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { makeFilm } from '../films/world-execute/manifest.js';
import sourceTiming from '../films/world-execute/anchors.json' with { type: 'json' };
import { tr } from './locale.js';
import { parseLoop, parseTime, timeCode } from './math.js';
import { validateFilm } from './validate.js';
import { play } from './app.js';
import { Director } from './world.js';
import { Renderer } from './render.js';
import type { Canvas } from './canvas.js';
import type { Anchor, Film, Language, Size } from './types.js';

const optionSpec = {
  'music-file': { type: 'string' }, film: { type: 'string', default: 'world-execute' }, lang: { type: 'string', default: 'cn' },
  rehearsal: { type: 'boolean', default: false }, seek: { type: 'string', default: '0' }, speed: { type: 'string', default: '1' },
  'offset-ms': { type: 'string', default: '0' }, 'origin-audio-ms': { type: 'string' }, seed: { type: 'string' },
  'mpv-path': { type: 'string', default: 'mpv' }, 'no-color': { type: 'boolean', default: false },
  'null-audio': { type: 'boolean', default: false }, 'hold-end': { type: 'boolean', default: false },
  fps: { type: 'string', default: '30' }, 'export-dir': { type: 'string' }, anchors: { type: 'string' },
  release: { type: 'boolean', default: false }, size: { type: 'string', default: '160x45' },
  time: { type: 'string', default: '0' }, output: { type: 'string' }, format: { type: 'string', default: 'text' },
  'anchor-id': { type: 'string' }, 'at-ms': { type: 'string' }, reviewed: { type: 'boolean', default: false },
  'approve-reviewed': { type: 'boolean', default: false }, 'review-note': { type: 'string' },
  step: { type: 'string', default: '250' }, help: { type: 'boolean', short: 'h', default: false },
  loop: { type: 'string' },
} as const;
const finite = (value: string | undefined, fallback: number, code: string): number => { const n = value === undefined ? fallback : Number(value); if (!Number.isFinite(n)) throw new Error(code); return n; };
export async function audioFingerprint(path: string): Promise<string> { return createHash('sha256').update(await readFile(resolve(path))).digest('hex'); }
async function save(path: string, content: string): Promise<void> { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(path, content); }
function palette(n: number): string {
  if (n >= 232) { const shade = 8 + (n - 232) * 10; return `rgb(${shade},${shade},${shade})`; }
  if (n >= 16) { const value = n - 16, channel = (n: number): number => n ? 55 + n * 40 : 0; return `rgb(${channel(Math.floor(value / 36))},${channel(Math.floor(value / 6) % 6)},${channel(value % 6)})`; }
  return ['#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0','#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'][n] ?? '#ffffff';
}
const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function frameHtml(canvas: Canvas): string {
  let html = '<!doctype html><meta charset="utf-8"><title>world.execute(me); — frame</title><style>body{margin:0;padding:24px;background:#101112;display:grid;place-items:center;min-height:95vh}pre{margin:0;background:#000;font:14px/18px "DejaVu Sans Mono","Noto Sans Mono CJK SC",monospace;white-space:pre;font-variant-ligatures:none}</style><pre>';
  for (let y = 0; y < canvas.rows; y++) {
    let previous = '', open = false;
    for (let x = 0; x < canvas.columns; x++) {
      const cell = canvas.get(x, y)!; if (cell.continuation) continue;
      const css = `color:${palette(cell.fg)};background:${palette(cell.bg)}${cell.bold ? ';font-weight:bold' : ''}`;
      if (css !== previous) { if (open) html += '</span>'; html += `<span style="${css}">`; previous = css; open = true; }
      html += escape(cell.g);
    }
    if (open) html += '</span>'; html += '\n';
  }
  return html + '</pre>\n';
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length - 1; i++) if (['--offset-ms', '--origin-audio-ms', '--seed', '--at-ms', '--speed'].includes(args[i]) && /^-\d/.test(args[i + 1])) args.splice(i, 2, `${args[i]}=${args[i + 1]}`);
  const { values, positionals } = parseArgs({ args, options: optionSpec, strict: true, allowPositionals: true });
  if (!['cn', 'en'].includes(values.lang)) throw new Error('E_LANGUAGE');
  const lang = values.lang as Language, command = positionals[0] ?? 'play';
  if (values.help) {
    process.stdout.write(`${tr(lang, 'help.usage')}: ascii-film ${tr(lang, 'help.commands')}\n${tr(lang, 'help.music_file')}\n\n` +
      'npm run play -- --music-file "./song.mp3" --lang cn --rehearsal\n' +
      'npm run check\n--loop mm:ss..mm:ss (rehearsal)\n' +
      'npm run render -- --time 02:39 --size 160x45 --format html --output .cache/frame.html\n\n' +
      '--film world-execute --lang cn|en --seek mm:ss --speed 0.25..2\n--offset-ms N --origin-audio-ms N --seed N --mpv-path PATH\n--rehearsal --no-color --hold-end --fps 24|30 --anchors FILE\n--export-dir DIR --null-audio\n' + tr(lang, 'app.rehearsal_controls') + '\n'); return;
  }
  if (positionals.length > 1 || values.film !== 'world-execute') throw new Error('E_FILM_OR_COMMAND');
  let timing = structuredClone(sourceTiming) as typeof sourceTiming & { reviewNote?: string };
  if (values.anchors) timing = JSON.parse(await readFile(values.anchors, 'utf8')) as typeof timing;
  const film: Film = makeFilm(timing.anchors as Anchor[]);
  film.audioSha256 = timing.audioSha256; film.originAudioMs = timing.originAudioMs;
  if (command === 'calibrate') {
    if (!values.output) throw new Error('E_OUTPUT_REQUIRED');
    if (values['approve-reviewed']) {
      if (!values['review-note']) throw new Error('E_REVIEW_NOTE_REQUIRED');
      timing.anchors.forEach(anchor => { anchor.status = 'calibrated'; }); timing.reviewed = true; timing.reviewNote = values['review-note'];
    } else {
      const anchor = timing.anchors.find(a => a.id === values['anchor-id']);
      if (!anchor || values['at-ms'] === undefined) throw new Error('E_ANCHOR_AND_TIME_REQUIRED');
      anchor.atMs = finite(values['at-ms'], 0, 'E_TIME'); anchor.status = values.reviewed ? 'calibrated' : 'rough';
      timing.reviewed = timing.anchors.every(a => a.status === 'calibrated');
    }
    const check = validateFilm(makeFilm(timing.anchors as Anchor[])); if (check.errors.length) throw new Error(check.errors.join('\n'));
    await save(values.output, JSON.stringify(timing, null, 2) + '\n'); process.stdout.write(tr(lang, 'calibrate.marked') + '\n'); return;
  }
  const validation = validateFilm(film, values.release || command === 'play' && !values.rehearsal, command === 'check' ? 'full' : command === 'play' ? 'model' : 'content');
  if (validation.errors.length) {
    if (validation.errors.some(e => e.startsWith('E_ANCHOR_ROUGH'))) throw new Error(tr(lang, 'error.uncalibrated'));
    throw new Error(`${tr(lang, 'error.check_failed', { code: validation.errors[0] })}\n${validation.errors.join('\n')}`);
  }
  if (values['music-file']) {
    try { await access(resolve(values['music-file'])); }
    catch { throw new Error(tr(lang, 'error.audio_missing', { path: values['music-file'] })); }
    const fingerprint = await audioFingerprint(values['music-file']);
    if (fingerprint !== film.audioSha256 && !values.rehearsal) throw new Error(tr(lang, 'error.fingerprint'));
  }
  if (command === 'check') {
    process.stdout.write(tr(lang, validation.warnings.length ? 'check.rough' : values.release ? 'check.release' : 'check.complete') + '\n');
    validation.warnings.forEach(warning => process.stdout.write(warning + '\n')); return;
  }
  if (command === 'play') {
    if (!values['music-file']) throw new Error(tr(lang, 'help.music_file'));
    if (values['null-audio'] && !values.rehearsal) throw new Error('E_NULL_AUDIO_REQUIRES_REHEARSAL');
    let loop: { startMs: number; endMs: number } | undefined;
    if (values.loop !== undefined) {
      try { loop = parseLoop(values.loop); } catch { throw new Error(tr(lang, 'error.loop')); }
    }
    if (loop && !values.rehearsal) throw new Error(tr(lang, 'error.loop'));
    const speed = finite(values.speed, 1, 'E_SPEED'), fps = finite(values.fps, 30, 'E_FPS');
    if (speed < .25 || speed > 2 || fps < 10 || fps > 60) throw new Error('E_SPEED_OR_FPS');
    await play(film, { musicFile: values['music-file'], language: lang, rehearsal: values.rehearsal, seekMs: loop ? loop.startMs : parseTime(values.seek), speed, loop,
      offsetMs: finite(values['offset-ms'], 0, 'E_OFFSET'), originMs: finite(values['origin-audio-ms'], film.originAudioMs, 'E_ORIGIN'),
      seed: finite(values.seed, film.defaultSeed, 'E_SEED'), mpvPath: values['mpv-path'], noColor: values['no-color'], nullAudio: values['null-audio'], holdEnd: values['hold-end'], fps, exportDir: values['export-dir'] }); return;
  }
  const match = /^(\d+)x(\d+)$/.exec(values.size); if (!match) throw new Error('E_SIZE');
  const dimensions: Size = { columns: Number(match[1]), rows: Number(match[2]) };
  const renderer = new Renderer(new Director(film, finite(values.seed, film.defaultSeed, 'E_SEED')));
  if (command === 'render') {
    const frame = renderer.frame(parseTime(values.time), dimensions, lang);
    const result = values.format === 'html' ? frameHtml(frame) : values.format === 'json' ? JSON.stringify({ size: dimensions, cells: frame.cells }, null, 2) + '\n' : values.format === 'text' ? frame.plain() + '\n' : (() => { throw new Error('E_FORMAT'); })();
    if (values.output) await save(values.output, result); else process.stdout.write(result); return;
  }
  if (command === 'benchmark') {
    const timings: number[] = [], step = finite(values.step, 250, 'E_STEP'); if (step < 10) throw new Error('E_STEP');
    let peakRss = process.memoryUsage().rss;
    for (let t = 0; t < film.presentationEndMs; t += step) { const start = performance.now(); renderer.frame(t, dimensions, lang); timings.push(performance.now() - start); peakRss = Math.max(peakRss, process.memoryUsage().rss); }
    timings.sort((a, b) => a - b);
    const report = { environment: { os: process.platform, arch: process.arch, cpu: cpus()[0]?.model, node: process.version, size: dimensions, language: lang },
      samples: timings.length, meanMs: timings.reduce((a, b) => a + b, 0) / timings.length, p95Ms: timings[Math.floor(timings.length * .95)], maxMs: timings.at(-1), peakRssMiB: peakRss / 1048576, memory: process.memoryUsage(),
      scope: 'Deterministic model and frame composition; excludes terminal transport, mpv and audible synchronization.', anchors: timing.reviewed ? 'calibrated' : 'machine estimates, unreviewed' };
    const result = JSON.stringify(report, null, 2) + '\n'; if (values.output) await save(values.output, result); else process.stdout.write(result); return;
  }
  throw new Error('E_COMMAND');
}
if (process.argv[1] && /(?:^|[/\\])cli\.(?:ts|js)$/.test(process.argv[1])) main().catch(error => {
  const arg = process.argv.indexOf('--lang'), lang: Language = process.argv.includes('--lang=en') || arg >= 0 && process.argv[arg + 1] === 'en' ? 'en' : 'cn';
  const flag = (name: string, fallback: string): string => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1) ?? fallback; };
  let detail = error instanceof Error ? error.message : String(error);
  if (detail.startsWith('E_PLAYER_MISSING')) detail = tr(lang, 'error.player_missing', { path: flag('--mpv-path', 'mpv') });
  else if (detail.startsWith('E_IPC_TIMEOUT')) detail = tr(lang, 'error.ipc_timeout', { operation: detail.split(':')[1] ?? 'IPC' });
  else if (detail.startsWith('E_IPC_DISCONNECTED') || ['ECONNRESET', 'EPIPE'].includes(error?.code)) detail = tr(lang, 'error.ipc_disconnected');
  else if (detail.startsWith('E_AUDIO_FAILED')) detail = tr(lang, 'error.audio_failed', { path: flag('--music-file', '') });
  else if (error?.code?.startsWith('ERR_PARSE_ARGS')) detail = tr(lang, 'error.options', { detail: error.code });
  process.stderr.write(tr(lang, 'error.failed', { detail }) + '\n'); process.exitCode = 1;
});
