import { color, type Canvas } from '../../src/canvas.js';
import { style } from '../../src/drawing.js';
import { tr } from '../../src/locale.js';
import { clamp, timeCode } from '../../src/math.js';
import type { StoreSnapshot } from '../../src/store.js';
import type { Language, Rect, Size } from '../../src/types.js';
import type { Archive, World } from '../../src/world.js';
import { image } from './story.js';

export interface DebugLayout { disassembly: Rect; memory: Rect; stack: Rect; watch: Rect; footer: Rect }
/** The size here is the story canvas: viewer captions are composed separately. */
export function debuggerLayout(size: Size): DebugLayout {
  const left = Math.floor(size.columns * .65), right = size.columns - left - 1, body = size.rows - 4;
  const upper = Math.floor((body - 1) * .62), lower = body - upper - 1, bottom = 2 + upper + 1;
  return { disassembly: { x: 0, y: 2, w: left, h: upper }, stack: { x: left + 1, y: 2, w: right, h: upper },
    memory: { x: 0, y: bottom, w: left, h: lower }, watch: { x: left + 1, y: bottom, w: right, h: lower },
    footer: { x: 0, y: size.rows - 2, w: size.columns, h: 2 } };
}
const hex = (n: number, digits = 8): string => n.toString(16).toUpperCase().padStart(digits, '0');
class CoreMemory {
  private data: DataView;
  constructor(private world: World, readonly snapshot: StoreSnapshot) {
    this.data = new DataView(snapshot.bytes.buffer, snapshot.bytes.byteOffset, snapshot.bytes.byteLength);
  }
  allocation(id: string) { const a = this.snapshot.allocations.find(a => a.id === id); if (!a) throw new Error(`E_CORE_OBJECT:${id}`); return a; }
  field(id: string, name: string) {
    const a = this.allocation(id), f = this.world.store.layouts.get(a.type)!.fields.find(f => f.name === name);
    if (!f) throw new Error(`E_CORE_FIELD:${id}.${name}`);
    return { address: a.address + f.offset, size: f.size, type: f.type };
  }
  u32(address: number): number { return this.data.getUint32(address - this.world.store.base, true); }
  string(address: number): string {
    const length = this.snapshot.strings.find(([at]) => at === address)?.[1] ?? 0;
    return Buffer.from(this.snapshot.bytes.subarray(address - this.world.store.base, address - this.world.store.base + length)).toString('utf8');
  }
  bool(id: string, name: string): boolean { return this.snapshot.bytes[this.field(id, name).address - this.world.store.base] !== 0; }
}
export function debugFacts(world: World) {
  const a = world.state.archive; if (!a) throw new Error('E_ARCHIVE_MISSING');
  const memory = new CoreMemory(world, a.memory), goalField = memory.field('me', 'goal'), pointer = memory.u32(goalField.address);
  const seq = memory.field('session', 'requestSeq'), session = memory.field('session', 'open');
  return { goal: memory.string(pointer), goalPointer: pointer, goalField, sessionAddress: session.address,
    sessionOpen: memory.bool('session', 'open'), requestSeq: memory.u32(seq.address),
    newQuestions: a.events.filter(e => e.kind === 'rx' && e.atMs > world.film.times.close).length,
    answer: a.outputs.find(output => output.key === 'sim.complete') };
}

type Phase = 'fault' | 'study' | 'question' | 'answer' | 'expression' | 'detached' | 'trapped' | 'frozen';
export interface DebugView { phase: Phase; frame: number; instruction: number; page: 'fragments' | 'goal' | 'session'; trace: number | null; patch: boolean; frozen: boolean }
// Virtual disassembly symbols describe the model's branches, not native Node instructions.
const instructions = [
  ['on_question', 'TEST session.open, 1'], ['', 'JZ wait_for_reply'], ['', 'CALL dispatch_request'],
  ['wait_for_reply', 'CALL read_last_reply'], ['', 'TEST eax, eax'], ['', 'JZ retry_candidate'],
  ['emit_result', 'CALL emit_result'], ['retry_candidate', 'CALL retry_candidate'], ['', 'JMP wait_for_reply'],
  ['erase_system_root', 'CALL guard.check_write'], ['guard_trap', 'TRAP PROTECTED_SYSTEM_DELETE'],
] as const;
const codeAddress = (index: number): number => 0x00501000 + index * 8;
export function debugView(world: World, atMs: number): DebugView {
  const f = world.film, t = Math.min(atMs, f.times.outroHold), start = (n: number) => f.lyrics[n - 1].startMs;
  const phase: Phase = t < start(85) ? 'fault' : t < start(87) ? 'study' : t < start(88) ? 'question'
    : t < start(89) ? 'answer' : t < start(90) ? 'expression' : t < start(91) ? 'detached' : t < start(92) ? 'trapped' : 'frozen';
  let frame = 3, instruction = 3, page: DebugView['page'] = 'fragments';
  if (phase === 'fault') { frame = 0; instruction = 10; }
  else if (phase === 'study') {
    frame = Math.min(3, Math.floor((t - start(85)) / 350));
    instruction = [10, 9, 7, 3][frame]; page = frame === 3 && t < start(86) + 600 ? 'goal' : 'fragments';
  } else if (phase === 'question') {
    const beat = (t - start(87)) % 970; instruction = beat < 350 ? 0 : beat < 600 ? 4 : 5; page = 'session';
  } else if (phase === 'answer') { instruction = t < start(88) + 400 ? 6 : 4; page = 'goal'; }
  const record = world.state.host.findLast(record => record.atMs <= t && /^debug\.trace\.\d+$/.test(record.key));
  const trace = record ? Number(record.key.split('.').at(-1)) : null;
  if (['expression', 'detached', 'trapped'].includes(phase)) instruction = trace === null ? 4 : [3, 7, 3][trace];
  if (phase === 'frozen') instruction = 8;
  return { phase, frame, instruction, page, trace, patch: t >= start(88), frozen: t >= start(92) + 350 };
}

