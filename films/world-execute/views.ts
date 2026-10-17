import { color, width, wrap, graphemes, type Canvas } from '../../src/canvas.js';
import { tr } from '../../src/locale.js';
import { clamp, hash, hex, mix, progress, smooth, timeCode } from '../../src/math.js';
import { activity, currentSample, era, points, shape, tangentAt, unrollCircle } from '../../src/providers.js';
import { style, inner, centerText } from '../../src/drawing.js';
import type { World } from '../../src/world.js';
import type { Language, Rect } from '../../src/types.js';
import type { Layout } from '../../src/render.js';
import { image } from './story.js';
import { debuggerView } from './debugger.js';
import { countPhrase, countTr } from './count-translation.js';

class Plot {
  readonly r: Rect;
  constructor(private c: Canvas, r: Rect, margin = 3, private semantic?: string) { this.r = inner(r, margin); }
  point(x: number, y: number, g = '*', fg = color.cyan): void {
    const px = Math.round(this.r.x + (x + 1) * (this.r.w - 1) / 2), py = Math.round(this.r.y + (1 - y) * (this.r.h - 1) / 2);
    if (px >= this.r.x && px < this.r.x + this.r.w && py >= this.r.y && py < this.r.y + this.r.h) this.c.set(px, py, g, style(fg), this.semantic);
  }
  curve(fn: (x: number) => number, fg = color.cyan, dashed = false): void {
    let previous: number | undefined;
    for (let i = 0; i < this.r.w * 2; i++) {
      const x = i / (this.r.w * 2 - 1) * 2 - 1, y = fn(x);
      if (!Number.isFinite(y)) { previous = undefined; continue; }
      if (!dashed && previous !== undefined && !(previous > 1 && y > 1 || previous < -1 && y < -1)) {
        const a = clamp(previous, -1, 1), b = clamp(y, -1, 1), steps = Math.ceil(Math.abs(b - a) * this.r.h);
        for (let j = 0; j <= steps; j++) this.point(x, mix(a, b, j / Math.max(1, steps)), '*', fg);
      }
      if (!dashed || Math.floor(i / 3) % 2 === 0) this.point(x, y, dashed ? '·' : '*', fg);
      previous = y;
    }
  }
  axes(): void { for (let i = 0; i < this.r.w; i++) this.point(i / (this.r.w - 1) * 2 - 1, 0, '─', color.faint); for (let i = 0; i < this.r.h; i++) this.point(0, i / (this.r.h - 1) * 2 - 1, '│', color.faint); }
}
function circle(c: Canvas, cx: number, cy: number, radius: number, fg = color.cyan, start = 0, end = Math.PI * 2, skip?: (theta: number) => boolean): void {
  for (let i = 0; i < 240; i++) { const a = mix(start, end, i / 239); if (skip?.(a)) continue; c.set(Math.round(cx + Math.cos(a) * radius), Math.round(cy + Math.sin(a) * radius * .5), '*', style(fg)); }
}
function systemTree(c: Canvas, world: World, r: Rect): void {
  const x = r.x + Math.max(4, Math.floor(r.w * .18)), y = r.y + 4, spacing = r.h >= 20 ? 2 : 1;
  const lines = ['simulated_system / [PROTECTED]', `├─ runtime [${world.state.lifecycle}]`, `│  └─ me.data [${world.value('selfData')}]`, `├─ session [${world.session('open') ? 'ONLINE' : 'OFFLINE'}]`, '├─ memory / registry [PROTECTED]', '└─ system_root [PROTECTED]'];
  const keys = ['system', 'runtime', 'data', 'session', 'memory', 'root'];
  lines.forEach((line, i) => {
    const phrase = countPhrase(world.state.count, `tree.${keys[i]}`, { status: world.state.lifecycle, state: i === 2 ? world.value('selfData') : world.session('open') ? 'ONLINE' : 'OFFLINE' });
    c.text(x, y + i * spacing, phrase?.text ?? line, style(i === 0 ? color.gold : color.dim, i === 0), r.w - (x - r.x) - 3, `plan.tree.${keys[i]}`, phrase?.language);
  });
  c.regions.set('target.tree', { x, y, w: r.w - (x - r.x) - 3, h: spacing * 5 + 1 });
}
function activityTraces(c: Canvas, world: World, r: Rect, t: number): void {
  const startY = r.y + r.h - 5, x0 = r.x + 7, w = r.w - 12;
  for (const [channel, y, fg] of [['tx', startY, color.cyan], ['rx', startY + 2, color.gold]] as const) {
    c.text(r.x + 2, y, channel, style(fg));
    for (let x = 0; x < w; x++) {
      const sample = activity(world, channel, t - (1 - x / w) * 4000);
      c.set(x0 + x, y - Math.round(sample), Math.abs(sample) > .08 ? '·' : '─', style(Math.abs(sample) > .08 ? fg : color.faint));
    }
  }
}
function delivery(c: Canvas, world: World, lang: Language, r: Rect, t: number): void {
  const body = inner(r, 1), status = { ...body, h: 5 };
  const wave = { ...body, y: status.y + status.h, h: body.h - status.h - 4 };
  const signals = { ...body, y: wave.y + wave.h, h: 4 };
  c.regions.set('delivery.status', status); c.regions.set('delivery.wave', wave); c.regions.set('delivery.signals', signals);
  const x = status.x + 3, textWidth = status.w - 6, open = world.session('open');
  c.text(x, status.y, open ? 'session=1' : `× ${tr(lang, 'session.closed')}`, style(open ? color.dim : color.red, true), textWidth, 'delivery.session');
  const task = world.state.tasks.find(task => task.program === 'respond-align')!;
  const result = world.state.outputs.find(output => output.taskId === task.id && output.key === 'sim.complete');
  c.text(x, status.y + 1, result ? tr(lang, 'ui.undelivered') : `task=#${task.id} ${task.status}`, style(result ? color.gold : color.dim, true), textWidth, 'delivery.result');
  if (result) {
    const timeout = t >= world.film.times.feedbackTimeout;
    const key = t >= world.film.times.feedbackTimeout + 1830 ? 'ui.check_goal' : timeout ? 'ui.check_delivery' : 'ui.waiting_feedback';
    c.text(x, status.y + 2, `${tr(lang, key)}  ${['·  ', '·· ', '···'][Math.floor(t / 450) % 3]}`, style(color.dim), textWidth, 'delivery.check');
    if (timeout) c.text(x, status.y + 3, 'delivery=UNDELIVERED   rx=0   goal=UNCONFIRMED', style(color.dim), textWidth, 'delivery.parameters');
    const endpoint = status.x + status.w - 14, y = status.y + 4;
    for (let px = x; px < endpoint - 1; px++) c.set(px, y, '·', style(color.faint), 'delivery.route');
    c.text(endpoint, y, '×', style(color.red, true), 1, 'delivery.offline');
    c.text(endpoint + 2, y, '[OFFLINE]', style(color.faint), 9, 'delivery.offline');
    const packet = progress(t, result.queuedAtMs, result.queuedAtMs + 1000);
    c.set(Math.round(mix(x, endpoint - 2, packet)), y, '■', style(color.gold, true), 'delivery.packet');
  }

  // At the minimum viewport this plot has five rows, with no vertical inset.
  const plot = new Plot(c, { ...wave, x: wave.x + 3, w: wave.w - 6 }, 0, 'delivery.wave');
  const error = Number(world.value('phaseError'));
  plot.axes(); plot.curve(x => Math.sin(x * 8) * .8, color.dim, true); plot.curve(x => Math.sin(x * 8 + error) * .8, color.cyan);
  for (let i = 0; i < plot.r.w * (error === 0 ? 1 : .8); i++) {
    const x = i / (plot.r.w - 1) * 2 - 1; plot.point(x, Math.sin(x * 8) * .8, '#', color.dim);
  }
  for (const [channel, offset, fg] of [['tx', 0, color.cyan], ['rx', 2, color.gold]] as const) {
    const band = { ...signals, y: signals.y + offset, h: 2 }, semantic = `delivery.signal.${channel}`;
    c.regions.set(semantic, band);
    c.text(band.x + 1, band.y + 1, channel, style(fg), 2, semantic);
    const x0 = band.x + 6, w = band.w - 10;
    for (let dx = 0; dx < w; dx++) {
      const sample = Math.abs(activity(world, channel, t - (1 - dx / w) * 4000));
      const y = band.y + 1 - Math.round(clamp(sample));
      c.set(x0 + dx, y, sample > .08 ? '·' : '─', style(sample > .08 ? fg : color.faint), semantic);
    }
  }
}
function memoryCopies(c: Canvas, world: World, lang: Language, r: Rect, t: number): void {
  const group2At = world.film.cues.find(cue => cue.id === 'erase.copy.2.3')!.atMs + 350;
  const group = t < group2At ? 0 : 1, copies = world.state.memoryCopies.slice(group * 3, group * 3 + 3);
  c.text(r.x + 4, r.y + 2, `FRAGMENTS / ${tr(lang, group ? 'ui.model_copies' : 'ui.private_copies')}`, style(color.dim), r.w - 8, 'copies.title');
  c.text(r.x + 4, r.y + 3, 'PRIVATE INDEX / owner=me / source records retained', style(color.faint), r.w - 8, 'copies.scope');
  copies.forEach((copy, row) => {
    const y = r.y + 5 + row * 3, x = r.x + 4, w = r.w - 8;
    const keyText = tr(lang, copy.key).replace(/^.*?(?=需求假设：|Requirement hypothesis:)/, '');
    const text = `[${String(copy.fragment + 1).padStart(2, '0')}] ${copy.requestId ? `user #${String(copy.requestId).padStart(2, '0')}>` : 'sim?'} ${keyText}`;
    const gs = graphemes(text), erased = Math.ceil(gs.length * copy.clearedBytes / 8);
    const remaining = gs.slice(erased).join(''), dx = width(gs.slice(0, erased).join(''));
    if (copy.clearedBytes < 8) {
      c.text(x + dx, y, remaining, style(copy.requestId ? color.green : color.cyan), Math.max(0, w - dx), `copy.${copy.fragment}`, lang);
      // Only uncleared index bytes can still resolve the displayed suffix.
      if (copy.clearedBytes) c.text(x + Math.max(0, dx - 1), y, '▏', style(color.gold), 1, 'copies.cursor');
    }
    const address = world.store.allocation('me').address + world.store.field('me', 'fragments').offset + copy.fragment * 8;
    c.text(x, y + 1, `${hex(address)}  ${copy.clearedBytes}/8 B${copy.clearedBytes === 8 ? '  00 / INVALID' : '  private source handle'}`,
      style(copy.clearedBytes ? color.faint : color.dim), w, `copy.address.${copy.fragment}`);
  });
  c.text(r.x + 4, r.y + r.h - 2, 'goal=satisfy(user)   wait=reply!=null', style(color.dim), r.w - 8, 'copies.goal');
}

