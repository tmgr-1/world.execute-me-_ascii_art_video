import { Canvas, color, graphemes, width, wrap, type Style } from './canvas.js';
import { countLocales, tr } from './locale.js';
import { clamp, hash, hex, mix, progress, smooth, timeCode } from './math.js';
import { activity, era } from './providers.js';
import { style, centerText } from './drawing.js';
import { filmViews } from './view-registry.js';
import { Director, type World } from './world.js';
import type { Film, Language, Rect, Size } from './types.js';
import glyphs from '../films/world-execute/assets/glyphs.json' with { type: 'json' };

export interface Layout { top: Rect; chat: Rect; simulation: Rect; input: Rect; status: Rect; main: Rect; side: Rect; inputRows: 6 | 7 }
export function layout(size: Size): Layout {
  if (size.columns < 130 || size.rows < 35) throw new Error('E_TERMINAL_SMALL');
  const preferred = size.rows >= 43, topH = preferred ? 2 : 1, chatH = preferred ? 8 : 6, inputRows = preferred ? 7 : 6;
  const simY = topH + chatH, simH = size.rows - simY - inputRows - 2 - 2, sideW = size.columns >= 150 ? 41 : 36;
  return { top: { x: 0, y: 0, w: size.columns, h: topH }, chat: { x: 0, y: topH, w: size.columns, h: chatH },
    simulation: { x: 0, y: simY, w: size.columns, h: simH },
    main: { x: 0, y: simY, w: size.columns - sideW, h: simH }, side: { x: size.columns - sideW, y: simY, w: sideW, h: simH },
    input: { x: 0, y: simY + simH, w: size.columns, h: inputRows + 2 }, status: { x: 0, y: size.rows - 2, w: size.columns, h: 2 }, inputRows };
}
const labelKey: Record<string, string> = { memory: 'ui.memory', wait: 'ui.wait', task: 'ui.tasks', log: 'ui.log', input: 'ui.input', stack: 'ui.stack', output: 'ui.output', state: 'ui.state' };
const countLanguages = ['de', 'es', 'fr', 'ko', 'sv', 'zh'];
const labelSteps: Record<string, number> = { task: 1, log: 2, input: 2, memory: 3, stack: 4, wait: 4, state: 5, output: 6 };
function label(world: World, lang: Language, key: string): { text: string; language: string } {
  const step = labelSteps[key];
  if (!world.terminated && step && world.state.count >= step) { const language = countLanguages[step - 1]; return { text: countLocales[language][key], language }; }
  return { text: tr(lang, labelKey[key] ?? key), language: lang };
}
function title(c: Canvas, r: Rect, world: World, lang: Language, semantic: string): void {
  const l = label(world, lang, semantic); c.box(r, l.text, color.faint, semantic, l.language);
}
export function wordArt(c: Canvas, word: string, rect: Rect, fg: number, bg = color.bg): void {
  const asset = glyphs[word as keyof typeof glyphs]; if (!asset) throw new Error(`E_GLYPH:${word}`);
  const source = asset.bitmap, sourceW = Math.max(...source.map(r => r.length)), sourceH = source.length;
  const factor = Math.min(1, rect.w / sourceW, rect.h / sourceH), w = Math.max(1, Math.round(sourceW * factor)), h = Math.max(1, Math.round(sourceH * factor));
  const x0 = rect.x + Math.floor((rect.w - w) / 2), y0 = rect.y + Math.floor((rect.h - h) / 2);
  c.regions.set('word-art', { x: x0, y: y0, w, h });
  const ink = { fg, bg };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (source[Math.floor(y / factor)]?.[Math.floor(x / factor)] === '#') c.set(x0 + x, y0 + y, '█', ink, `word-art.${word}`);
}
export const modalRect = (size: Size): Rect => ({ x: Math.floor((size.columns - Math.round(size.columns * .90)) / 2), y: Math.floor((size.rows - Math.round(size.rows * .89)) / 2), w: Math.round(size.columns * .90), h: Math.round(size.rows * .89) });

