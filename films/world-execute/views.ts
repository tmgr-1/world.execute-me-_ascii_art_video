import { color, type Canvas } from '../../src/canvas.js';
import { tr } from '../../src/locale.js';
import { clamp, hash, hex, mix, progress, smooth, timeCode } from '../../src/math.js';
import { activity, currentSample, era, points, shape, tangentAt, unrollCircle } from '../../src/providers.js';
import { style, inner, centerText } from '../../src/drawing.js';
import type { World } from '../../src/world.js';
import type { Language, Rect } from '../../src/types.js';
import type { Layout } from '../../src/render.js';

class Plot {
  readonly r: Rect;
  constructor(private c: Canvas, r: Rect) { this.r = inner(r, 3); }
  point(x: number, y: number, g = '*', fg = color.cyan): void {
    const px = Math.round(this.r.x + (x + 1) * (this.r.w - 1) / 2), py = Math.round(this.r.y + (1 - y) * (this.r.h - 1) / 2);
    if (px >= this.r.x && px < this.r.x + this.r.w && py >= this.r.y && py < this.r.y + this.r.h) this.c.set(px, py, g, style(fg));
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
function objectTree(c: Canvas, world: World, r: Rect, selected = false): void {
  const fg = selected ? color.gold : color.cyan, x = r.x + Math.max(4, Math.floor(r.w * .18)), y = r.y + 3;
  const nodes = ['me.circle', 'me.sine', 'me.eggplant', 'me.tomato', 'me.cat'];
  c.text(x, y, `me  ${hex(world.store.allocation('me').address)}`, style(fg, true));
  c.text(x, y + 1, '│  goal=satisfy(user)', style(color.dim));
  if (selected) c.regions.set('target.tree', { x, y, w: Math.min(43, r.w - (x - r.x) - 2), h: 10 });
  nodes.forEach((id, i) => {
    if (!world.store.allocations.has(id)) return;
    c.text(x, y + 3 + i, `${i === nodes.length - 1 ? '└' : '├'}── ${id}${selected ? '  [*]' : ''}`, style(fg));
    if (world.state.erased.length && ['me.circle', 'me.cat'].includes(id)) c.text(x + 30, y + 3 + i, '... 00 ...', style(color.faint), r.w - 36);
  });
  c.text(x, y + 10, 'user [                    ]', style(color.dim));
  c.text(x, y + 12, 'session=0   user.response=null', style(color.dim), r.w - 8);
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
export function graphic(c: Canvas, world: World, lang: Language, r: Rect, t: number): void {
  const film = world.film, line = (n: number): number => film.lyrics[n - 1].startMs;
  const scene = film.scenes.find(s => t >= s.startMs && t < s.endMs)?.id ?? 'boot';
  const p = Number(world.value('progress')), radius = Math.min(18, (r.h - 7) * .72), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  c.box(r, tr(lang, 'ui.simulation'), color.faint, 'main', lang);
  const plot = new Plot(c, r);
  if (scene === 'boot') {
    const n = film.lyrics.filter(l => l.startMs <= t).length;
    c.text(r.x + 4, r.y + 3, `me  ${hex(world.store.allocation('me').address)}`, style(color.cyan, true));
    for (let i = 0; i < 8; i++) {
      const x = r.x + 4 + i * Math.floor((r.w - 8) / 8), y = r.y + 6;
      c.text(x, y, i < n ? '[##]' : '[..]', style(i < n ? color.cyan : color.faint));
      if (i < n) c.line(x + 1, y + 2, x + 1, y + 4, '│', style(color.faint));
    }
    c.text(r.x + 4, r.y + 12, `power=${world.value('power') ? 'ON' : 'OFF'}  guard=${world.store.read('guard', 'armed') ? 'ARMED' : 'IDLE'}`, style(color.dim));
    if (n >= 4) c.text(r.x + 4, r.y + 14, 'goal=satisfy(user)', style(color.gold));
    if (r.h > 19) plot.curve(x => clamp((t / 2000 + x) * 2, 0, .6), color.cyan);
  } else if (scene === 'connect') {
    plot.axes(); centerText(c, Math.round(cy), tr(lang, world.session('open') ? 'sim.ready' : 'session.wait'), color.dim, r);
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
    if (!world.value('vision')) {
      c.fill({ x: r.x + r.w - 22, y: r.y + 4, w: 18, h: 3 }, ' ', style(color.bg)); c.text(r.x + r.w - 22, r.y + 4, 'vision=OFF', style(color.dim));
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
    const error = Number(world.value('phaseError'));
    plot.axes(); plot.curve(x => Math.sin(x * 8) * .5, color.dim, true); plot.curve(x => Math.sin(x * 8 + error) * .5, color.cyan);
    for (let i = 0; i < plot.r.w * (error === 0 ? 1 : .8); i++) { const x = i / (plot.r.w - 1) * 2 - 1; plot.point(x, Math.sin(x * 8) * .5, '#', color.dim); }
    c.text(r.x + 4, r.y + 3, `session=${world.session('open') ? 1 : 0}    on_disconnect.handler=retry`, style(color.gold));
    if (!world.session('open')) {
      const task = world.state.tasks.find(task => task.program === 'respond-align')!, result = world.state.outputs.find(output => output.taskId === task.id && output.key === 'sim.complete');
      c.text(r.x + 4, r.y + 5, result ? `output=#${result.id}  delivered=${result.delivered ? 1 : 0}` : `task=#${task.id} ${task.status}`, style(color.dim));
    }
    activityTraces(c, world, r, t);
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
  } else if (scene === 'world') objectTree(c, world, r);
  else if (scene === 'identity') {
    const x = r.x + 8, y = r.y + 4;
    c.text(x, y, 'me {', style(color.cyan));
    ['gender', 'period', 'revision', 'verified_revision'].forEach((field, i) => c.text(x + 4, y + 2 + i * 2, `${field} = ${world.value(field)}`, style(i < 2 ? color.gold : color.dim)));
    c.text(x, y + 11, '}', style(color.cyan)); activityTraces(c, world, r, t);
  } else if (scene === 'roles' || scene === 'retry') {
    const task = scene === 'retry' ? world.state.tasks.find(task => task.program === 'on_disconnect') : [...world.state.tasks].reverse().find(task => task.program === 'role-swap');
    c.text(r.x + 5, r.y + 3, scene === 'retry' ? 'on_disconnect()' : 'source=internal   S ↔ M', style(color.cyan));
    const frames = task?.frames ?? [];
    frames.slice(-Math.min(10, r.h - 10)).forEach((frame, i) => c.text(r.x + 7 + Math.min(i * 2, 14), r.y + 5 + i, `└─ ${frame.program}()  PC=${frame.instructionIndex}`, style(i === frames.length - 1 ? color.gold : color.dim), r.w - 24));
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
      const checked = Math.min(5, film.lyrics.slice(53, 58).filter(l => t >= l.startMs).length);
      c.text(r.x + r.w - 30, r.y + 4, ['connections', 'new_input', 'ack_delta', 'phase_lock', 'verification'].slice(0, checked).map(key => `${key}=0`).join(' '), style(color.dim), 27);
      for (let i = 0; i < checked; i++) c.text(r.x + r.w - 28, r.y + 4 + i * 2, `${['connections', 'new_input', 'ack_delta', 'phase_lock', 'verification'][i]}=0`, style(i === checked - 1 ? color.gold : color.dim));
    }
  } else if (scene === 'erase') {
    const x = r.x + r.w * .30;
    circle(c, x, cy, radius, color.cyan, 0, Math.PI * 2, a => world.state.erased.includes(Math.floor(a / (Math.PI * 2) * 8)));
    for (let i = 0; i < 150; i++) { if (world.state.erased.includes(Math.floor(i / 150 * 8))) continue; const p = shape('CAT', i / 149); c.set(Math.round(r.x + r.w * .7 + p.x * radius), Math.round(cy + p.y * radius * .5), '*', style(color.dim)); }
    c.text(r.x + 4, r.y + 3, 'me.fragments  →  00', style(color.gold)); c.text(r.x + 4, r.y + r.h - 3, 'goal=satisfy(user)', style(color.dim));
  } else if (scene === 'permission') {
    c.text(r.x + 6, Math.round(cy) - 2, 'session.open = 1', style(color.gold));
    if (t >= line(66)) c.text(r.x + 6, Math.round(cy) + 1, `E_PERMISSION: ${tr(lang, 'guard.read_only')}`, style(color.red), r.w - 12);
    c.text(r.x + 6, Math.round(cy) + 4, 'session=0', style(color.dim));
  } else {
    objectTree(c, world, r, t >= film.times.counts[0] - 4200);
    const preview = t >= film.times.counts[0] - 4200;
    if (preview) {
      c.fill({ x: r.x + 3, y: r.y + 2, w: r.w - 6, h: 1 }, ' ');
      c.text(r.x + 4, r.y + 2, 'dispose(me)   op=DISPOSE_ROOT', style(color.gold, true));
      c.text(r.x + 4, r.y + r.h - 3, `target=me   commit=0   ${world.state.plan?.status ?? 'PREVIEW'}`, style(color.gold), r.w - 8);
    }
    if (world.state.plan && r.h >= 22) c.text(r.x + 4, r.y + r.h - 5, `ARMED ${world.state.plan.armed}/6  ${world.state.plan.stages[world.state.plan.armed - 1] ?? 'QUEUED'}`, style(color.dim));
  }
}


export function hostView(c: Canvas, world: World, lang: Language, l: Layout, t: number): void {
  const archive = world.state.archive; if (!archive) throw new Error('E_ARCHIVE_MISSING');
  const r = l.simulation;
  c.box(r, 'archive/me/', color.faint, 'archive');
  const hostLines = world.state.host.map(record => record.key === 'status' ? `[host] process=${archive.processStatus}  plan=${archive.planStatus}` : `[host] ${tr(lang, record.key)}${record.key === 'host.complete' ? '' : '  OK'}`);
  c.box(l.chat, tr(lang, 'archive.label'), color.faint);
  hostLines.slice(-l.chat.h + 2).forEach((text, i) => c.text(2, l.chat.y + i + 1, text, style(color.dim), l.chat.w - 4));
  const patchScene = t >= world.film.times.patch;
  if (!patchScene) {
    const x = Math.max(6, Math.floor(c.columns * .18)), y = r.y + 4;
    archive.virtualFiles.forEach((file, i) => c.text(x, y + i * 2, `${file.kind === 'patch' ? '>' : ' '} ${file.path.split('/').at(-1)}`, style(file.kind === 'patch' ? color.gold : color.dim), r.w - x - 4));
    c.text(x, y + 11, 'mode=READ_ONLY', style(color.faint));
    return;
  }
  const patch = archive.patch, x = Math.max(6, Math.floor(c.columns * .13)), y = r.y + 4;
  const line = (n: number): number => world.film.lyrics[n - 1].startMs;
  c.text(r.x + 4, r.y + 2, `pending.patch   process=${archive.processStatus}   applied=${Number(patch.applied)}   mode=READ_ONLY`, style(color.dim), r.w - 8);
  c.text(x, y, `created_at=${timeCode(patch.createdAtMs)}  terminated_at=${timeCode(archive.terminatedAtMs)}`, style(color.faint), r.w - x - 5);
  if (t >= line(86)) {
    const oldDim = t >= line(92), cursor = t >= line(93) ? '>' : ' ';
    c.text(x, y + 3, `   ${patch.before[0]}`, style(color.dim));
    c.text(x, y + 5, ` - ${patch.before[1]}`, style(oldDim ? color.faint : color.red));
    if (t >= line(86) + 250) c.text(x, y + 7, `${cursor}+ ${patch.after[1]}`, style(color.green, true));
    c.text(x, y + 9, `   ${patch.after[2]}`, style(color.dim));
  }
  const metadataX = Math.max(x + 43, c.columns - 38);
  if (t >= line(88)) c.text(metadataX, y + 5, `check=${patch.check}`, style(color.dim), c.columns - metadataX - 3);
  if (t >= line(91)) c.text(metadataX, y + 7, `apply_task=${archive.tasks.find(task => task.id === patch.applyTaskId)?.status}`, style(color.gold), c.columns - metadataX - 3);
}