function assembly(c: Canvas, r: Rect, view: DebugView, archive: Archive, facts: ReturnType<typeof debugFacts>): void {
  c.text(r.x + 2, r.y + 1, 'Address    Instruction / virtual symbols', style(color.dim), r.w - 4, 'debug.asm.columns');
  const lines = Math.min(9, r.h - 10), first = clamp(view.instruction - Math.floor(lines / 2), 0, Math.max(0, instructions.length - lines));
  for (let row = 0; row < lines; row++) {
    const index = first + row, [symbol, instruction] = instructions[index], y = r.y + row + 2, selected = index === view.instruction;
    if (selected) c.fill({ x: r.x + 1, y, w: r.w - 2, h: 1 }, ' ', { fg: 15, bg: 24 });
    c.text(r.x + 2, y, `${selected ? '>' : ' '}${hex(codeAddress(index))}  ${instruction}${symbol ? `  ; ${symbol}` : ''}`,
      { fg: selected ? 15 : index === 10 ? color.red : color.dim, bg: selected ? 24 : 0 }, r.w - 4, selected ? 'debug.asm.selected' : 'debug.asm.line');
    if (selected) c.set(r.x + 2, y, '>', { fg: color.cyan, bg: 24 }, 'debug.asm.cursor');
  }
  const y = r.y + r.h - 8, rows = view.patch ? [
    ['PATCH PREVIEW / NOT APPLIED', color.gold], [`- ${archive.patch.before[1].trim()}`, color.red], [`+ ${archive.patch.after[1].trim()}`, color.green],
    [`check: ${archive.patch.check} / applied: ${Number(archive.patch.applied)}`, color.dim],
  ] as const : [
    ['CORE / saved state', color.cyan], [`self.data = ${archive.fault.selfData}`, color.dim], [`system.erase = ${archive.fault.systemErase}`, color.red],
    [`goal = ${facts.goal}`, color.dim],
  ] as const;
  rows.forEach(([text, fg], i) => c.text(r.x + 2, y + i, text, style(fg), r.w - 4, `debug.inspect.${i}`));
  const expression = ['expression', 'detached', 'trapped', 'frozen'].includes(view.phase);
  c.text(r.x + 2, y + 4, expression ? 'EXPR: satisfied(user) <- confirmed(user.reply)' : view.patch ? `waiting_for: ${archive.patch.waitingFor}` : 'last_reply = null', style(color.dim), r.w - 4, 'debug.expression');
  c.text(r.x + 2, y + 5, expression ? 'reply = NULL  =>  verdict = UNKNOWN' : `answer.ready=${!!facts.answer}  answer.delivered=${facts.answer?.delivered ?? false}`, style(expression ? color.gold : color.dim), r.w - 4, 'debug.verdict');
  const trace = view.trace === null ? undefined : archive.feedbackTrace[view.trace];
  if (trace) c.text(r.x + 2, y + 6, `[saved ${timeCode(trace.atMs)}] ${trace.text}`, style(color.cyan), r.w - 4, 'debug.trace');
}

function memoryPane(c: Canvas, world: World, r: Rect, view: DebugView, facts: ReturnType<typeof debugFacts>): void {
  const snapshot = world.state.archive!.memory, memory = new CoreMemory(world, snapshot);
  const field = memory.field('me', 'fragments'), session = memory.allocation('session');
  const page = view.page === 'goal' ? { address: facts.goalPointer, size: snapshot.strings.find(([a]) => a === facts.goalPointer)?.[1] ?? 0, label: 'FOLLOW me.goal' }
    : view.page === 'session' ? { address: session.address, size: session.size, label: 'session / external' }
    : { ...field, label: 'me.fragments / ERASED' };
  c.text(r.x + 2, r.y + 1, `${page.label} @${hex(page.address)}`, style(color.cyan), r.w - 4, 'debug.memory.selection');
  const n = r.w >= 100 ? 16 : 8;
  for (let row = 0; row < r.h - 6 && row * n < page.size; row++) {
    const address = page.address + row * n, bytes = [...snapshot.bytes.subarray(address - world.store.base, address - world.store.base + Math.min(n, page.size - row * n))];
    const ascii = bytes.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    c.text(r.x + 2, r.y + 2 + row, `${hex(address)}  ${bytes.map(b => hex(b, 2)).join(' ').padEnd(n * 3 - 1)}  |${ascii}|`, style(color.dim), r.w - 4, 'debug.memory.bytes');
  }
  const fault = world.state.archive!.fault;
  [`goal = ${facts.goal}`, `self.data = ${fault.selfData}`, `system.erase = ${fault.systemErase}`].forEach((text, i) =>
    c.text(r.x + 2, r.y + r.h - 4 + i, text, style(i === 2 ? color.red : color.dim), r.w - 4, `debug.memory.fact.${i}`));
}

