import { Canvas, color, graphemes, width, wrap, type Style } from './canvas.js';
import { countLocales, tr } from './locale.js';
import { clamp, hex, progress, timeCode } from './math.js';
import { activity, era } from './providers.js';
import { style, centerText } from './drawing.js';
import { filmViews } from './view-registry.js';
import { Director, type World } from './world.js';
import type { Film, Language, Rect, Size } from './types.js';
import glyphs from '../films/world-execute/assets/glyphs.json' with { type: 'json' };
import { countLanguages, stopCode } from '../films/world-execute/story.js';
import { corrupt } from './corruption.js';
import { subtitleLines } from './subtitles.js';
import { visibleLog } from './event-log.js';

const glyphVariants = new Map<string, { bitmap: string[]; w: number; h: number }[]>();
for (const asset of Object.values(glyphs)) {
  const variants = glyphVariants.get(asset.sourceText) ?? [];
  variants.push({ bitmap: asset.bitmap, w: asset.bitmap[0].length, h: asset.bitmap.length });
  variants.sort((a, b) => b.w - a.w);
  glyphVariants.set(asset.sourceText, variants);
}

export interface Layout { top: Rect; chat: Rect; simulation: Rect; input: Rect; status: Rect; main: Rect; side: Rect; story: Rect; subtitles: Rect; inputRows: 6 | 7 }
export function layout(size: Size): Layout {
  if (size.columns < 130 || size.rows < 35) throw new Error('E_TERMINAL_SMALL');
  const storyH = size.rows - 2, preferred = storyH >= 43, topH = preferred ? 2 : 1, chatH = preferred ? 8 : 6, inputRows = preferred ? 7 : 6;
  const simY = topH + chatH, simH = storyH - simY - inputRows - 2 - 2, sideW = size.columns >= 150 ? 41 : 36;
  return { top: { x: 0, y: 0, w: size.columns, h: topH }, chat: { x: 0, y: topH, w: size.columns, h: chatH },
    simulation: { x: 0, y: simY, w: size.columns, h: simH },
    main: { x: 0, y: simY, w: size.columns - sideW, h: simH }, side: { x: size.columns - sideW, y: simY, w: sideW, h: simH },
    input: { x: 0, y: simY + simH, w: size.columns, h: inputRows + 2 }, status: { x: 0, y: storyH - 2, w: size.columns, h: 2 },
    story: { x: 0, y: 0, w: size.columns, h: storyH }, subtitles: { x: 0, y: storyH, w: size.columns, h: 2 }, inputRows };
}
const labelKey: Record<string, string> = { memory: 'ui.memory', wait: 'ui.wait', task: 'ui.tasks', log: 'ui.chat', input: 'ui.input', stack: 'ui.stack', output: 'ui.output', state: 'ui.state' };
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
  const variants = glyphVariants.get(word);
  const asset = variants?.find(asset => asset.w <= rect.w && asset.h <= rect.h) ?? variants?.at(-1);
  if (!asset) throw new Error(`E_GLYPH:${word}`);
  const source = asset.bitmap, sourceW = asset.w, sourceH = asset.h;
  const factor = Math.min(1, rect.w / sourceW, rect.h / sourceH), w = Math.max(1, Math.round(sourceW * factor)), h = Math.max(1, Math.round(sourceH * factor));
  const x0 = rect.x + Math.floor((rect.w - w) / 2), y0 = rect.y + Math.floor((rect.h - h) / 2);
  c.regions.set('word-art', { x: x0, y: y0, w, h });
  c.regions.set(`word-art.${word}`, { x: x0, y: y0, w, h });
  const ink = { fg, bg };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (source[Math.floor(y / factor)]?.[Math.floor(x / factor)] === '#') c.set(x0 + x, y0 + y, '█', ink, `word-art.${word}`);
}
export function modalRect(size: Size, lang: Language = 'cn'): Rect {
  const l = layout(size), minY = l.chat.y + l.chat.h + 1, available = l.story.h - minY - 1;
  const asset = glyphVariants.get('程序已被终止')!.find(a => a.w <= size.columns - 4 && a.h + 6 <= available)!;
  const h = lang === 'cn' ? asset.h + 6 : 21;
  return { x: 1, y: clamp(Math.floor((l.story.h - h) / 2), minY, l.story.h - h - 1), w: size.columns - 2, h };
}

