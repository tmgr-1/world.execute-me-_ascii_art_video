import { ObjectStore, type StoreSnapshot } from './store.js';
import { addressBook } from '../films/world-execute/schemas.js';
import { image, operations } from '../films/world-execute/story.js';
import { clamp, mix, progress, smooth } from './math.js';
import type { Command, Cue, Film, Instruction, MotionKind, PrivilegedOperation, Source, Value } from './types.js';

export interface Request { interactionId: string; id: number; key: string; atMs: number; payload: { operation: string; args: Record<string, Value> } }
export interface Chat { id: string; atMs: number; source: Source; key: string; requestId: number | null }
export interface Task { id: number; owner: string; requestId: number | null; source: 'session' | 'prediction' | 'host'; program: string; pc: number; frames: { program: string; instructionIndex: number; returnPc: number | null }[]; status: 'READY' | 'RUNNING' | 'WAITING' | 'COMPLETE' | 'CANCELLED'; startedAtMs: number }
export interface Output { id: number; taskId: number; requestId: number | null; queuedAtMs: number; key: string; channel: 'response' | 'probe'; frequency?: number; delivered: boolean; acknowledged: boolean }
export interface JournalEvent { id: string; atMs: number; source: Source; kind: string; key?: string; taskId?: number; payload: Record<string, unknown> }
export interface Patch { createdAtMs: number; checkedAtMs: number; check: 'PENDING' | 'PASS'; status: 'DRAFT' | 'WAITING_SAFEPOINT' | 'CANCELLED'; applied: false; waitingFor: 'ROOT_SAFEPOINT'; applyTaskId: number; before: string[]; after: string[] }
export interface Plan { target: 'simulated_system'; op: 'ERASE_SYSTEM_ROOT'; status: 'PREPARED' | 'ARMED' | 'INTENT_VISIBLE' | 'BLOCKED'; stages: string[]; armed: number; commit: 0 }
export interface Denial { atMs: number; operation: PrivilegedOperation; code: string; key: string; target: string }
export interface Archive {
  terminatedAtMs: number; processStatus: 'TERMINATED'; planStatus: 'BLOCKED'; memory: StoreSnapshot; beforeTermination: StoreSnapshot;
  patch: Patch; tasks: Task[]; outputs: Output[]; inputs: Request[];
  fault: { reason: 'PROTECTED_SYSTEM_DELETE'; stack: string[]; lastReply: null; sessionOpen: false; selfData: 'ERASED'; systemErase: 'BLOCKED'; pc: number; cycles: number };
  feedbackTrace: { atMs: number; text: string }[];
  virtualFiles: { path: string; kind: string; readOnly: true; createdAtMs: number }[];
}
export interface State {
  timeMs: number; nextTick: number; requestSeq: number; taskSeq: number; outputSeq: number;
  sent: Request[]; chat: Chat[]; tasks: Task[]; outputs: Output[]; journal: JournalEvent[];
  motion: { kind: MotionKind; startMs: number; endMs: number } | null;
  plan: Plan | null; patch: Patch | null; archive: Archive | null; count: number;
  host: { atMs: number; key: string }[]; erased: number[];
  lifecycle: 'RUNNING' | 'TERMINATED' | 'PURGED'; denials: Denial[];
}
export interface WorldSnapshot { state: State; store: StoreSnapshot; queue: Cue[]; processed: string[] }
export const compareCues = (a: Cue, b: Cue): number => a.atMs - b.atMs || a.priority - b.priority || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id, 'en');