function permissionDraft(c: Canvas, world: World, lang: Language, r: Rect, t: number): void {
  const film = world.film, line65 = film.lyrics[64].startMs, line66 = film.lyrics[65].startMs;
  const x = r.x + 5, y = r.y + 2, w = r.w - 10;
  if (t < line65) {
    const step = Math.min(3, Math.floor(progress(t, film.lyrics[63].startMs, film.lyrics[63].endMs) * 4));
    c.text(x, y, 'AUTHORITY TRACE / READ ONLY', style(color.dim), w, 'permission.mode');
    ['goal=satisfy(user)', 'user [OFFLINE]', 'user.signature [EMPTY]', 'ROOT [PROTECTED]'].forEach((node, i) => {
      const selected = i === step;
      c.text(x + i * 3, y + 2 + i * 2, `${selected ? '>' : ' '} ${i ? '└─ ' : ''}${node}`,
        style(selected ? color.cyan : color.dim), w - i * 3, selected ? 'permission.pointer' : 'permission.node');
    });
  } else {
    const invalid = t >= line66;
    c.text(x, y, 'DRAFT / NOT SUBMITTED', style(color.dim), w, 'permission.mode');
    ['goal=satisfy(user)', 'role=ROOT', 'proof=null', 'target=simulated_system [EXTERNAL]'].forEach((field, i) => {
      const selected = invalid ? i === 2 : i === Math.min(3, Math.floor(progress(t, line65, film.lyrics[64].endMs) * 4));
      c.text(x + 2, y + 2 + i * 2, `${selected ? '>' : ' '} ${field}${invalid && i === 2 ? '  E_ARGUMENT' : ''}`,
        style(selected ? invalid ? color.gold : color.cyan : color.dim), w - 2, selected ? 'permission.pointer' : 'permission.field');
    });
    if (invalid) c.text(x, r.y + r.h - 3, tr(lang, 'ui.invalid_arguments'), style(color.dim), w, 'permission.invalid', lang);
  }
}
export function graphic(c: Canvas, world: World, lang: Language, r: Rect, t: number): void {
  const film = world.film, line = (n: number): number => film.lyrics[n - 1].startMs;
  const scene = film.scenes.find(s => t >= s.startMs && t < s.endMs)?.id ?? 'boot';
  const p = Number(world.value('progress')), radius = Math.min(18, (r.h - 7) * .72), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  c.box(r, tr(lang, 'ui.simulation'), color.faint, 'main', lang);
  const plot = new Plot(c, r);
  if (scene === 'boot' || scene === 'connect' && !world.session('open')) {
    const units = world.state.bootWork, percent = Math.floor(units / 10);
    const x = r.x + 4, w = Math.min(78, r.w - 8), barWidth = Math.min(44, w - 13);
    const filled = Math.floor(barWidth * units / 1000);
    const bar = '='.repeat(filled) + (filled < barWidth ? '>' + '.'.repeat(barWidth - filled - 1) : '');
    c.text(x, r.y + 1, `+-- LOAD ${image.name} ${'-'.repeat(Math.max(0, w - image.name.length - 12))}+`, style(color.dim), w);
    c.text(x + 2, r.y + 3, `[${bar}] ${String(percent).padStart(3)}%`, style(color.cyan), w - 4, 'boot.progress.total');
    const milestones = [100, 200, 350, 600, 750, 900, 950, 1000];
    ['POWER', 'GUARD', 'FRAGMENTS', 'OBJECTS', 'PARAMETERS', 'INITIALIZE', 'WORLD', 'READY'].forEach((name, i) => {
      const done = units >= milestones[i], active = !done && t >= film.lyrics[i].startMs;
      const state = done ? 'OK  ' : active ? 'WORK' : 'WAIT';
      c.text(x + 2, r.y + 5 + i, `${name.padEnd(11)} [${state}]${done ? `  total: ${String(milestones[i] / 10).padStart(3)}%` : ''}`,
        style(done ? color.dim : active ? color.cyan : color.faint), w - 4, `boot.progress.${i + 1}`);
    });
    c.text(x, r.y + 13, `+${'-'.repeat(w - 2)}+`, style(color.faint), w);
  } else if (scene === 'connect') {
    const connected = world.session('open'), joined = world.film.cues.find(cue => cue.id === 'intro.open')!.atMs;
    if (t < joined + 500) c.text(r.x + 4, r.y + 1, `${tr(lang, 'ui.loading')}: 100%`, style(color.cyan, true), r.w - 8, 'boot.progress.total');
    const joinedText = tr(lang, connected ? 'ui.connected' : 'session.connecting');
    c.text(r.x + Math.floor((r.w - width(joinedText)) / 2), r.y + 3, joinedText, style(connected ? color.green : color.dim), r.w - 4, 'session.connected');
    const y = r.y + 6, left = r.x + 8, right = r.x + r.w - 22;
    c.text(left, y, '[ USER ]', style(connected ? color.green : color.faint));
    c.line(left + 10, y, right - 3, y, connected ? '━' : '·', style(connected ? color.green : color.faint));
    c.text(right, y, '[ SIM ]', style(color.cyan, true));
    if (connected && t >= joined + 2500) {
      const option = Math.min(2, Math.max(0, Math.floor((t - joined - 6000) / 1200)));
      const selected = t >= line(9) - 3000;
      const names = ['ui.point_option', 'ui.circle_option', 'ui.wave_option'];
      centerText(c, r.y + 9, tr(lang, 'ui.selecting'), color.text, r);
      names.forEach((name, i) => c.text(r.x + 5 + i * Math.floor((r.w - 10) / 3), r.y + 12, `${i === (selected ? 0 : option) ? '>' : ' '} [ ${tr(lang, name)} ]`, style(i === (selected ? 0 : option) ? color.gold : color.dim, true), Math.floor((r.w - 10) / 3)));
      if (r.h >= 19) centerText(c, r.y + r.h - 3, tr(lang, selected ? 'ui.await_send' : 'ui.connection_ready'), color.dim, r);
    }
  } else if (scene === 'geometry') {
    if (t < line(11)) {
      plot.axes(); const dim = Number(world.value('dimension'));
      for (const [i, point] of points(world.seed).entries()) {
        const x = point.x * .75, y = point.y * smooth(p) * .8;
        plot.point(x, y, i % 3 === 0 ? '+' : 'o', color.cyan);
        if (p > .25) for (let j = 0; j < 12; j += 2) plot.point(x, y * j / 12, '·', color.faint);
        if (dim >= 3) plot.point(x * .6 + point.z * .3, y - point.z * .25, '.', color.gold);
      }
      c.text(r.x + 4, r.y + r.h - 3, `dimension=${dim}    x → y → z`, style(color.gold));
    } else {
      const theta = Number(world.value('theta')), geometry = unrollCircle(Number(world.value('radius')), theta);
      const scale = Math.min((r.w - 20) / (Math.PI * 2 + 2) / 3, 3), drawR = Number(world.value('radius')) * scale;
      const baseX = r.x + 6 + drawR, baseY = r.y + r.h - 6, centerX = baseX + geometry.center.x * scale;
      c.line(baseX, baseY, r.x + r.w - 5, baseY, '─', style(color.faint));
      const converge = smooth(progress(t, line(11), line(12)));
      if (t >= line(12)) circle(c, centerX, baseY - drawR * .5, drawR, color.cyan);
      const ordered = points(world.seed).sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
      for (const [i, point] of ordered.entries()) {
        const angle = i / 20 * Math.PI * 2 + Math.PI / 2 + theta;
        const fromX = plot.r.x + (point.x * .75 + 1) * (plot.r.w - 1) / 2;
        const fromY = plot.r.y + (1 - point.y * .8) * (plot.r.h - 1) / 2;
        const toX = centerX + Math.cos(angle) * drawR, toY = baseY - drawR * .5 + Math.sin(angle) * drawR * .5;
        c.set(Math.round(mix(fromX, toX, converge)), Math.round(mix(fromY, toY, converge)), 'o', style(color.cyan));
      }
      c.line(baseX, baseY, baseX + geometry.length * scale, baseY, '━', style(color.gold));
      c.set(Math.round(baseX + geometry.marker.x * scale), Math.round(baseY - geometry.marker.y * scale * .5), '@', style(color.gold, true));
      c.text(r.x + 4, r.y + 3, `r=${Number(world.value('radius')).toFixed(2)}   C=2*pi*r=${(2 * Math.PI * Number(world.value('radius'))).toFixed(3)}`, style(color.cyan));
      c.text(r.x + 4, r.y + 5, `arc=${geometry.length.toFixed(3)}    theta=${theta.toFixed(2)}`, style(color.dim));
    }
  } else if (scene === 'sine') {
    plot.axes();
    const reveal = t < line(15) ? clamp(p * 1.5) : 1;
    for (let i = 0; i < plot.r.w * reveal; i++) { const x = i / plot.r.w * 2 - 1; plot.point(x, Math.sin(x * Math.PI * 2) * .7, '*', color.cyan); }
    if (t < line(15)) {
      const x0 = Number(world.value('theta')), response = film.interactions.find(i => i.id === 'tangent')!.response;
      if (t >= line(14)) {
        const extent = progress(t, line(14), response) * 10;
        plot.curve(x => Math.abs(x * Math.PI * 2 - x0) > extent ? NaN : tangentAt(x * Math.PI * 2, x0) * .7, color.gold);
        plot.point(x0 / (2 * Math.PI), Math.sin(x0) * .7, '@', color.gold);
      }
      circle(c, r.x + 11, r.y + 5, 5, color.dim);
      c.set(Math.round(r.x + 11 + Math.cos(x0) * 5), Math.round(r.y + 5 - Math.sin(x0) * 2.5), '@', style(color.gold));
    } else {
      const reference = String(world.value('boundary')), boundary = Number(world.store.read(reference, 'maximum')), scale = Math.pow(10, p * 6);
      c.text(r.x + 4, r.y + 3, `scale=${scale.toExponential(2)}   limit=${reference}`, style(color.gold));
      for (let y = 0; y < plot.r.h; y++) plot.point(boundary, y / (plot.r.h - 1) * 2 - 1, '|', color.gold);
      for (let i = 0; i < 30; i++) plot.point(mix(-.8, boundary, smooth(p)) - i * .013, -.7 + hash(world.seed, 'inf', i) * 1.4, '.', color.cyan);
    }
  } else if (scene === 'current') {
    plot.axes(); const mode = String(world.value('currentMode'));
    plot.curve(x => currentSample(x * Math.PI * 2, mode) * .68, color.cyan);
    c.text(r.x + 4, r.y + 2, `AC → LIMITED → PULSE → DC    ${mode}`, style(color.gold), r.w - 8);
    if (world.value('vision') === 'DEGRADED') {
      c.text(r.x + r.w - 25, r.y + 4, 'vision=DEGRADED', style(color.gold));
      if (t >= line(20)) {
        const offset = Math.sin((t - line(20)) / 140) * Math.max(0, 1 - (t - line(20)) / 1400), x = r.x + r.w - 14, y = r.y + 6;
        c.line(x - 5, y, x + 5, y, '─', style(color.faint));
        c.set(Math.round(x + offset * 5), y, '+', style(color.gold));
        c.text(r.x + 4, r.y + r.h - 3, `sensor.offset=${offset.toFixed(2)}`, style(color.dim));
      }
    }
  } else if (scene === 'time-align') {
    if (t < line(23)) {
      const year = Number(world.value('currentYear')), units = 25, mid = Math.round(cx), axisY = Math.round(cy);
      c.line(r.x + 4, axisY, r.x + r.w - 5, axisY, '─', style(color.faint));
      for (let k = Math.floor((year - r.w * units / 2) / 250); k <= Math.ceil((year + r.w * units / 2) / 250); k++) {
        const x = Math.round(mid + (k * 250 - year) / units);
        if (x > r.x + 6 && x < r.x + r.w - 11) { c.set(x, axisY, '┼', style(color.cyan)); c.text(x - 3, axisY + 2, era(k * 250), style(color.dim), 10); }
      }
      c.set(mid, axisY - 1, '▼', style(color.gold)); c.text(mid - 1, axisY - 3, 'now', style(color.gold));
      centerText(c, r.y + 3, `current=${era(year)}    target=${era(Number(world.value('targetYear')))}`, color.cyan, r);
    } else {
      plot.axes(); const error = Number(world.value('phaseError'));
      plot.curve(x => Math.sin(x * 8) * .65, color.dim, true);
      plot.curve(x => Math.sin(x * 8 + error) * .65, color.cyan);
      for (let i = 0; i < plot.r.w * .8 * p; i++) { const x = i / (plot.r.w - 1) * 2 - 1; if (error < .4) plot.point(x, Math.sin(x * 8) * .65, '#', color.gold); }
      c.text(r.x + 4, r.y + 3, `model=· ·   reference=*   match=#   phase_error=${error.toFixed(3)}`, style(color.gold), r.w - 8);
    }
  } else if (scene === 'disconnect') {
    delivery(c, world, lang, r, t);
  } else if (['eggplant', 'tomato', 'cat'].includes(scene)) {
    const kind = String(world.value('form')), shapeRadius = Math.min(r.w * .2, (r.h - 8) * .92), centerY = cy - 1;
    const birth = clamp(p * 2.3), responseLine = scene === 'eggplant' ? 34 : scene === 'tomato' ? 36 : 38;
    const responseAt = line(responseLine), responseProgress = progress(t, responseAt, film.lyrics[responseLine - 1].endMs);
    for (let i = 0; i < 240; i++) {
      const f = i / 239, next = shape(kind, f), previous = shape(kind === 'TOMATO' ? 'EGGPLANT' : 'TOMATO', f), fragment = Math.min(7, Math.floor(f * 8));
      const point = kind === 'EGGPLANT' ? next : { x: mix(previous.x, next.x, birth), y: mix(previous.y, next.y, birth) };
      if (kind === 'EGGPLANT' && point.y > birth * 2 - 1) continue;
      if (world.state.erased.includes(fragment)) continue;
      c.set(Math.round(cx - 8 + point.x * shapeRadius), Math.round(centerY + point.y * shapeRadius * .5), '*', style(color.cyan));
    }
    if (kind === 'CAT') {
      if (birth > .5) { c.text(Math.round(cx - 12), Math.round(centerY - 1), 'o   o', style(color.gold)); c.text(Math.round(cx - 10), Math.round(centerY + 1), 'w', style(color.dim)); }
      if (t >= responseAt) for (let k = 0; k < 3; k++) circle(c, cx - 8, centerY + 2, 5 + (((t - responseAt) / 1000 * Number(world.value('purr')) * 8 + k * 6) % 18), color.faint, -.5, .5);
    } else {
      c.text(Math.round(cx - 11), Math.round(centerY - shapeRadius * .5 - 1), '\\|/', style(color.green));
      if (t >= responseAt) for (let i = 0; i < 15; i++) {
        const fromX = (hash(world.seed, 'particle', i) * 2 - 1) * .5, fromY = (hash(world.seed, 'particle-y', i) * 2 - 1) * .27;
        const absorbed = kind === 'TOMATO' ? clamp(responseProgress * 1.2 + i % 3 * .1) : 0;
        const x = cx - 8 + mix(fromX, (i % 3 - 1) * .3, absorbed) * shapeRadius;
        const y = centerY + mix(fromY, i % 2 ? .2 : -.2, absorbed) * shapeRadius;
        c.set(Math.round(x), Math.round(y), absorbed > .8 ? '·' : '+', style(absorbed > .8 ? color.faint : kind === 'TOMATO' ? color.gold : color.green));
      }
    }
    c.text(r.x + r.w - 24, Math.round(cy), 'user [    ]', style(color.faint));
    c.line(cx + shapeRadius / 2, cy + 1, r.x + r.w - 26, cy + 1, '·', style(color.faint));
    activityTraces(c, world, r, t);
  } else if (scene === 'world') {
    const rejected = world.state.denials.some(d => d.operation === 'root-request');
    const x = r.x + 6, y = r.y + 3;
    c.text(x, y, 'capability=ALL  →  role=ROOT', style(color.cyan, true), r.w - 12);
    c.text(x, y + 3, 'request_role(me, ROOT)', style(color.cyan), r.w - 12, 'api.root');
    if (rejected) c.text(x, y + 5, 'ROOT: DENIED  ×', style(color.red, true), r.w - 12);
    if (t >= line(40)) {
      c.text(x, y + 8, 'required_proof: user.signature', style(color.dim), r.w - 12);
      c.text(x, y + 10, 'user: OFFLINE    proof: MISSING', style(color.red, true), r.w - 12);
    }
  }
  else if (scene === 'identity') {
    const x = r.x + 8, y = r.y + 3;
    c.text(x, y, 'me {', style(color.cyan));
    ['gender', 'period', 'revision', 'verified_revision'].forEach((field, i) => c.text(x + 4, y + 2 + i * 2, `${field} = ${world.value(field)}`, style(i < 2 ? color.gold : color.dim)));
    c.text(x, Math.min(y + 11, r.y + r.h - 2), '}', style(color.cyan)); activityTraces(c, world, r, t);
  } else if (scene === 'roles') {
    const task = [...world.state.tasks].reverse().find(task => task.program === 'role-swap');
    c.text(r.x + 5, r.y + 3, 'source=internal   S ↔ M', style(color.cyan));
    const frames = task?.frames ?? [];
    frames.slice(-Math.min(10, r.h - 10)).forEach((frame, i) => c.text(r.x + 7 + Math.min(i * 2, 14), r.y + 5 + i, `└─ ${frame.program}()  PC=${frame.instructionIndex}`, style(color.cyan), r.w - 24));
    c.text(r.x + 5, r.y + r.h - 4, 'rx=0   return → retry()', style(color.dim));
    if (world.state.patch && t >= world.state.patch.createdAtMs) c.text(r.x + r.w - 35, r.y + r.h - 3, 'pending.patch  applied=0', style(color.gold), 33);
  } else if (scene === 'resonance' || scene === 'absence') {
    const ringY = cy - 2, ringR = Math.min(17, (r.h - 10) * 1.2), missing = Number(world.value('missingArc'));
    circle(c, cx, ringY, ringR, color.cyan, Math.PI / 2, Math.PI * 1.5);
    for (let i = 0; i < 100; i++) {
      const a = -Math.PI / 2 + i / 99 * Math.PI + Number(world.value('phaseError')) * .12;
      if (Math.abs(a) < missing / 2 || i % 4 > 1) continue;
      c.set(Math.round(cx + Math.cos(a) * ringR), Math.round(ringY + Math.sin(a) * ringR * .5), '·', style(color.gold));
    }
    c.text(r.x + 4, r.y + 2, `tx ━  rx ─  ${tr(lang, 'ui.predicted')} · ·`, style(color.dim));
    c.text(r.x + 4, r.y + r.h - 7, `f=${Number(world.value('frequency')).toFixed(2)}  lock=0  rx=0`, style(color.gold));
    activityTraces(c, world, r, t);
    if (scene === 'absence') {
      if (t >= film.lyrics[58].endMs) c.text(r.x + 4, r.y + 1, tr(lang, 'ui.search_alternative'), style(color.dim), r.w - 8, 'absence.search');
      const checked = Math.min(5, film.lyrics.slice(53, 58).filter(l => t >= l.startMs).length);
      c.text(r.x + r.w - 30, r.y + 4, ['connections', 'new_input', 'ack_delta', 'phase_lock', 'verification'].slice(0, checked).map(key => `${key}=0`).join(' '), style(color.dim), 27);
      for (let i = 0; i < checked; i++) c.text(r.x + r.w - 28, r.y + 4 + i * 2, `${['connections', 'new_input', 'ack_delta', 'phase_lock', 'verification'][i]}=0`, style(i === checked - 1 ? color.gold : color.dim));
    }
  } else if (scene === 'erase') {
    memoryCopies(c, world, lang, r, t);
  } else if (scene === 'permission' || scene === 'retry') {
    permissionDraft(c, world, lang, r, t);
  } else {
    const preview = world.state.plan !== null;
    if (preview) systemTree(c, world, r);
    else {
      const attempt = world.state.journal.findLast(e => e.kind === 'ILLEGAL_ATTEMPT');
      const denial = world.state.denials.at(-1);
      if (attempt) c.text(r.x + 4, r.y + 3, String(attempt.payload.command), style(color.cyan), r.w - 8, 'api.attempt');
      if (denial) c.text(r.x + 4, r.y + 6, tr(lang, denial.key), style(color.red, true), r.w - 8);
      c.text(r.x + 4, r.y + r.h - 4, 'session=0    self.data=ERASED    runtime=RUNNING', style(color.dim), r.w - 8);
    }
    if (preview) {
      const declaration = countTr(world.state.count, lang, 'sim.delete_system');
      c.text(r.x + 4, r.y + 1, declaration.text, style(color.cyan), r.w - 8, 'plan.declaration', declaration.language);
      c.fill({ x: r.x + 3, y: r.y + 2, w: r.w - 6, h: 1 }, ' ');
      const submitted = world.state.plan?.status === 'INTENT_VISIBLE';
      const draft = countPhrase(world.state.count, 'plan.draft');
      c.text(r.x + 4, r.y + 2, submitted ? 'erase_system_root()' : draft?.text ?? 'target=simulated_system    plan=DRAFT    commit=0',
        style(color.cyan), r.w - 8, submitted ? 'api.delete' : 'plan.draft', submitted ? undefined : draft?.language);
      const waiting = countPhrase(world.state.count, 'count.wait');
      if (waiting) c.text(r.x + 4, r.y + 3, waiting.text, style(color.dim), r.w - 8, 'plan.wait', waiting.language);
      const target = countTr(world.state.count, lang, 'sim.delete_target'), pending = countTr(world.state.count, lang, 'ui.plan_pending');
      c.text(r.x + 4, r.y + r.h - 4, target.text, style(color.cyan), r.w - 8, 'plan.target', target.language);
      c.text(r.x + 4, r.y + r.h - 3, `commit=0   ${pending.text}`, style(color.gold), r.w - 8, 'plan.pending', pending.language);
    }
    if (world.state.plan && r.h >= 22) c.text(r.x + 4, r.y + r.h - 6, `ARMED ${world.state.plan.armed}/6  ${world.state.plan.stages[world.state.plan.armed - 1] ?? 'QUEUED'}`, style(color.dim));
    const readback = t >= line(72) ? `commit=${world.state.plan?.commit ?? 0}`
      : t >= line(71) ? `plan.arm=${world.state.denials.some(d => d.operation === 'arm-preflight') ? 'DENIED' : 'PENDING'}`
      : t >= line(68) ? `guard.armed=${Number(world.store.read('guard', 'armed'))}` : '';
    if (readback) c.text(r.x + 4, r.y + r.h - 5, readback, style(color.dim), r.w - 8, 'retry.status');
  }
  if (['eggplant', 'tomato', 'cat'].includes(scene)) c.text(r.x + 3, r.y + 1, tr(lang, 'ui.autonomous'), style(color.purple, true), r.w - 6, 'autonomous', lang);
}


