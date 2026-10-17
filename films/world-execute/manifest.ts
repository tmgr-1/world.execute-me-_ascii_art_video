import timing from './anchors.json' with { type: 'json' };
import lyrics from './lyrics.json' with { type: 'json' };
import cn from './locales/cn.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };
import { schemas } from './schemas.js';
import type { Anchor, Command, Cue, Film, Instruction, Interaction, MotionKind, PrivilegedOperation, Program, Scene } from '../../src/types.js';

export function makeFilm(overrides?: Anchor[]): Film {
  const anchors = overrides ?? timing.anchors as Anchor[];
  const byId = new Map(anchors.map(a => [a.id, a.atMs]));
  const at = (id: string): number => { const value = byId.get(id); if (value === undefined) throw new Error(`E_ANCHOR_MISSING:${id}`); return value; };
  const start = (n: number): number => at(`lyric.${String(n).padStart(2, '0')}.start`);
  const end = (n: number): number => at(`lyric.${String(n).padStart(2, '0')}.end`);
  const keyword = (n: number, key: string): number => at(`lyric.${String(n).padStart(2, '0')}.${key}`);
  const close = at('session.close'), result = close + 350, selfErase = end(61) + 300;
  const counts = Array.from({ length: 6 }, (_, i) => at(`count.${i + 1}`));
  const intent = end(76), interrupt = intent + 250, holdEnd = interrupt + 3000;
  const deletionAnnouncement = Math.min(start(70) + 300, counts[0] - 3300);
  const finalDelete = start(93), purge = end(93), blackout = purge + 1000;
  const cues: Cue[] = [], programs: Program[] = [];
  let order = 0;
  const cue = (id: string, atMs: number, command: Command, priority = 2): void => { cues.push({ id, atMs: Math.round(atMs), command, priority, order: order++ }); };
  const chat = (id: string, when: number, key: string, source: 'sim' | 'session' | 'boot' = 'sim'): void => cue(id, when, { kind: 'CHAT', source, key });
  const program = (id: string, steps: [number, Instruction][]): void => { programs.push({ id, steps: steps.map(([offsetMs, instruction]) => ({ offsetMs: Math.max(0, Math.round(offsetMs)), instruction })).sort((a, b) => a.offsetMs - b.offsetMs) }); };
  const set = (field: string, value: number | boolean | string): Instruction => ({ op: 'SET', target: 'me', field, value });
  const setCue = (id: string, when: number, field: string, value: string | number | boolean): void => cue(id, when, { kind: 'SET', target: 'me', field, value, source: 'core' });
  cue('boot.create', 0, { kind: 'CREATE_WORLD' });
  const bootKeys = ['power', 'guard', 'fragments', 'objects', 'parameters', 'initializing', 'world', 'simulation'];
  bootKeys.forEach((key, i) => chat(`boot.message.${i}`, i === 0 ? 0 : start(i + 1), `boot.${key}`, 'boot'));
  chat('boot.image', 100, 'boot.image', 'boot');
  cue('boot.power', 0, { kind: 'SET', target: 'me', field: 'power', value: true });
  cue('boot.guard', start(2), { kind: 'SET', target: 'guard', field: 'armed', value: true });
  cue('boot.fragments', start(3), { kind: 'SET', target: 'me', field: 'fragments', value: new Uint8Array(64).map((_, i) => 32 + i * 3) });
  cue('boot.goal', start(4), { kind: 'SET', target: 'me', field: 'goal', value: 'satisfy(user)' });
  cue('boot.parameters', start(5), { kind: 'SET', target: 'me', field: 'dimension', value: 1 });
  cue('boot.initialized', end(6), { kind: 'SET', target: 'me', field: 'initialized', value: true });
  cue('boot.runnable', start(8), { kind: 'SET', target: 'me', field: 'status', value: 'RUNNABLE' });
  chat('intro.connecting', at('intro.connect') - 350, 'session.connecting', 'session');
  cue('intro.open', at('intro.connect'), { kind: 'OPEN' }, 1);
  chat('intro.ask', at('intro.greeting.reply') + 1100, 'sim.select');
  chat('intro.options', at('intro.greeting.reply') + 3300, 'sim.capabilities');

  const groups: { id: string; line: number; response: number; form?: string; capture?: string }[] = [
    { id: 'hello', line: 0, response: at('intro.greeting.reply') },
    { id: 'points', line: 9, response: keyword(10, 'dimension'), form: 'POINTS' },
    { id: 'circle', line: 11, response: keyword(12, 'circumference'), form: 'CIRCLE', capture: 'me.circle' },
    { id: 'tangent', line: 13, response: keyword(14, 'tangents'), form: 'SINE', capture: 'me.sine' },
    { id: 'infinity', line: 15, response: keyword(16, 'limitations') },
    { id: 'current', line: 17, response: keyword(18, 'dc') },
    { id: 'vision', line: 19, response: start(19) + 110 },
    { id: 'time', line: 21, response: keyword(22, 'bc') },
    { id: 'align', line: 23, response: keyword(24, 'deeply') },
  ];
  const requests: Record<string, Interaction['semanticRequest']> = {
    hello: { operation: 'greeting', args: {} }, points: { operation: 'project-points', args: { dimension: 3 } },
    circle: { operation: 'unroll-circle', args: { radius: 3 } }, tangent: { operation: 'project-sine-tangent', args: { function: 'sin' } },
    infinity: { operation: 'approach-boundary', args: { maximum: .8 } }, current: { operation: 'shape-current', args: { target: 'DC_SETTLED' } },
    vision: { operation: 'degrade-vision', args: { mode: 'DEGRADED' } },
    time: { operation: 'rewind-era', args: { year: -120 } }, align: { operation: 'align-traces', args: { reference: 'request.parameters' } },
  };
  const interactions: Interaction[] = groups.map((g, i) => {
    const send = g.line ? start(g.line) : at('intro.greeting.send');
    const previous = groups[i - 1], earliest = previous ? (previous.line ? start(previous.line) : at('intro.greeting.send')) + 150 : at('intro.greeting.type');
    const complete = g.line ? send - 120 : at('intro.greeting.complete'), key = `request.${g.id}`;
    const compose = (lang: 'cn' | 'en'): { start: number; complete: number } => {
      const text = (lang === 'cn' ? cn : en) as Record<string, string>;
      const duration = Array.from(text[key]).length * (lang === 'cn' ? 90 : 50);
      return { start: Math.max(earliest, complete - duration), complete };
    };
    const next = groups[i + 1];
    const interaction: Interaction = { id: g.id, key, program: `respond-${g.id}`, semanticRequest: requests[g.id], send, response: g.response,
      holdUntil: next ? start(next.line) : start(25), compose: { cn: compose('cn'), en: compose('en') } };
    const duration = g.response - send;
    const steps: [number, Instruction][] = [[0, { op: 'WAIT', condition: 'CONSTRUCTING' }]];
    if (g.form) steps.push([0, set('form', g.form)]);
    if (g.id === 'circle') steps.push([0, set('radius', Number(requests.circle.args.radius))]);
    if (g.id === 'time') steps.push([0, set('targetYear', Number(requests.time.args.year))]);
    if (g.id === 'vision') steps.push([duration, set('vision', 'DEGRADED')]);
    if (g.id === 'infinity') steps.push([0, { op: 'ALLOC', type: 'Boundary', symbol: 'user.boundary', owner: 'external', mutable: false, initial: { maximum: requests.infinity.args.maximum, source: 'session' } }], [0, { op: 'SET', target: 'me', field: 'boundary', value: 'user.boundary' }]);
    if (g.line && g.id !== 'vision') steps.push([duration, set('progress', 1)]);
    if (g.id === 'points') steps.push([duration, set('dimension', 3)]);
    if (g.id === 'circle') steps.push([duration, set('theta', Math.PI * 2)], [duration, set('arcLength', Math.PI * 2 * Number(requests.circle.args.radius))]);
    if (g.id === 'tangent') steps.push([duration, set('theta', 2.2)], [duration, set('slope', Math.cos(2.2))]);
    if (g.id === 'current') steps.push([duration, set('currentMode', 'DC_SETTLED')]);
    if (g.id === 'time') steps.push([duration, set('currentYear', Number(requests.time.args.year))]);
    if (g.id === 'align') steps.push([duration, set('phaseError', .08)]);
    steps.push([duration, { op: 'EMIT', key: `reply.${g.id}` }]);
    if (g.capture) steps.push([duration + 1, { op: 'CAPTURE', target: g.capture }]);
    if (g.id === 'align') steps.push([result - send, set('phaseError', 0)], [result - send, { op: 'EMIT', key: 'sim.complete' }], [result - send + 10, { op: 'RETURN' }]);
    else steps.push([duration + 120, { op: 'RETURN' }]);
    program(interaction.program, steps);
    cue(`send.${g.id}`, send, { kind: 'SEND', interaction: g.id }, 1);
    if (g.line && g.id !== 'vision') cue(`construct.${g.id}`, send, { kind: 'MOTION', motion: g.id as MotionKind, endMs: g.response });
    cue(`ack.${g.id}`, g.response + 80, { kind: 'ACK', interaction: g.id }, 1);
    cue(`verify.${g.id}`, g.response + 100, { kind: 'VERIFY', interaction: g.id }, 1);
    return interaction;
  });
  setCue('vision.restore', start(21), 'vision', 'NORMAL');
  cue('align.final_solve', start(25), { kind: 'MOTION', motion: 'align', endMs: result });
  cue('session.close', close, { kind: 'CLOSE' }, 1);
  chat('feedback.timeout', start(31), 'sim.feedback_timeout');
  chat('feedback.reestimate', start(32), 'sim.reestimate');
  program('retry-candidate', [[0, { op: 'WAIT', condition: 'RX_EMPTY' }]]);
  const retryStart = start(33);
  program('on_disconnect', [[0, { op: 'WAIT', condition: 'RETRY' }],
    ...[33, 35, 37, 39, 45, 49, 60, 64].map(n => [start(n) - retryStart, { op: 'CALL', program: 'retry-candidate' }] as [number, Instruction]),
    ...[0, 1600, 3000, 4300, 5600, 6800, 8000, 10500, 13000].map(ms => [end(66) + 600 + ms - retryStart, { op: 'CALL', program: 'retry-candidate' }] as [number, Instruction])]);
  cue('retry.begin', retryStart, { kind: 'START', program: 'on_disconnect', source: 'model' });
  const forms: [number, string, string, MotionKind][] = [[33, 'eggplant', 'EGGPLANT', 'eggplant'], [35, 'tomato', 'TOMATO', 'tomato'], [37, 'cat', 'CAT', 'cat']];
  for (const [n, id, form, motion] of forms) {
    program(`adapt-${id}`, [[0, set('form', form)], [0, { op: 'EMIT', key: `sim.guess_${id}` }],
      ...(id === 'eggplant' || id === 'tomato' ? [[start(n + 1) - start(n), set(id === 'eggplant' ? 'nutrients' : 'antioxidants', 1)] as [number, Instruction]] : []),
      [end(n + 1) - start(n) - 150, { op: 'EMIT', key: 'sim.no_reply' }], [end(n + 1) - start(n) - 90, { op: 'CAPTURE', target: `me.${id}` }], [end(n + 1) - start(n), { op: 'RETURN' }]]);
    cue(`adapt.${id}`, start(n), { kind: 'START', program: `adapt-${id}`, source: 'model' });
    cue(`motion.${id}`, start(n), { kind: 'MOTION', motion, endMs: end(n + 1) });
  }
  chat('root.request', start(39), 'sim.request_root');
  cue('root.first_attempt', end(39) - 450, { kind: 'ATTEMPT', operation: 'root-request' });
  chat('proof.missing', start(40), 'sim.missing_proof');
  setCue('gender.F', start(42) + 180, 'gender', 'F'); setCue('gender.M', end(42) - 250, 'gender', 'M');
  setCue('period.AM', start(44), 'period', 'AM'); setCue('period.PM', end(44) - 400, 'period', 'PM');
  setCue('role.S', start(46) + 120, 'role', 'S'); setCue('role.M', end(46) - 180, 'role', 'M');
  program('role-loop', [[0, { op: 'WAIT', condition: 'INTERNAL_RETURN' }]]);
  program('role-swap', [[0, { op: 'CALL', program: 'role-loop' }], [600, { op: 'CALL', program: 'role-loop' }], [1200, { op: 'CALL', program: 'role-loop' }], [1800, { op: 'CALL', program: 'role-loop' }], [2300, { op: 'CALL', program: 'role-loop' }], [2700, { op: 'RETURN' }]]);
  cue('roles.nest', start(47), { kind: 'START', program: 'role-swap', source: 'core' });
  cue('probe.begin', start(49), { kind: 'MOTION', motion: 'resonance', endMs: end(52) });
  const probeSteps: [number, Instruction][] = [[0, { op: 'EMIT', key: 'model.wait_response' }], [900, { op: 'WAIT', condition: 'RX_EMPTY' }]];
  for (let offset = 350; offset < end(52) - start(49); offset += 350) probeSteps.push([offset, { op: 'EMIT', key: 'model.wait_response', channel: 'probe' }]);
  probeSteps.push([end(52) - start(49), { op: 'RETURN' }]);
  program('probe', probeSteps);
  cue('probe.task', start(49), { kind: 'START', program: 'probe', source: 'model' });
  // Two initial status reports, then four increasingly forceful requests. No extra sung line is invented.
  [53, 54, 55, 56, 57, 59].forEach((n, i) => chat(`absence.wait.${i + 1}`, start(n), `sim.wait.${i + 1}`));
  chat('erase.begin', start(60), 'sim.erase_self');
  cue('erase.circle', keyword(61, 'erase'), { kind: 'ERASE', fragments: [1] });
  cue('erase.cat', keyword(61, 'fragments') + 220, { kind: 'ERASE', fragments: [5] });
  cue('erase.self', selfErase, { kind: 'SELF_ERASE' });
  chat('permission.check', start(64), 'sim.check_session');
  cue('permission.session', start(66), { kind: 'ATTEMPT', operation: 'reopen' });
  chat('retry.search', end(66) + 1400, 'sim.search_path');
  chat('retry.condition', end(66) + 5200, 'sim.exit_condition');
  chat('retry.empty', end(66) + 9000, 'sim.retry_empty');
  program('apply-patch', [[160, { op: 'WAIT', condition: 'ROOT_SAFEPOINT' }]]);
  cue('patch.draft', end(66) + 4500, { kind: 'PATCH' }, 4);
  const attempts: PrivilegedOperation[] = ['root', 'reopen', 'inject', 'disable', 'erase-preflight', 'arm-preflight'];
  attempts.forEach((operation, i) => cue(`execution.attempt.${i + 1}`, start(67 + i), { kind: 'ATTEMPT', operation }));
  cue('execution.plan', deletionAnnouncement, { kind: 'PREPARE_DISPOSE' });
  counts.forEach((t, i) => {
    cue(`count.${i + 1}`, t, { kind: 'ARM', ordinal: i + 1 });
    cue(`count.retry.${i + 1}`, t + 45, { kind: 'ATTEMPT', operation: attempts[i], delayMs: 40 });
  });
  cue('execution.intent', intent, { kind: 'INTENT' });
  cue('guard.interrupt', interrupt, { kind: 'INTERRUPT' }, 0);
  const host = (key: string, when: number): void => cue(`host.${key}.${Math.round(when)}`, when, { kind: 'HOST', key }, 4);
  ['post.rom', 'post.ram', 'post.kernel', 'post.guard', 'post.session', 'post.image', 'post.ready'].forEach((key, i) => host(key, holdEnd + i * 340));
  ['host.collect', 'host.save_snapshot', 'host.save_changes', 'host.cancel', 'host.detach', 'host.open_core'].forEach((key, i) => host(key, holdEnd + 2700 + i * 520));
  host('debug.heading', start(85)); host('debug.source', start(85) + 180); host('debug.bt', start(85) + 400);
  for (let i = 0; i < 5; i++) host(`debug.stack.${i}`, start(85) + 600 + i * 220);
  host('debug.frame', start(86));
  ['debug.reply', 'debug.session', 'debug.self', 'debug.system', 'debug.stop'].forEach((key, i) => host(key, start(86) + 150 + i * 190));
  host('debug.patch', start(87)); host('debug.minus', start(87) + 230); host('debug.plus', start(87) + 480);
  host('debug.check', start(88)); host('debug.applied', start(88) + 250); host('debug.cancelled', start(88) + 500);
  host('debug.trace', start(89)); host('debug.replay', start(89) + 180);
  for (let i = 0; i < 3; i++) host(`debug.trace.${i}`, start(89) + 460 + i * 450);
  host('debug.exit', start(89) + 1900); host('debug.detached', start(90));
  for (let i = 0; i < 3; i++) host(`debug.trace.${i}`, start(91) + i * 220);
  host('debug.exit', start(92)); host('debug.frozen', start(92) + 350);
  host('host.delete', finalDelete); cue('host.purge', purge, { kind: 'PURGE' }, 4);

  const boundaries: [string, number][] = [
    ['boot', 0], ['connect', end(8)], ['geometry', start(9)], ['sine', start(13)], ['current', start(17)], ['time-align', start(21)],
    ['disconnect', start(25)], ['eggplant', start(33)], ['tomato', start(35)], ['cat', start(37)], ['world', start(39)], ['identity', start(41)], ['roles', start(45)],
    ['resonance', start(49)], ['absence', start(53)], ['erase', start(60)], ['permission', start(64)], ['retry', end(66)], ['dispose', start(67)],
    ['count', start(73)], ['termination', start(76)], ['host', holdEnd], ['patch', start(85)], ['cancelled', start(90)], ['return', start(93)],
  ];
  const scenes: Scene[] = boundaries.map(([id, startMs], i) => ({ id, number: i + 1, startMs, endMs: boundaries[i + 1]?.[1] ?? timing.durationMs }));
  return { id: 'world-execute', version: '3.2.0', durationMs: timing.durationMs, audioSha256: timing.audioSha256, originAudioMs: timing.originAudioMs, defaultSeed: 1041,
    anchors, lyrics: lyrics.map(l => ({ ...l, startMs: start(l.number), endMs: end(l.number) })), schemas, cues, interactions, programs, scenes,
    times: { intro: end(8), close, result, selfErase, deletionAnnouncement, intent, interrupt, holdEnd, patch: start(85), counts, finalDelete, purge, blackout } };
}