function input(c: Canvas, world: World, lang: Language, r: Rect, timeMs: number): void {
  title(c, r, world, lang, 'input');
  const closed = !world.session('open') && world.state.sent.length > 0;
  if (closed) c.text(r.x + 2, r.y + 1, `× ${tr(lang, 'input.closed')}  ·  ${tr(lang, 'ui.no_receiver')}`, style(color.red, true), r.w - 4, 'session.closed');
  const connected = world.session('open') === true;
  const interaction = connected ? world.film.interactions.find(i => timeMs >= i.compose[lang].start && timeMs < i.recordAtMs) : undefined;
  let draft: string[] = [];
  if (connected) {
    const text = interaction ? graphemes(tr(lang, interaction.key)) : [];
    const track = interaction?.compose[lang];
    const p = track ? progress(timeMs, track.start, track.complete) : 0, count = Math.min(text.length, Math.floor(p * (text.length + 1)));
    const openedAt = world.state.chat.find(item => item.key === 'session.connected')!.atMs;
    const cursor = Math.floor((timeMs - openedAt) / 400) % 2 === 0 ? '_' : ' ';
    draft = wrap(`user > ${text.slice(0, count).join('')}${cursor}`, r.w - 4);
  }
  const rows = r.h - 2, historyCapacity = rows - Math.max(1, draft.length) - (closed ? 1 : 0), history: string[][] = [];
  let occupied = 0;
  for (const request of [...world.state.sent].reverse()) {
    if (timeMs < world.film.interactions.find(i => i.id === request.interactionId)!.recordAtMs) continue;
    const group = wrap(`#${String(request.id).padStart(2, '0')} ${tr(lang, 'input.sent')}  ${tr(lang, request.key)}`, r.w - 4);
    if (occupied + group.length > historyCapacity) break;
    history.unshift(group); occupied += group.length;
  }
  let y = r.y + r.h - 2 - Math.max(1, draft.length) - occupied + 1;
  for (const group of history) for (const line of group) c.text(r.x + 2, y++, line, style(color.green), r.w - 4, 'input.sent');
  draft.forEach((line, i) => c.text(r.x + 2, r.y + r.h - 1 - draft.length + i, line, style(color.green), r.w - 4, interaction ? 'input.draft' : 'input.prompt'));
  if (draft.length) {
    const line = draft.at(-1)!;
    c.set(r.x + 1 + width(line), r.y + r.h - 2, line.at(-1)!, style(color.green), 'input.cursor');
  }
}
function conversation(c: Canvas, world: World, lang: Language, r: Rect): void {
  const heading = label(world, lang, 'log');
  c.box(r, heading.text, color.faint, 'chat', heading.language);
  visibleLog(world, lang, r.w - 4, r.h - 2).forEach((line, i) => {
    c.text(r.x + 2, r.y + 1 + i, line.text, line.style, r.w - 4, `chat.${line.item.key}`, lang);
  });
}
function attributeFocus(world: World, t: number): string | undefined {
  if (t < world.film.lyrics[40].startMs || t >= world.film.lyrics[48].startMs) return undefined;
  return t >= world.film.lyrics[44].startMs ? 'role' : t >= world.film.lyrics[42].startMs ? 'period' : 'gender';
}
function memoryAndWatch(c: Canvas, world: World, lang: Language, r: Rect, timeMs: number): void {
  const attribute = attributeFocus(world, timeMs);
  const change = attribute ? world.store.changes.get(`me:${attribute}`) : undefined;
  const age = change ? timeMs - change.atMs : Infinity;
  const memoryH = Math.max(7, Math.floor(r.h * (attribute ? .60 : .46))), memory = { ...r, h: memoryH };
  if (attribute) {
    c.box(memory, '', age < 120 ? 15 : color.cyan, 'memory');
    c.text(r.x + 2, r.y, ` ${tr(lang, 'ui.memory_write')} `, style(color.cyan, true), r.w - 4, 'memory.write.title', lang);
    const text = change && age < 650 ? `WRITE ${attribute}: ${change.before} → ${change.after}` : `SELECT ${attribute} = ${world.value(attribute)}`;
    c.text(r.x + 2, r.y + 1, text, style(age < 450 ? color.gold : color.cyan, true), r.w - 4, 'memory.write.label');
    const entry = world.film.lyrics[attribute === 'role' ? 44 : attribute === 'period' ? 42 : 40].startMs;
    if (age < 650 || timeMs - entry < 300) c.text(r.x - 10, r.y + 1, '→ MEM', style(color.cyan, true), 8, 'memory.write.arrow');
  } else title(c, memory, world, lang, 'memory');
  const a = world.store.allocation('me'), fields = world.store.layouts.get(a.type)!.fields;
  const bytesPerRow = r.w >= 40 ? 6 : 4;
  const clearing = world.state.journal.findLast(event => event.kind === 'ERASE_FRAGMENT');
  const preview = timeMs >= world.film.lyrics[59].startMs && world.state.memoryCopies.length && !clearing ? world.state.memoryCopies[0] : undefined;
  const erasure = [...world.store.changes.values()].findLast(change => change.erased && change.field === 'SELF_ERASE');
  const snapshot = erasure && erasure.atMs >= (clearing?.atMs ?? Infinity) ? erasure : undefined;
  const memoryAllocation = snapshot ? world.store.allocation(snapshot.objectId) : a;
  const eraseAddress = snapshot?.address ?? (clearing ? Number(clearing.payload.address) - Number(clearing.payload.clearedBytes ?? clearing.payload.size) + Number(clearing.payload.size) : preview ? a.address + world.store.field('me', 'fragments').offset : undefined);
  const clearAge = timeMs - (snapshot?.atMs ?? clearing?.atMs ?? -Infinity);
  if (eraseAddress !== undefined) {
    const target = snapshot ? snapshot.objectId : `fragments[${clearing?.payload.fragment ?? preview!.fragment}]`;
    c.text(r.x + 2, r.y + 1, `${preview ? 'SELECT' : 'ERASE'} ${target}  ${snapshot?.size ?? 8} B`, style(clearAge < 350 ? color.gold : color.dim), r.w - 4, 'memory.erase.label');
  }
  const focus = attribute ?? ({ points: 'dimension', circle: 'radius', tangent: 'theta', infinity: 'boundary', current: 'currentMode', time: 'currentYear', align: 'phaseError', eggplant: 'nutrients', tomato: 'antioxidants', cat: 'purr' } as Record<string, string>)[world.state.motion?.kind ?? ''];
  const offset = eraseAddress !== undefined ? eraseAddress - memoryAllocation.address : focus ? Math.max(0, Math.floor(world.store.field('me', focus).offset / bytesPerRow) * bytesPerRow - bytesPerRow) : 0;
  const changes = [...world.store.changes.values()];
  for (let row = 0; row < memory.h - (attribute ? 4 : 3); row++) {
    const start = offset + row * bytesPerRow, address = memoryAllocation.address + start;
    const y = r.y + row + (attribute ? 3 : 2);
    const selectedRow = !!attribute && address <= a.address + world.store.field('me', attribute).offset && address + bytesPerRow > a.address + world.store.field('me', attribute).offset;
    c.text(r.x + 2, y, address.toString(16).padStart(8, '0').toUpperCase(), style(selectedRow ? color.cyan : color.dim, selectedRow), 8, selectedRow ? 'memory.write.address' : undefined);
    for (let b = 0; b < bytesPerRow; b++) {
      const at = address + b, allocated = at < memoryAllocation.address + memoryAllocation.size, value = world.store.bytes[at - world.store.base];
      const changed = changes.some(ch => at >= ch.address && at < ch.address + ch.size && timeMs - ch.atMs < (attribute ? 650 : 350)
        && (!ch.beforeBytes || ch.beforeBytes[at - ch.address] !== ch.afterBytes![at - ch.address]));
      const field = fields.find(field => at >= a.address + field.offset && at < a.address + field.offset + field.size);
      const selected = !!attribute && field?.name === attribute;
      const actualWrite = selected && changed && age < 650;
      c.text(r.x + 11 + b * 3, y, allocated ? value.toString(16).padStart(2, '0') : '··',
        { fg: actualWrite || !attribute && changed ? color.gold : selected ? color.cyan : value === 0 ? color.faint : color.dim, bg: actualWrite && age < 120 ? 24 : color.bg, bold: actualWrite && age < 450 },
        2, field ? `field.me.${field.name}` : undefined);
    }
    const ascii = Array.from({ length: bytesPerRow }, (_, b) => { const at = address + b; const byte = world.store.bytes[at - world.store.base]; return at >= memoryAllocation.address + memoryAllocation.size ? ' ' : byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.'; }).join('');
    c.text(r.x + 12 + bytesPerRow * 3, y, `|${ascii}|`, style(color.faint), bytesPerRow + 2);
  }
  if (snapshot) c.text(r.x + 2, r.y + memory.h - 1, `view ${Math.min(snapshot.size, (memory.h - 3) * bytesPerRow)}/${snapshot.size} B`, style(color.dim), r.w - 4, 'memory.erase.range');
  const watch = { x: r.x, y: r.y + memoryH, w: r.w, h: r.h - memoryH };
  title(c, watch, world, lang, world.state.count >= 4 ? 'stack' : 'state');
  const motion = world.state.motion?.kind;
  const rows: string[] = attribute ? ['gender', 'period', 'role'].map(field => `${field}=${world.value(field)}`) : [`me=${hex(a.address)}`, `revision=${world.value('revision')}`, `verified_revision=${world.value('verified_revision')}`];
  if (attribute) {
    if (timeMs >= world.film.lyrics[46].startMs) {
      const task = world.state.tasks.find(task => task.program === 'role-swap');
      if (task) rows.push(`depth=${task.frames.length} ${task.frames.at(-1)?.program ?? 'returned'}`);
    }
  } else if (motion === 'circle') rows.push(`r=${Number(world.value('radius')).toFixed(2)}  theta=${Number(world.value('theta')).toFixed(2)}`, `arc=${Number(world.value('arcLength')).toFixed(3)}`);
  else if (motion === 'current') rows.push(`current=${world.value('currentMode')}`, `vision=${world.value('vision')}`);
  else if (motion === 'time') rows.push(`target=${era(Number(world.value('targetYear')))}`, `current=${era(Number(world.value('currentYear')))}`);
  else if (timeMs >= world.film.lyrics[40].startMs) rows.push(`gender=${world.value('gender')} role=${world.value('role')}`, `lock=${world.value('lock') ? 1 : 0}`);
  else if (['eggplant','tomato','cat'].includes(motion ?? '')) { const field = motion === 'eggplant' ? 'nutrients' : motion === 'tomato' ? 'antioxidants' : 'purr'; rows.push(`form=${world.value('form')}`, `${field}=${world.value(field)}`); }
  else rows.push(`form=${world.value('form')}`, `dimension=${world.value('dimension')}`);
  const task = [...world.state.tasks].reverse().find(t => t.status !== 'COMPLETE' && t.status !== 'CANCELLED') ?? world.state.tasks.at(-1);
  if (task && !attribute) rows.push(`#${task.id} ${task.status}`, `request_id=${task.requestId ?? 'null'}`, `PC=${task.pc} depth=${task.frames.length}`);
  rows.slice(0, watch.h - 2).forEach((line, i) => {
    const selected = !!attribute && line.startsWith(`${attribute}=`);
    c.text(watch.x + 2, watch.y + i + 1, line, style(selected ? age < 450 ? color.gold : color.cyan : color.dim, selected), watch.w - 4, selected ? 'memory.write.value' : undefined);
  });
  // Semantic label instances remain separate from the state data they annotate.
  for (const [semantic, y] of (attribute || eraseAddress !== undefined ? [] : [['task', watch.y + watch.h - 1], ['wait', r.y + 1], ['output', r.y + memoryH - 1]]) as [string, number][]) {
    const l = label(world, lang, semantic); c.text(r.x + r.w - width(l.text) - 3, y, l.text, style(color.dim), r.w - 4, semantic, l.language);
  }

}

function visionGhosts(c: Canvas, world: World, l: Layout, t: number): void {
  if (world.value('vision') !== 'DEGRADED') return;
  const original = c.clone(), dizzy = t >= world.film.lyrics[19].startMs;
  const dx = 1 + Math.floor((Math.sin(t / 210) + 1) * 1.1), dy = dizzy ? Math.round(Math.sin(t / 290)) : 0;
  for (const r of [l.main, l.side]) {
    c.fill(r, ' ');
    for (const [offset, fg] of [[dx, color.faint], ...(dizzy ? [[-dx, color.purple]] : [])]) {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const cell = original.get(x, y)!;
        if (cell.continuation || !cell.g.trim()) continue;
        const tx = x + offset, ty = y + dy;
        if (tx >= r.x && tx + cell.width <= r.x + r.w && ty >= r.y && ty < r.y + r.h) c.set(tx, ty, cell.g, style(fg), 'vision.ghost');
      }
    }
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const cell = original.get(x, y)!;
      if (!cell.continuation && cell.g.trim()) c.set(x, y, cell.g, cell, cell.semantic, cell.language);
    }
  }
}