function input(c: Canvas, world: World, lang: Language, r: Rect, timeMs: number): void {
  title(c, r, world, lang, 'input');
  if (!world.session('open') && world.state.sent.length) c.text(r.x + r.w - 28, r.y, ` ${tr(lang, 'input.closed')} `, style(color.dim), 26);
  const interaction = world.session('open') ? world.film.interactions.find(i => timeMs >= i.compose[lang].start && timeMs < i.send) : undefined;
  let draft: string[] = [];
  if (interaction) {
    const track = interaction.compose[lang], text = graphemes(tr(lang, interaction.key));
    const p = progress(timeMs, track.start, track.complete), count = Math.min(text.length, Math.floor(p * (text.length + 1)));
    const cursor = Math.floor(timeMs / 400) % 2 === 0 ? '▌' : ' ';
    draft = wrap(`user> ${text.slice(0, count).join('')}${cursor}`, r.w - 4);
  }
  const rows = r.h - 2, historyCapacity = rows - Math.max(1, draft.length), history: string[][] = [];
  let occupied = 0;
  for (const request of [...world.state.sent].reverse()) {
    const group = wrap(`#${String(request.id).padStart(2, '0')} ${tr(lang, 'input.sent')}  ${tr(lang, request.key)}`, r.w - 4);
    if (occupied + group.length > historyCapacity) break;
    history.unshift(group); occupied += group.length;
  }
  let y = r.y + r.h - 2 - Math.max(1, draft.length) - occupied + 1;
  for (const group of history) for (const line of group) c.text(r.x + 2, y++, line, style(color.dim), r.w - 4);
  draft.forEach((line, i) => c.text(r.x + 2, r.y + r.h - 1 - draft.length + i, line, style(color.cyan, true), r.w - 4));
}
function conversation(c: Canvas, world: World, lang: Language, r: Rect, timeMs: number): void {
  c.box(r, tr(lang, 'ui.chat'), color.faint, 'chat', lang);
  const capacity = r.h - 2;
  const chatLines = world.state.chat.flatMap(item => {
    const tag = item.source === 'session' && item.requestId !== null ? `user #${String(item.requestId).padStart(2, '0')}>` : `[${item.source}]`;
    return wrap(`${tag} ${tr(lang, item.key)}`, r.w - 4).map(text => ({ text, source: item.source, requestId: item.requestId }));
  });
  let visible = chatLines.slice(-capacity);
  const active = [...world.film.interactions].reverse().find(i => i.send <= timeMs);
  if (active && timeMs <= active.holdUntil) {
    const request = world.state.sent.find(req => req.interactionId === active.id);
    if (request && !visible.some(line => line.source === 'session' && line.requestId === request.id)) {
      const pinned = chatLines.filter(line => line.source === 'session' && line.requestId === request.id);
      visible = [...pinned, ...visible.slice(-(capacity - pinned.length))].slice(0, capacity);
    }
  }
  visible.forEach((line, i) => c.text(r.x + 2, r.y + 1 + i, line.text, style(line.source === 'session' ? color.cyan : line.source === 'guard' ? color.red : color.text), r.w - 4));
}
function memoryAndWatch(c: Canvas, world: World, lang: Language, r: Rect, timeMs: number): void {
  const memoryH = Math.max(7, Math.floor(r.h * .46)), memory = { ...r, h: memoryH };
  title(c, memory, world, lang, 'memory');
  const a = world.store.allocation('me'), fields = world.store.layouts.get(a.type)!.fields;
  const fragmentOffset = world.store.field('me', 'fragments').offset;
  const bytesPerRow = r.w >= 40 ? 6 : 4;
  const focus = timeMs >= world.film.lyrics[44].startMs ? 'role' : timeMs >= world.film.lyrics[40].startMs ? 'gender'
    : ({ points: 'dimension', circle: 'radius', tangent: 'theta', infinity: 'boundary', current: 'currentMode', time: 'currentYear', align: 'phaseError', eggplant: 'nutrients', tomato: 'antioxidants', cat: 'purr' } as Record<string, string>)[world.state.motion?.kind ?? ''];
  const offset = world.state.erased.length ? fragmentOffset : focus ? Math.max(0, Math.floor(world.store.field('me', focus).offset / bytesPerRow) * bytesPerRow - bytesPerRow) : 0;
  for (let row = 0; row < memory.h - 3; row++) {
    const start = offset + row * bytesPerRow, address = a.address + start;
    c.text(r.x + 2, r.y + row + 2, address.toString(16).padStart(8, '0').toUpperCase(), style(color.dim));
    for (let b = 0; b < bytesPerRow; b++) {
      const at = address + b, allocated = at < a.address + a.size, value = world.store.bytes[at - world.store.base];
      const changed = [...world.store.changes.values()].some(ch => at >= ch.address && at < ch.address + ch.size && timeMs - ch.atMs < 350);
      const field = fields.find(field => at >= a.address + field.offset && at < a.address + field.offset + field.size);
      c.text(r.x + 11 + b * 3, r.y + row + 2, allocated ? value.toString(16).padStart(2, '0') : '··', style(changed ? color.gold : value === 0 ? color.faint : color.dim), 2, field ? `field.me.${field.name}` : undefined);
    }
    const ascii = Array.from({ length: bytesPerRow }, (_, b) => { const at = address + b; const byte = world.store.bytes[at - world.store.base]; return at >= a.address + a.size ? ' ' : byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.'; }).join('');
    c.text(r.x + 12 + bytesPerRow * 3, r.y + row + 2, `|${ascii}|`, style(color.faint), bytesPerRow + 2);
  }
  const watch = { x: r.x, y: r.y + memoryH, w: r.w, h: r.h - memoryH };
  title(c, watch, world, lang, world.state.count >= 4 ? 'stack' : 'state');
  const motion = world.state.motion?.kind;
  const rows: string[] = [`me=${hex(a.address)}`, `revision=${world.value('revision')}`, `verified_revision=${world.value('verified_revision')}`];
  if (motion === 'circle') rows.push(`r=${Number(world.value('radius')).toFixed(2)}  theta=${Number(world.value('theta')).toFixed(2)}`, `arc=${Number(world.value('arcLength')).toFixed(3)}`);
  else if (motion === 'current') rows.push(`current=${world.value('currentMode')}`, `vision=${world.value('vision') ? 'ON' : 'OFF'}`);
  else if (motion === 'time') rows.push(`target=${era(Number(world.value('targetYear')))}`, `current=${era(Number(world.value('currentYear')))}`);
  else if (timeMs >= world.film.lyrics[40].startMs) rows.push(`gender=${world.value('gender')} role=${world.value('role')}`, `lock=${world.value('lock') ? 1 : 0}`);
  else if (['eggplant','tomato','cat'].includes(motion ?? '')) { const field = motion === 'eggplant' ? 'nutrients' : motion === 'tomato' ? 'antioxidants' : 'purr'; rows.push(`form=${world.value('form')}`, `${field}=${world.value(field)}`); }
  else rows.push(`form=${world.value('form')}`, `dimension=${world.value('dimension')}`);
  const task = [...world.state.tasks].reverse().find(t => t.status !== 'COMPLETE' && t.status !== 'CANCELLED') ?? world.state.tasks.at(-1);
  if (task) rows.push(`#${task.id} ${task.status}`, `request_id=${task.requestId ?? 'null'}`, `PC=${task.pc} depth=${task.frames.length}`);
  rows.slice(0, watch.h - 2).forEach((line, i) => c.text(watch.x + 2, watch.y + i + 1, line, style(i === 1 && timeMs >= world.film.lyrics[40].startMs ? color.gold : color.dim), watch.w - 4));
  // Semantic label instances remain separate from the state data they annotate.
  for (const [semantic, y] of [['task', watch.y + watch.h - 1], ['wait', r.y + 1], ['output', r.y + memoryH - 1]] as const) {
    const l = label(world, lang, semantic); c.text(r.x + r.w - width(l.text) - 3, y, l.text, style(color.dim), r.w - 4, semantic, l.language);
  }
  void fields;
}

function damage(c: Canvas, world: World, t: number): void {
  const first = world.film.lyrics[40].startMs;
  if (t < first || t >= world.film.times.interrupt) return;
  const erasedAt = world.state.journal.find(e => e.kind === 'ERASE_FRAGMENT')?.atMs;
  const preCount = t < world.film.times.counts[0];
  const level = world.state.count ? .10 + world.state.count * .055 : t < world.film.lyrics[44].startMs ? .012 : erasedAt !== undefined && t >= erasedAt + 100 ? .065 : .035;
  const quantum = Math.floor(t / 90), garbage = ['#', '/', '\\', ':', ';', '|', '_', '.', '0', '1', '+', '='];
  const target = c.regions.get('target.tree');
  const regions = [...c.regions].filter(([key]) => ['main', 'memory', 'state', 'stack', 'input', 'chat'].includes(key));
  for (const [name, r] of regions) {
    if (preCount && ['input', 'chat'].includes(name)) continue;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (preCount && name === 'main' && t >= world.film.times.counts[0] - 4200 && (y === r.y + 2 || y === r.y + r.h - 3)) continue;
      if (preCount && target && x >= target.x && x < target.x + target.w && y >= target.y && y < target.y + target.h) continue;
      if (t < world.film.lyrics[44].startMs) {
        if (name === 'main' && (x < r.x + 7 || x > r.x + 40 || y < r.y + 4 || y > r.y + 10)) continue;
        if (name === 'memory' && y < r.y + Math.max(2, r.h - 4)) continue;
        if (name === 'state' && y > r.y + 4) continue;
      }
      if (erasedAt !== undefined && t - erasedAt < 100 && name === 'memory') continue;
      // Persistent scars use a stable hash. Their momentary replacement is sampled by story time.
      if (hash(world.seed, 'scar', name, x, y) >= level) continue;
      const cell = c.get(x, y)!;
      if (cell.semantic?.startsWith('word-art.')) {
        const word = c.regions.get('word-art')!;
        if (world.state.count < 6 || x > word.x + 1 && x < word.x + word.w - 2 && y > word.y + 1 && y < word.y + word.h - 2) continue;
      }
      if (cell.language && hash(world.seed, 'language-retention', x, y) < .7) continue;
      const n = hash(world.seed, name, x, y, quantum);
      if (n < .22) c.set(x, y, ' ', style(color.bg));
      else if (n < .48) c.set(x, y, garbage[Math.floor(n * 100) % garbage.length], style(n < .3 ? color.red : color.dim));
      else if (!cell.continuation) c.set(x, y, cell.g, { fg: n > .78 ? color.purple : color.red, bg: n > .94 ? color.faint : color.bg });
    }
  }
  if (world.state.count === 6) {
    // Every major band has a scar, including the former clean status strip.
    for (const r of [layout(c.size).top, layout(c.size).status, layout(c.size).input]) {
      for (let x = r.x + 1; x < r.x + r.w; x += 7) c.set(x, r.y, x % 3 ? ';' : ' ', style(color.red));
    }
  }
}

export class Renderer {
  private frozen = new Map<string, Canvas>();
  private history = new Map<string, Canvas>();
  constructor(readonly director: Director) {}
  normal(world: World, t: number, size: Size, lang: Language): Canvas {
    const c = new Canvas(size.columns, size.rows), l = layout(size), film = world.film;
    const scene = film.scenes.find(s => t >= s.startMs && t < s.endMs) ?? film.scenes.at(-1)!;
    const views = filmViews.get(film.id); if (!views) throw new Error(`E_FILM_VIEWS:${film.id}`);
    c.text(2, 0, 'world.execute(me);', style(color.cyan, true));
    const top = `${String(scene.number).padStart(2, '0')}/25   ${hex(world.store.allocation('me').address)}   ${String(world.value('status'))}`;
    c.text(c.columns - width(top) - 3, 0, top, style(color.dim));
    if (t >= film.times.holdEnd) views.hostView(c, world, lang, l, t);
    else { conversation(c, world, lang, l.chat, t); views.graphic(c, world, lang, l.main, t); memoryAndWatch(c, world, lang, l.side, t); }
    input(c, world, lang, l.input, t);
    const status = `session=${world.session('open') ? 1 : 0}   rx=${world.session('open') ? activity(world, 'rx', t).toFixed(2) : '0'}   ack_seq=${world.session('ackSeq')}   request_id=${world.state.sent.at(-1)?.id ?? 'null'}`;
    c.text(2, l.status.y, status, style(color.dim), c.columns - 4);
    const stateLabel = label(world, lang, 'state');
    c.text(c.columns - width(stateLabel.text) - 3, l.status.y, stateLabel.text, style(color.dim), 20, 'state', stateLabel.language);
    const bottom = `${timeCode(t)} / ${timeCode(film.durationMs)}    seed=${world.seed}`;
    c.text(2, l.status.y + 1, bottom, style(color.faint));
    c.text(c.columns - 41, l.status.y + 1, t >= film.times.interrupt ? 'process=TERMINATED  applied=0' : `Space:${tr(lang, 'controls.pause')}  q:${tr(lang, 'controls.quit')}`, style(color.faint), 39);
    const logLabel = label(world, lang, 'log'); c.text(c.columns - width(logLabel.text) - 2, l.chat.y, logLabel.text, style(color.dim), 20, 'log', logLabel.language);
    if (world.state.count && t < film.times.interrupt) {
      const word = ['Ein', 'dos', 'trois', '네', 'Fem', '六'][world.state.count - 1];
      wordArt(c, word, { x: 6, y: Math.floor(c.rows / 2) - 9, w: c.columns - 12, h: 18 }, color.text);
    }
    // Flashback tiles use a canonical normal-circle sample, never a previous output frame.
    if (t >= film.lyrics[44].startMs && t < film.times.counts[0] && Math.floor(t / 180) % 11 === 0) {
      const key = `${size.columns}:${size.rows}:${lang}`;
      let previous = this.history.get(key);
      if (!previous) {
        const oldWorld = new Director(film, world.seed).at(film.lyrics[11].endMs);
        previous = new Canvas(c.columns, c.rows); views.graphic(previous, oldWorld, lang, l.main, film.lyrics[11].endMs);
        if (this.history.size >= 4) this.history.clear(); this.history.set(key, previous);
      }
      for (let y = l.main.y + 4; y < l.main.y + 7; y++) for (let x = l.main.x + 8; x < l.main.x + 26; x++) {
        const old = previous.get(x, y)!; if (!old.continuation && old.g !== ' ') c.set(x, y, old.g, style(color.purple));
      }
    }
    damage(c, world, t);
    if (t >= film.times.intent && t < film.times.interrupt) {
      c.text(Math.max(3, Math.floor(c.columns / 2) - 19), Math.floor(c.rows / 2) + 7, 'dispose(me)  status=INTENT_VISIBLE', { fg: color.gold, bg: color.bg, bold: true }, 42);
      // Damage resolves a wide glyph crossing the future modal edge into two
      // single cells before capture, so overlaying cannot erase an outside cell.
      const rect = modalRect(size);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (const x of [rect.x, rect.x + rect.w]) {
        if (c.get(x, y)?.continuation) { c.set(x - 1, y, '#', style(color.dim)); c.set(x, y, ';', style(color.red)); }
      }
    }
    return c;
  }
  frame(timeMs: number, size: Size, lang: Language): Canvas {
    const film = this.director.film, finalTime = film.lyrics[92].startMs;
    const time = timeMs >= finalTime ? finalTime : Math.max(0, Math.round(timeMs));
    const world = this.director.at(time);
    if (time >= film.times.interrupt && time < film.times.holdEnd) {
      const key = `${size.columns}:${size.rows}:${lang}:${world.seed}`;
      let result = this.frozen.get(key);
      if (!result) {
        const before = new Director(film, world.seed).at(film.times.interrupt - 1);
        result = this.normal(before, film.times.interrupt - 1, size, lang);
        const rect = modalRect(size); result.fill(rect, ' ', { fg: color.ink, bg: color.paper });
        const titleRect = { x: rect.x + 6, y: rect.y + 5, w: rect.w - 12, h: rect.h - 15 };
        wordArt(result, lang === 'cn' ? '终止' : 'TERMINATED', titleRect, color.ink, color.paper);
        const text = 'PROCESS_TERMINATED';
        centerText(result, rect.y + rect.h - 8, text, color.ink, rect);
        // centerText uses the default background; apply the paper background to every modal cell.
        centerText(result, rect.y + rect.h - 5, tr(lang, 'guard.message'), color.ink, rect);
        for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const cell = result.get(x, y)!; cell.bg = color.paper; cell.fg = color.ink; }
        result.regions.set('termination', rect);
        if (this.frozen.size >= 4) this.frozen.clear(); this.frozen.set(key, result);
      }
      return result;
    }
    return this.normal(world, time, size, lang);
  }
  slate(size: Size, lang: Language, state: 'app.ready' | 'app.paused' | 'error.terminal_small' | 'app.eof', details = ''): Canvas {
    const c = new Canvas(Math.max(1, size.columns), Math.max(1, size.rows));
    const mid = Math.floor(c.rows / 2);
    centerText(c, Math.max(0, mid - 3), 'world.execute(me);', color.cyan);
    centerText(c, mid, tr(lang, state, { columns: 130, rows: 35 }), color.text);
    if (details) centerText(c, Math.min(c.rows - 1, mid + 2), details, color.dim);
    if (state === 'app.ready') {
      centerText(c, Math.max(0, mid - 1), tr(lang, 'ui.canvas_size', { columns: size.columns, rows: size.rows }), color.dim);
      centerText(c, Math.min(c.rows - 1, mid + 4), tr(lang, 'app.controls'), color.dim);
    }
    return c;
  }
}