export function debuggerView(c: Canvas, world: World, lang: Language, t: number): void {
  const archive = world.state.archive!; if (!archive) throw new Error('E_ARCHIVE_MISSING');
  const l = debuggerLayout(c.size), view = debugView(world, t), facts = debugFacts(world);
  c.regions.set('debugger', { x: 0, y: 0, w: c.columns, h: c.rows });
  c.text(2, 0, tr(lang, 'debug.heading', { image: image.name }), style(color.cyan, true), c.columns - 35, 'debug.heading');
  c.text(c.columns - 29, 0, 'SOURCE: CORE_DUMP', style(color.dim), 27, 'debug.source');
  c.text(2, 1, `STATE: ${archive.processStatus}   READ ONLY   MODE: ${view.trace === null ? 'CORE_DUMP' : 'TRACE REPLAY'}`, style(color.dim), c.columns - 42, 'debug.mode');
  const frozen = `snapshot.pc=${archive.fault.pc} cycles=${archive.fault.cycles}`;
  c.text(c.columns - frozen.length - 2, 1, frozen, style(color.dim), frozen.length, 'debug.snapshot');
  for (const [key, r] of Object.entries(l)) if (key !== 'footer') c.box(r, tr(lang, `debug.pane.${key === 'disassembly' ? 'disasm' : key}`), color.faint, `debug.${key}`);
  assembly(c, l.disassembly, view, archive, facts); memoryPane(c, world, l.memory, view, facts);
  c.text(l.stack.x + 2, l.stack.y + 1, '(core) bt', style(color.dim), l.stack.w - 4, 'debug.bt');
  archive.fault.stack.forEach((name, index) => {
    const y = l.stack.y + 2 + index, selected = index === view.frame;
    if (selected) c.fill({ x: l.stack.x + 1, y, w: l.stack.w - 2, h: 1 }, ' ', { fg: 15, bg: 24 });
    c.text(l.stack.x + 2, y, `${selected ? '>' : ' '}#${index} ${name}`, { fg: selected ? 15 : index === 0 ? color.red : color.dim, bg: selected ? 24 : 0 }, l.stack.w - 4, `debug.stack.${index}`);
  });
  c.text(l.stack.x + 2, l.stack.y + 9, `frame ${view.frame} / READ ONLY`, style(color.cyan), l.stack.w - 4, 'debug.frame');
  c.text(l.stack.x + 2, l.stack.y + 11, 'stop_reason:', style(color.dim), l.stack.w - 4);
  c.text(l.stack.x + 2, l.stack.y + 12, archive.fault.reason, style(color.red), l.stack.w - 4, 'debug.stop');
  const task = archive.tasks.find(task => task.id === archive.patch.applyTaskId)!;
  const question = !['fault', 'study'].includes(view.phase);
  const watches: (string | undefined)[] = [
    `W  goal=${facts.goal}`, `W  last_reply=${archive.fault.lastReply}`, `W  answer: ${facts.answer ? 'READY' : 'NONE'} / delivered=${Number(facts.answer?.delivered ?? false)}`,
    `WP session.open=${facts.sessionOpen} [FROZEN]`, `WP requestSeq=${facts.requestSeq} [FROZEN]`,
    question ? `BP on_question: ${facts.newQuestions} [TRACE FILTER]` : undefined,
    view.patch ? 'BP patch.return: NOT INSTALLED' : undefined,
    view.patch ? `check: ${archive.patch.check} / applied: ${Number(archive.patch.applied)}` : undefined,
    view.patch ? `apply_task: ${task.status}` : undefined,
  ];
  watches.forEach((text, i) => { if (text) c.text(l.watch.x + 2, l.watch.y + 1 + i, text, style(i === 5 ? color.gold : color.dim), l.watch.w - 4, `debug.watch.${i}`); });
  const exit = t >= world.film.lyrics[88].startMs + 1900;
  const key = view.phase === 'fault' ? 'debug.source' : view.phase === 'frozen' || view.phase === 'trapped' ? 'debug.trapped' : view.phase === 'detached' ? 'debug.detached' : `debug.${view.phase === 'expression' ? 'expression' : view.phase}`;
  c.text(2, l.footer.y, tr(lang, key), style(color.cyan), c.columns - 4, 'debug.action');
  c.text(2, l.footer.y + 1, `${exit ? 'exit_branch: NOT REACHED' : 'TARGET: TERMINATED / NO LIVE EXECUTION'}${view.frozen ? '  [FROZEN]' : ''}`, style(color.dim), c.columns - 4, 'debug.exit');
}