function countWord(c: Canvas, world: World): void {
  const word = ['Ein', 'dos', 'trois', '네', 'Fem', '六'][world.state.count - 1];
  wordArt(c, word, { x: 6, y: Math.floor(c.rows / 2) - 9, w: c.columns - 12, h: 18 }, color.text);
}

export class Renderer {
  private frozen = new Map<string, Canvas>();
  constructor(readonly director: Director) {}
  normal(world: World, t: number, size: Size, lang: Language): Canvas {
    const l = layout(size), c = new Canvas(size.columns, l.story.h), film = world.film;
    const scene = film.scenes.find(s => t >= s.startMs && t < s.endMs) ?? film.scenes.at(-1)!;
    const views = filmViews.get(film.id); if (!views) throw new Error(`E_FILM_VIEWS:${film.id}`);
    if (t >= film.times.holdEnd) { views.hostView(c, world, lang, l, t); return c; }
    c.text(2, 0, 'world.execute(me);', style(color.cyan, true));
    const top = `${String(scene.number).padStart(2, '0')}/25   ${hex(world.store.allocation('me').address)}   ${String(world.value('status'))}`;
    c.text(c.columns - width(top) - 3, 0, top, style(color.dim));
    conversation(c, world, lang, l.chat); views.graphic(c, world, lang, l.main, t);
    const focus = attributeFocus(world, t);
    if (focus) {
      const changed = world.store.changes.get(`me:${focus}`), entry = film.lyrics[focus === 'role' ? 44 : focus === 'period' ? 42 : 40].startMs;
      if (t - entry < 300 || changed && t - changed.atMs < 300) for (let y = l.main.y; y < l.main.y + l.main.h; y++) for (let x = l.main.x; x < l.main.x + l.main.w; x++) {
        const cell = c.get(x, y)!; if ([color.dim, color.faint].includes(cell.fg)) cell.fg = 236;
      }
    }
    memoryAndWatch(c, world, lang, l.side, t);
    visionGhosts(c, world, l, t);
    input(c, world, lang, l.input, t);
    const status = `session=${world.session('open') ? 1 : 0}   rx=${world.session('open') ? activity(world, 'rx', t).toFixed(2) : '0'}   ack_seq=${world.session('ackSeq')}   request_id=${world.state.sent.at(-1)?.id ?? 'null'}`;
    c.text(2, l.status.y, status, style(color.dim), c.columns - 4);
    const stateLabel = label(world, lang, 'state');
    c.text(c.columns - width(stateLabel.text) - 3, l.status.y, stateLabel.text, style(color.dim), 20, 'state', stateLabel.language);
    const bottom = `${timeCode(t)} / ${timeCode(film.durationMs)}    seed=${world.seed}`;
    c.text(2, l.status.y + 1, bottom, style(color.faint));
    c.text(c.columns - 41, l.status.y + 1, t >= film.times.interrupt ? 'process=TERMINATED  applied=0' : `Space:${tr(lang, 'controls.pause')}  q:${tr(lang, 'controls.quit')}`, style(color.faint), 39);
    if (world.state.count && t < film.times.interrupt) countWord(c, world);
    corrupt(c, film, world.seed, t, world.state.count);
    if (t >= film.times.intent && t < film.times.interrupt) {
      // Damage resolves a wide glyph crossing the future modal edge into two
      // single cells before capture, so overlaying cannot erase an outside cell.
      const rect = modalRect(size, lang);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (const x of [rect.x, rect.x + rect.w]) {
        if (c.get(x, y)?.continuation) { c.set(x - 1, y, '#', style(color.dim)); c.set(x, y, ';', style(color.red)); }
      }
    }
    return c;
  }
  frame(timeMs: number, size: Size, lang: Language): Canvas {
    const film = this.director.film;
    const time = clamp(Math.round(timeMs), 0, film.presentationEndMs);
    const world = this.director.at(time);
    if (time >= film.times.interrupt && time < film.times.holdEnd) {
      const key = `${size.columns}:${size.rows}:${lang}:${world.seed}`;
      let result = this.frozen.get(key);
      if (!result) {
        const before = new Director(film, world.seed).at(film.times.interrupt - 1);
        result = this.normal(before, film.times.interrupt - 1, size, lang);
        const rect = modalRect(size, lang); result.fill(rect, ' ', { fg: color.ink, bg: color.paper });
        if (lang === 'cn') {
          // Keep the six characters together, using a native asset that fits
          // inside the paper panel while leaving both outer background columns.
          wordArt(result, '程序已被终止', { x: rect.x + 1, y: rect.y + 2, w: rect.w - 2, h: rect.h - 6 }, color.ink, color.paper);
        } else {
          const lineH = Math.floor((rect.h - 6) / 2), y = rect.y + 1;
          wordArt(result, 'PROCESS', { x: rect.x + 4, y, w: rect.w - 8, h: lineH }, color.ink, color.paper);
          wordArt(result, 'TERMINATED', { x: rect.x + 4, y: y + lineH + 1, w: rect.w - 8, h: lineH }, color.ink, color.paper);
        }
        centerText(result, rect.y + rect.h - 3, stopCode, color.ink, rect);
        for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const cell = result.get(x, y)!; cell.bg = color.paper; cell.fg = color.ink; }
        result.regions.set('termination', rect);
        if (this.frozen.size >= 4) this.frozen.clear(); this.frozen.set(key, result);
      }
      return this.compose(result, time, size, lang);
    }
    return this.compose(this.normal(world, time, size, lang), time, size, lang);
  }
  private compose(story: Canvas, time: number, size: Size, lang: Language): Canvas {
    const c = new Canvas(size.columns, size.rows);
    for (let i = 0; i < story.cells.length; i++) c.cells[i] = { ...story.cells[i] };
    for (const [key, rect] of story.regions) c.regions.set(key, { ...rect });
    const r = layout(size).subtitles, lines = subtitleLines(this.director.film, time, lang);
    c.regions.set('subtitles', r);
    c.fill(r, ' ', { fg: 15, bg: color.bg, bold: true });
    lines.forEach((text, i) => {
      c.text(Math.max(2, Math.floor((size.columns - width(text)) / 2)), r.y + i, text,
        { fg: 15, bg: color.bg, bold: true }, size.columns - 4, i ? 'subtitle.translation' : 'subtitle.original', i === 1 ? lang : 'en');
    });
    return c;
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