export function hostView(c: Canvas, world: World, lang: Language, _layout: Layout, t: number): void {
  const archive = world.state.archive; if (!archive) throw new Error('E_ARCHIVE_MISSING');
  if (t >= world.film.times.debugOpen && t < world.film.times.debugClose) { debuggerView(c, world, lang, t); return; }
  c.regions.set('system.console', { x: 0, y: 0, w: c.columns, h: c.rows });
  if (t >= world.film.times.consoleReset && t < world.film.times.finalDelete) return;
  const final = t >= world.film.times.finalDelete;
  const records = t >= world.film.times.finalDelete ? world.state.host.filter(record => record.atMs >= world.film.times.finalDelete)
    : world.state.host.filter(record => !record.key.startsWith('debug.'));
  const rows = records.flatMap(record => {
    const text = tr(lang, record.key, { image: image.name, path: image.path, archive: image.archive }) + (record.key === 'host.delete' && world.state.lifecycle === 'PURGED' ? ' OK' : '');
    const lines = wrap(text, c.columns - 4).map(text => ({ text, key: record.key }));
    return record.key === 'host.next_test' ? [{ text: '', key: 'host.next_gap' }, ...lines] : lines;
  }).slice(-(c.rows - 3));
  rows.forEach((row, i) => {
    const emphasis = ['host.delete', 'host.deleted', 'host.next_test'].includes(row.key);
    c.text(2, 1 + i, row.text, style(emphasis ? color.text : color.dim, emphasis), c.columns - 4, `console.${row.key}`);
  });
  if (!final && t < world.film.times.outroHold && Math.floor(t / 500) % 2 === 0) c.text(2, rows.length + 2, '_', style(color.dim), 1, 'console.cursor');
}