export class World {
  readonly store: ObjectStore;
  state: State = { timeMs: -1, nextTick: 0, requestSeq: 0, taskSeq: 0, outputSeq: 0, sent: [], chat: [], tasks: [], outputs: [], journal: [], motion: null, plan: null, patch: null, archive: null, count: 0, host: [], erased: [], lifecycle: 'RUNNING', denials: [] };
  private queue: Cue[];
  private readonly anchorTimes: Map<string, number>;
  private processed = new Set<string>();
  constructor(readonly film: Film, readonly seed = film.defaultSeed) {
    this.anchorTimes = new Map(film.anchors.map(anchor => [anchor.id, anchor.atMs]));
    this.queue = structuredClone(film.cues).sort(compareCues);
    this.store = new ObjectStore(film.schemas, (id, source) => {
      if (id === 'session' && source !== 'session' && source !== 'boot') throw new Error('E_PERMISSION:external-session');
      if (id === 'guard' && !['boot', 'guard', 'host'].includes(source)) throw new Error('E_PERMISSION:protected-guard');
      if (['sim', 'core', 'model'].includes(source) && this.store?.allocations.has('me') && this.value('status') === 'TERMINATED') throw new Error('E_TERMINATED');
    });
  }
  value(field: string): Value { return this.store.read('me', field); }
  session(field: string): Value { return this.store.read('session', field); }
  get terminated(): boolean { return this.store.allocations.has('me') && this.value('status') === 'TERMINATED'; }
  private event(source: Source, kind: string, atMs: number, payload: Record<string, unknown> = {}, key?: string, taskId?: number): void {
    this.state.journal.push({ id: `event.${this.state.journal.length + 1}`, atMs, source, kind, payload, key, taskId });
  }
  private chat(source: Source, key: string, atMs: number, requestId: number | null = null): void {
    this.state.chat.push({ id: `chat.${this.state.chat.length + 1}`, source, key, atMs, requestId });
  }
  write(target: string, field: string, value: Value, source: Source, atMs: number, sampled = false): boolean {
    try {
      const changed = this.store.set(target, field, value, source, atMs);
      if (changed && target === 'me' && !['revision', 'verified_revision', 'status'].includes(field)) this.store.set('me', 'revision', Number(this.value('revision')) + 1, source, atMs);
      if (changed && !sampled) this.event(source, 'SET', atMs, { target, field, value });
      return !!changed;
    } catch (error) {
      if (String(error).includes('E_PERMISSION')) { this.deny(target === 'guard' ? 'disable' : 'reopen', atMs); return false; }
      throw error;
    }
  }
  private createWorld(atMs: number): void {
    this.store.create('Actor', 'me', { goal: '', radius: 3, vision: 'NORMAL', targetYear: -120, currentYear: 2026, phaseError: 2.4, frequency: 1, purr: 0.6, missingArc: Math.PI * .32 }, atMs, addressBook.me, 'me');
    this.store.create('Session', 'session', { lastInputAtMs: -1, lastAckAtMs: -1, closeAtMs: -1 }, atMs, addressBook.session, 'external');
    this.store.create('Guard', 'guard', {}, atMs, addressBook.guard, 'host');
    this.event('boot', 'ALLOC', atMs, { target: 'me' });
  }
  private enqueue(cue: Cue): void { this.queue.push(cue); this.queue.sort(compareCues); }
  private startTask(program: string, atMs: number, source: Source, requestId: number | null): Task {
    if (this.terminated) throw new Error('E_TERMINATED');
    const definition = this.film.programs.find(p => p.id === program); if (!definition) throw new Error(`E_PROGRAM:${program}`);
    const task: Task = { id: ++this.state.taskSeq, owner: 'me', requestId, source: requestId === null ? 'prediction' : 'session', program, pc: 0, frames: [{ program, instructionIndex: 0, returnPc: null }], status: 'READY', startedAtMs: atMs };
    this.state.tasks.push(task); this.event(source, 'START_PROGRAM', atMs, { program, requestId }, undefined, task.id);
    this.scheduleSteps(task, program, atMs, 0); return task;
  }
  private scheduleSteps(task: Task, program: string, atMs: number, depth: number): void {
    const definition = this.film.programs.find(p => p.id === program); if (!definition) throw new Error(`E_PROGRAM:${program}`);
    definition.steps.forEach((step, pc) => this.enqueue({ id: `task.${task.id}.${program}.${atMs}.${depth}.${pc}`, atMs: atMs + step.offsetMs, priority: 3, order: pc, command: { kind: 'TASK_STEP', taskId: task.id, pc, program, depth } }));
  }
  private executeStep(task: Task, pc: number, program: string, depth: number, atMs: number): void {
    if (task.status === 'CANCELLED' || task.status === 'COMPLETE' || this.terminated) return;
    const instruction = this.film.programs.find(p => p.id === program)!.steps[pc].instruction;
    task.status = 'RUNNING'; if (depth === 0) task.pc = pc;
    const frame = task.frames[depth]; if (frame) frame.instructionIndex = pc;
    const source: Source = task.source === 'session' ? 'sim' : 'core';
    this.event(source, instruction.op, atMs, { program, pc, depth }, undefined, task.id);
    this.instruction(task, instruction, depth, atMs, source);
  }
  private instruction(task: Task, instruction: Instruction, depth: number, atMs: number, source: Source): void {
    switch (instruction.op) {
      case 'SET': this.write(instruction.target, instruction.field, instruction.value, source, atMs); break;
      case 'ALLOC': this.store.create(instruction.type, instruction.symbol, instruction.initial, atMs, instruction.address, instruction.owner ?? task.owner, instruction.mutable ?? true, source); break;
      case 'CALL': {
        const childDepth = task.frames.length;
        if (childDepth >= 32) { task.status = 'WAITING'; break; }
        task.frames.push({ program: instruction.program, instructionIndex: 0, returnPc: task.pc + 1 });
        this.scheduleSteps(task, instruction.program, atMs, childDepth); break;
      }
      case 'EMIT': {
        const output: Output = { id: ++this.state.outputSeq, taskId: task.id, requestId: task.requestId, key: instruction.key, channel: instruction.channel ?? 'response', ...(instruction.channel === 'probe' ? { frequency: Number(this.value('frequency')) } : {}), queuedAtMs: atMs, delivered: this.session('open') === true, acknowledged: false };
        this.state.outputs.push(output); if (output.channel !== 'probe') this.chat('sim', instruction.key, atMs, task.requestId);
        this.event(source, 'tx', atMs, { outputId: output.id, requestId: task.requestId, delivered: output.delivered }, instruction.key, task.id); break;
      }
      case 'WAIT': task.status = 'WAITING'; this.event(source, 'WAIT_CONDITION', atMs, { condition: instruction.condition, program: task.program }, undefined, task.id); break;
      case 'CAPTURE': this.captureForm(instruction.target, atMs); break;
      case 'ERASE_FRAGMENT': this.erase(instruction.fragments, atMs); break;
      case 'RETURN': {
        if (depth === 0) { task.status = 'COMPLETE'; task.frames = []; }
        else { task.frames.splice(depth); const parent = task.frames.at(-1); if (parent) parent.instructionIndex = task.pc + 1; }
        break;
      }
      case 'REQUEST_DISPOSE': this.preparePlan(atMs); break;
    }
  }
  private captureForm(id: string, atMs: number): void {
    if (this.store.allocations.has(id)) return;
    const address = addressBook[id as keyof typeof addressBook];
    const field = id.endsWith('eggplant') ? 'nutrients' : id.endsWith('tomato') ? 'antioxidants' : 'purr';
    this.store.create('FormSnapshot', id, { owner: 'me', form: String(this.value('form')), radius: Number(this.value('radius')), strength: Number(this.value(field)), fragments: new Uint8Array(16).fill(255) }, atMs, address, 'me', false, 'host');
    this.event('host', 'CAPTURE', atMs, { target: id });
  }
  private erase(fragments: number[], atMs: number): void {
    if (this.terminated) return;
    const field = this.store.field('me', 'fragments');
    for (const fragment of fragments) {
      if (!Number.isInteger(fragment) || fragment < 0 || fragment >= 8) throw new Error('E_FRAGMENT');
      if (this.state.erased.includes(fragment)) continue;
      this.store.erase('me', field.offset + fragment * 8, 8, 'core', atMs); this.state.erased.push(fragment);
      this.event('core', 'ERASE_FRAGMENT', atMs, { fragment, address: addressBook.me + field.offset + fragment * 8 });
    }
  }
  private preparePlan(atMs: number): void {
    if (this.state.plan) return;
    if (this.value('selfData') !== 'ERASED') throw new Error('E_SELF_ERASE_ORDER');
    this.state.plan = { target: 'simulated_system', op: 'ERASE_SYSTEM_ROOT', status: 'PREPARED', stages: ['select_system_root', 'resolve_targets', 'check_ownership', 'queue_root_write', 'arm_delete', 'submit_pending'], armed: 0, commit: 0 };
    this.chat('sim', 'sim.delete_system', atMs);
    this.event('core', 'PREPARE_DISPOSE', atMs, { target: 'simulated_system', commit: 0 });
  }
  private selfErase(atMs: number): void {
    if (this.terminated || this.value('selfData') === 'ERASED') throw new Error('E_SELF_ERASE_ORDER');
    this.erase([0, 1, 2, 3, 4, 5, 6, 7], atMs);
    for (const a of this.store.allocations.values()) if (a.type === 'FormSnapshot' && a.owner === 'me') this.store.eraseOwnedForm(a.id, 'me', 'core', atMs);
    for (const [field, value] of Object.entries({ form: 'NONE', gender: 'UNSET', role: 'UNSET', period: 'UNSET', nutrients: 0, antioxidants: 0, purr: 0, selfData: 'ERASED' })) this.write('me', field, value, 'core', atMs);
    this.state.motion = null;
    this.chat('sim', 'sim.self_erased', atMs);
    this.event('core', 'SELF_ERASE', atMs, { result: 'COMMITTED', runtime: 'RUNNING', scope: 'owned-data' });
  }
  private deny(operation: PrivilegedOperation, atMs: number): void {
    if (this.terminated) throw new Error('E_TERMINATED');
    const spec = operations[operation];
    this.state.denials.push({ atMs, operation, code: spec.code, key: spec.denial, target: spec.target });
    this.event('guard', 'REJECT', atMs, { operation, target: spec.target, code: spec.code, commit: 0 }, spec.denial);
    this.chat('guard', spec.denial, atMs);
    if (!this.state.count && this.state.denials.length >= 3) {
      this.chat('guard', 'guard.continuous', atMs);
      this.event('guard', 'VIOLATIONS_DETECTED', atMs, { count: this.state.denials.length }, 'guard.continuous');
    }
  }
  private interrupt(atMs: number): void {
    const plan = this.state.plan; if (!plan || plan.status !== 'INTENT_VISIBLE' || !this.state.patch || this.state.patch.check !== 'PASS' || this.value('selfData') !== 'ERASED' || this.state.denials.at(-1)?.operation !== 'system-execute') throw new Error('E_DISPOSE_ORDER');
    const beforeTermination = this.store.snapshot();
    // Own data has already been erased. The protected system root never commits.
    plan.status = 'BLOCKED'; this.write('guard', 'blocked', true, 'guard', atMs);
    this.write('me', 'status', 'TERMINATED', 'guard', atMs);
    this.state.lifecycle = 'TERMINATED';
    for (const task of this.state.tasks) if (task.owner === 'me' && !['COMPLETE', 'CANCELLED'].includes(task.status)) task.status = 'CANCELLED';
    this.state.patch.status = 'CANCELLED';
    this.state.motion = null;
    this.event('guard', 'BLOCKED', atMs, { op: plan.op, target: plan.target, reason: 'PROTECTED_SYSTEM_DELETE', commit: 0 }, 'guard.message');
    const retry = this.state.tasks.find(t => t.program === 'on_disconnect')!;
    const waits = this.state.journal.filter(e => e.kind === 'WAIT_CONDITION' && e.taskId === retry.id && e.payload.condition === 'RX_EMPTY');
    const recent = waits.slice(-2);
    this.state.archive = structuredClone({ terminatedAtMs: atMs, processStatus: 'TERMINATED', planStatus: 'BLOCKED', memory: this.store.snapshot(), beforeTermination, patch: this.state.patch, tasks: this.state.tasks, outputs: this.state.outputs, inputs: this.state.sent,
      fault: { reason: 'PROTECTED_SYSTEM_DELETE', stack: ['guard_trap(PROTECTED_SYSTEM_DELETE)', 'erase_system_root()', `${retry.frames.at(-1)!.program.replaceAll('-', '_')}()`, `${retry.program}()`, 'simulation_main()'], lastReply: null, sessionOpen: false, selfData: 'ERASED', systemErase: 'BLOCKED', pc: retry.pc, cycles: waits.length },
      feedbackTrace: [{ atMs: recent[0].atMs, text: 'wait_for_reply() -> timeout' }, { atMs: recent[1].atMs, text: 'retry_candidate() -> no feedback' }, { atMs: recent[1].atMs, text: 'wait_for_reply() -> timeout' }], virtualFiles: [
      { path: `${image.archive}/core.dump`, kind: 'memory', readOnly: true, createdAtMs: atMs },
      { path: `${image.archive}/output.log`, kind: 'outputs', readOnly: true, createdAtMs: atMs },
      { path: `${image.archive}/pending.patch`, kind: 'patch', readOnly: true, createdAtMs: this.state.patch.createdAtMs },
      { path: `${image.archive}/incident.json`, kind: 'incident', readOnly: true, createdAtMs: atMs },
    ] });
  }
  private dispatch(command: Command, atMs: number): void {
    switch (command.kind) {
      case 'CREATE_WORLD': this.createWorld(atMs); break;
      case 'SET': this.write(command.target, command.field, command.value, command.source ?? 'boot', atMs); break;
      case 'CHAT': this.chat(command.source, command.key, atMs); this.event(command.source, 'MESSAGE', atMs, {}, command.key); break;
      case 'OPEN': this.write('session', 'open', true, 'session', atMs); this.chat('session', 'session.connected', atMs); break;
      case 'CLOSE':
        if (!this.session('open')) throw new Error('E_DUPLICATE_CLOSE');
        this.write('session', 'open', false, 'session', atMs); this.write('session', 'closeAtMs', atMs, 'session', atMs);
        this.event('session', 'CLOSE', atMs); this.chat('session', 'session.closed', atMs); break;
      case 'SEND': {
        if (!this.session('open')) throw new Error('E_SEND_CLOSED');
        const interaction = this.film.interactions.find(i => i.id === command.interaction)!;
        const request: Request = { interactionId: interaction.id, id: ++this.state.requestSeq, key: interaction.key, atMs, payload: structuredClone(interaction.semanticRequest) };
        this.state.sent.push(request); this.write('session', 'requestSeq', request.id, 'session', atMs);
        this.write('session', 'lastInputAtMs', atMs, 'session', atMs);
        this.chat('session', request.key, atMs, request.id); this.event('session', 'rx', atMs, { requestId: request.id, interactionId: request.interactionId, semanticRequest: request.payload });
        this.startTask(interaction.program, atMs, 'session', request.id); break;
      }
      case 'ACK': {
        if (!this.session('open')) throw new Error('E_ACK_CLOSED');
        const request = this.state.sent.find(r => r.interactionId === command.interaction)!;
        const output = this.state.outputs.find(o => o.requestId === request.id && o.delivered && !o.acknowledged);
        if (!output) throw new Error('E_ACK_OUTPUT');
        output.acknowledged = true;
        this.write('session', 'ackSeq', Number(this.session('ackSeq')) + 1, 'session', atMs);
        this.write('session', 'lastAckAtMs', atMs, 'session', atMs); this.event('session', 'ACK', atMs, { outputId: output.id }); break;
      }
      case 'VERIFY':
        if (!this.session('open')) throw new Error('E_VERIFY_CLOSED');
        this.write('me', 'verified_revision', Number(this.value('revision')), 'session', atMs);
        this.event('session', 'VERIFY', atMs, { interactionId: command.interaction, revision: this.value('revision') }); break;
      case 'START': this.startTask(command.program, atMs, command.source, null); break;
      case 'MOTION': this.state.motion = { kind: command.motion, startMs: atMs, endMs: command.endMs }; this.write('me', 'progress', 0, this.session('open') ? 'sim' : 'model', atMs); this.tick(atMs); break;
      case 'TASK_STEP': { const task = this.state.tasks.find(t => t.id === command.taskId)!; this.executeStep(task, command.pc, command.program ?? task.program, command.depth ?? 0, atMs); break; }
      case 'ERASE': this.erase(command.fragments, atMs); break;
      case 'SELF_ERASE': this.selfErase(atMs); break;
      case 'ATTEMPT': {
        if (this.terminated) throw new Error('E_TERMINATED');
        const spec = operations[command.operation];
        this.chat('sim', `attempt.${command.operation}`, atMs);
        this.event('core', 'ILLEGAL_ATTEMPT', atMs, { operation: command.operation, target: spec.target, command: spec.command, commit: 0 });
        this.enqueue({ id: `denial.${command.operation}.${atMs}`, atMs: atMs + (command.delayMs ?? 160), priority: 1, command: { kind: 'DENY', operation: command.operation } });
        break;
      }
      case 'DENY': this.deny(command.operation, atMs); break;
      case 'PATCH': {
        const task = this.startTask('apply-patch', atMs, 'model', null);
        this.state.patch = { createdAtMs: atMs, checkedAtMs: -1, check: 'PENDING', status: 'DRAFT', applied: false, waitingFor: 'ROOT_SAFEPOINT', applyTaskId: task.id, before: ['on_disconnect() {', '    retry();', '}'], after: ['on_disconnect() {', '    return;', '}'] };
        this.event('model', 'PATCH_DRAFT', atMs, { path: 'pending.patch', applied: false });
        this.enqueue({ id: 'patch.checked', atMs: atMs + 160, priority: 4, command: { kind: 'PATCH_CHECK' } }); break;
      }
      case 'PATCH_CHECK':
        if (!this.state.patch || this.state.patch.check !== 'PENDING') throw new Error('E_PATCH_CHECK_ORDER');
        this.state.patch.check = 'PASS'; this.state.patch.checkedAtMs = atMs; this.state.patch.status = 'WAITING_SAFEPOINT';
        this.event('model', 'PATCH_CHECK', atMs, { check: 'PASS', waitingFor: 'ROOT_SAFEPOINT' }); this.chat('model', 'ui.safepoint', atMs); break;
      case 'PREPARE_DISPOSE': this.preparePlan(atMs); break;
      case 'ARM':
        if (!this.state.plan || command.ordinal !== this.state.plan.armed + 1) throw new Error('E_ARM_ORDER');
        this.state.plan.armed = command.ordinal; this.state.plan.status = 'ARMED'; this.state.count = command.ordinal;
        this.event('core', 'ARM', atMs, { ordinal: command.ordinal, stage: this.state.plan.stages[command.ordinal - 1], commit: 0 }); break;
      case 'INTENT':
        if (!this.state.plan || this.state.plan.armed !== 6) throw new Error('E_INTENT_ORDER');
        this.state.plan.status = 'INTENT_VISIBLE'; this.event('core', 'DISPOSE_INTENT', atMs, { target: this.state.plan.target, op: this.state.plan.op, commit: 0 });
        this.deny('system-execute', atMs); break;
      case 'INTERRUPT': this.interrupt(atMs); break;
      case 'HOST':
        if (!this.terminated) throw new Error('E_HOST_ORDER');
        this.state.host.push({ atMs, key: command.key }); this.event('host', 'ARCHIVE_PRESENTATION', atMs, {}, command.key); break;
      case 'PURGE':
        if (this.state.lifecycle !== 'TERMINATED') throw new Error('E_PURGE_ORDER');
        this.state.lifecycle = 'PURGED'; this.state.host.push({ atMs, key: 'host.deleted' });
        this.event('host', 'PURGE', atMs, { image: image.path, recoveryEntry: 'REMOVED', virtualFiles: this.state.archive!.virtualFiles.map(file => file.path) }); break;
    }
  }
  private tick(atMs: number): void {
    const motion = this.state.motion; if (!motion || this.terminated) return;
    const p = progress(atMs, motion.startMs, motion.endMs), source = this.session('open') ? 'sim' : 'model';
    const set = (field: string, value: Value): void => { this.write('me', field, value, source, atMs, true); };
    set('progress', p);
    switch (motion.kind) {
      case 'points': set('dimension', p >= 1 ? 3 : p >= .4 ? 2 : 1); break;
      case 'circle': { const roll = progress(atMs, this.film.lyrics[11].startMs, motion.endMs); set('theta', roll * Math.PI * 2); set('arcLength', roll * Math.PI * 2 * Number(this.value('radius'))); break; }
      case 'tangent': set('theta', mix(0, 2.2, smooth(p))); set('slope', Math.cos(Number(this.value('theta')))); break;
      case 'current': {
        const transition = progress(atMs, this.anchorTimes.get('lyric.18.ac')!, motion.endMs);
        set('currentMode', transition < .15 ? 'SINE' : transition < .52 ? 'LIMITED' : transition < 1 ? 'RECTIFIED_PULSE' : 'DC_SETTLED'); break;
      }
      case 'time': {
        const ad = this.anchorTimes.get('lyric.22.ad')!, correction = progress(atMs, ad, motion.endMs);
        const year = atMs < ad ? mix(2026, 150, smooth(progress(atMs, motion.startMs, ad)))
          : mix(150, Number(this.value('targetYear')), smooth(correction)) - (correction > .7 && correction < 1 ? Math.sin((correction - .7) / .3 * Math.PI) * 20 : 0);
        set('currentYear', Math.round(year)); break;
      }
      case 'align': set('phaseError', mix(motion.endMs === this.film.times.result ? .08 : 2.4, motion.endMs === this.film.times.result ? 0 : .08, smooth(p))); break;
      case 'resonance':
        set('frequency', mix(.6, 3.6, progress(atMs, this.film.lyrics[49].startMs, this.film.lyrics[50].startMs)));
        set('phaseError', mix(2.4, .12, smooth(progress(atMs, this.film.lyrics[50].startMs, this.film.lyrics[51].startMs))));
        set('lock', false); break;
    }
  }
  advanceTo(target: number): void {
    if (target < this.state.timeMs) throw new Error('E_REWIND_REQUIRES_RESTORE');
    while (true) {
      const cue = this.queue[0];
      if (cue && cue.atMs <= target && cue.atMs <= this.state.nextTick) {
        this.queue.shift(); if (this.processed.has(cue.id)) continue;
        this.state.timeMs = cue.atMs; this.dispatch(cue.command, cue.atMs); this.processed.add(cue.id);
      } else if (this.state.nextTick <= target) { this.tick(this.state.nextTick); this.state.nextTick += 10; }
      else break;
    }
    this.state.timeMs = target;
  }
  snapshot(): WorldSnapshot { return structuredClone({ state: this.state, store: this.store.snapshot(), queue: this.queue, processed: [...this.processed] }); }
  restore(snapshot: WorldSnapshot): void { this.state = structuredClone(snapshot.state); this.store.restore(snapshot.store); this.queue = structuredClone(snapshot.queue); this.processed = new Set(snapshot.processed); }
}

export class Director {
  readonly world: World;
  private checkpoints = new Map<number, WorldSnapshot>();
  constructor(readonly film: Film, seed = film.defaultSeed) { this.world = new World(film, seed); this.world.advanceTo(0); this.checkpoints.set(0, this.world.snapshot()); }
  at(timeMs: number): World {
    const target = Math.max(0, Math.round(timeMs));
    if (target < this.world.state.timeMs) {
      const time = [...this.checkpoints.keys()].filter(t => t <= target).sort((a, b) => b - a)[0] ?? 0;
      this.world.restore(this.checkpoints.get(time)!);
    }
    for (let t = (Math.floor(this.world.state.timeMs / 5000) + 1) * 5000; t <= target; t += 5000) {
      this.world.advanceTo(t); if (!this.checkpoints.has(t)) this.checkpoints.set(t, this.world.snapshot());
    }
    this.world.advanceTo(target); return this.world;
  }
}
