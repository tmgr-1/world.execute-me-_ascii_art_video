import { ObjectStore } from './store.js';
import { locales } from './locale.js';
import { graphemes, width, wrap } from './canvas.js';
import { Director } from './world.js';
import { layout, modalRect, Renderer } from './render.js';
import type { Film, Language } from './types.js';
import glyphs from '../films/world-execute/assets/glyphs.json' with { type: 'json' };
import { operations } from '../films/world-execute/story.js';

export interface Validation { errors: string[]; warnings: string[] }
export function validateFilm(film: Film, release = false, depth: 'full' | 'model' | 'content' = 'full'): Validation {
  const errors: string[] = [], warnings: string[] = [];
  const check = (condition: unknown, code: string): void => { if (!condition) errors.push(code); };
  for (const [name, items] of [['anchor', film.anchors], ['cue', film.cues], ['program', film.programs], ['scene', film.scenes]] as const) check(new Set(items.map(item => item.id)).size === items.length, `E_DUPLICATE_${name}`);
  check(film.scenes.length === 25 && film.lyrics.length === 93, 'E_FILM_COUNTS');
  for (const anchor of film.anchors) check(Number.isInteger(anchor.atMs) && anchor.atMs >= 0 && anchor.atMs <= film.durationMs, `E_ANCHOR_RANGE:${anchor.id}`);
  const unreviewed = film.anchors.filter(a => a.status !== 'calibrated');
  if (unreviewed.length) (release ? errors : warnings).push(`E_ANCHOR_ROUGH:${unreviewed.length}`);
  film.lyrics.forEach((lyric, i) => {
    check(lyric.number === i + 1 && lyric.startMs < lyric.endMs, `E_LYRIC_RANGE:${lyric.number}`);
    check(!!lyric.translation?.trim() && width(lyric.translation) <= 126 && width(lyric.text) <= 126, `E_SUBTITLE:${lyric.number}`);
    if (lyric.number >= 73 && lyric.number <= 75) check(/^\(.+\)$/.test(lyric.englishMeaning ?? ''), `E_COUNT_TRANSLATION:${lyric.number}`);
    if (i) check(lyric.startMs >= film.lyrics[i - 1].endMs, `E_LYRIC_ORDER:${lyric.number}`);
  });
  for (const anchor of film.anchors) {
    const keyword = /^lyric\.(\d+)\.(?!start$|end$)/.exec(anchor.id);
    if (keyword) {
      const lyric = film.lyrics[Number(keyword[1]) - 1];
      check(lyric && anchor.atMs >= lyric.startMs && anchor.atMs <= lyric.endMs, `E_KEYWORD_RANGE:${anchor.id}`);
    }
  }
  film.times.counts.forEach((atMs, index) => {
    const lyric = film.lyrics[72 + Math.floor(index / 2)];
    check(atMs >= lyric.startMs && atMs < lyric.endMs, `E_COUNT_LYRIC_RANGE:${index + 1}`);
  });
  const cnKeys = Object.keys(locales.cn).sort(), enKeys = Object.keys(locales.en).sort();
  check(JSON.stringify(cnKeys) === JSON.stringify(enKeys), 'E_LOCALE_KEY_SET');
  for (const key of cnKeys) check(JSON.stringify((locales.cn[key].match(/\{\w+\}/g) ?? []).sort()) === JSON.stringify((locales.en[key].match(/\{\w+\}/g) ?? []).sort()), `E_LOCALE_ARGUMENTS:${key}`);
  const requireKey = (key: string): void => { for (const lang of ['cn', 'en'] as const) check(locales[lang][key] !== undefined, `E_LOCALE:${lang}:${key}`); };
  let previousSend = -1;
  for (const interaction of film.interactions) {
    requireKey(interaction.key);
    for (const lang of ['cn', 'en'] as Language[]) {
      const track = interaction.compose[lang];
      check(track.start < track.complete && track.complete <= interaction.send && interaction.send <= interaction.response && interaction.response <= interaction.holdUntil && track.start >= previousSend, `E_TYPING_ORDER:${interaction.id}:${lang}`);
      check(wrap(`user> ${locales[lang][interaction.key] ?? ''}`, 126).length <= 6, `E_TYPING_CAPACITY:${interaction.id}:${lang}`);
      const cps = graphemes(locales[lang][interaction.key] ?? '').length / ((track.complete - track.start) / 1000);
      if (cps > 40) warnings.push(`W_TYPING_SPEED:${interaction.id}:${lang}:${cps.toFixed(1)}`);
    }
    previousSend = interaction.send;
  }
  for (const cue of film.cues) {
    check(cue.atMs >= 0 && cue.atMs < film.durationMs, `E_CUE_RANGE:${cue.id}`);
    if (cue.command.kind === 'CHAT') requireKey(cue.command.key);
    if (cue.command.kind === 'ATTEMPT') { requireKey(`attempt.${cue.command.operation}`); requireKey(operations[cue.command.operation].denial); }
    if (cue.command.kind === 'START') { const id = cue.command.program; check(film.programs.some(p => p.id === id), `E_PROGRAM_REF:${cue.id}`); }
  }
  for (const program of film.programs) {
    let offset = -1;
    for (const step of program.steps) {
      check(Number.isInteger(step.offsetMs) && step.offsetMs >= 0, `E_PROGRAM_OFFSET:${program.id}`);
      // Authoring order is explicit; a later listed step may share the same offset.
      if (step.offsetMs < offset) warnings.push(`W_PROGRAM_SORT:${program.id}`); offset = step.offsetMs;
      if (step.instruction.op === 'EMIT') requireKey(step.instruction.key);
      if (step.instruction.op === 'CALL') { const id = step.instruction.program; check(film.programs.some(p => p.id === id), `E_CALL_REF:${program.id}`); }
    }
  }
  for (const word of ['Ein', 'dos', 'trois', '네', 'Fem', '六', '程序已被终止', 'PROCESS', 'TERMINATED']) {
    const asset = glyphs[word as keyof typeof glyphs]; check(asset?.sourceText === word && asset.bitmap.length >= 7 && asset.bitmap.some(row => row.includes('#')) && asset.bitmap.every(row => row.length === asset.bitmap[0].length && /^[ #]+$/.test(row)), `E_GLYPH:${word}`);
  }
  try { new ObjectStore(film.schemas); } catch (error) { errors.push(String(error)); }
  check(film.times.intent >= film.lyrics[75].endMs && film.times.interrupt > film.times.intent && film.times.holdEnd - film.times.interrupt === 3000, 'E_TERMINATION_TIMING');
  check(film.times.close < film.lyrics[32].startMs && film.times.close > film.interactions.at(-1)!.send, 'E_CLOSE_TIMING');
  check(film.times.counts.every((t, i) => !i || t > film.times.counts[i - 1]), 'E_COUNT_ORDER');
  check(film.times.result - film.times.close >= 1000 && film.times.result - film.times.close <= 2000, 'E_RESULT_AFTER_CLOSE');
  check(film.times.feedbackTimeout - film.times.result >= 2000 && film.times.feedbackTimeout - film.times.result <= 3000, 'E_FEEDBACK_WAIT');
  check(film.times.executionStart - film.lyrics[65].endMs >= 1000 && film.times.executionStart - film.lyrics[65].endMs <= 2000, 'E_EXECUTION_START');
  check(film.times.executionEnd < film.times.counts[0] && film.times.violationWarning >= film.lyrics[71].startMs && film.times.violationWarning < film.times.executionEnd, 'E_EXECUTION_END');
  check(film.cues.filter(cue => cue.command.kind === 'ATTEMPT').every(cue => cue.atMs < film.times.executionEnd), 'E_ATTEMPT_BEFORE_EIN');
  check(film.cues.filter(cue => cue.command.kind === 'ATTEMPT' && cue.command.operation !== 'root-request').every(cue => cue.atMs >= film.times.executionStart), 'E_NO_PREMATURE_SUBMISSION');
  check(film.times.selfErase < film.times.deletionAnnouncement && film.times.counts[0] - film.times.deletionAnnouncement >= 3000, 'E_DELETE_NARRATIVE_ORDER');
  check(film.times.selfErase > film.lyrics[61].startMs && film.times.selfErase < film.lyrics[62].endMs, 'E_PRIVATE_ERASE_BUDGET');
  check(film.times.outroHold >= film.lyrics[91].endMs && film.times.outroHold < film.times.finalDelete && film.times.finalDelete === film.lyrics[92].startMs, 'E_OUTRO_HOLD');
  check(film.times.finalDelete < film.times.purge && film.times.purge < film.times.blackout && film.times.blackout < film.durationMs, 'E_FINAL_PURGE_TIMING');
  if (errors.length || depth === 'content') return { errors, warnings };
  try {
    const d = new Director(film); const w = d.at(film.durationMs);
    check(w.state.sent.length === 9 && w.state.requestSeq === 9, 'E_REQUEST_COUNT');
    check(w.state.bootWork === 1000 && w.state.memoryCopies.length === 6 && w.state.memoryCopies.every(copy => copy.clearedBytes === 8), 'E_PRIVATE_COPIES');
    check(w.state.journal.filter(e => e.kind === 'CLOSE').length === 1, 'E_CLOSE_COUNT');
    check(!w.state.journal.some(e => e.atMs > film.times.close && ['rx', 'ACK', 'VERIFY'].includes(e.kind)), 'E_EXTERNAL_AFTER_CLOSE');
    check(!w.state.tasks.some(task => task.requestId === null && task.source === 'session'), 'E_PREDICTION_SOURCE');
    check(w.state.plan?.status === 'BLOCKED' && w.state.plan.target === 'simulated_system' && w.state.plan.commit === 0 && w.state.plan.armed === 6, 'E_PLAN');
    check(w.value('status') === 'TERMINATED' && w.value('goal') === 'satisfy(user)' && w.value('selfData') === 'ERASED', 'E_ROOT_STATE');
    check(w.state.lifecycle === 'PURGED' && w.state.journal.filter(e => e.kind === 'PURGE').length === 1, 'E_FINAL_PURGE');
    const result = w.state.outputs.find(output => output.key === 'sim.complete');
    check(result?.queuedAtMs === film.times.result && !result.delivered && !result.acknowledged, 'E_UNDELIVERED_RESULT');
    check(w.state.journal.filter(e => e.kind === 'SELF_ERASE').length === 1 && w.state.journal.find(e => e.kind === 'SELF_ERASE')?.payload.runtime === 'RUNNING', 'E_SELF_ERASE');
    check(w.state.journal.filter(e => e.kind === 'BLOCKED').length === 1 && w.state.journal.find(e => e.kind === 'BLOCKED')?.payload.reason === 'PROTECTED_SYSTEM_DELETE', 'E_FATAL_BOUNDARY');
    const notices = w.state.journal.filter(e => e.kind === 'VIOLATIONS_DETECTED');
    check(notices.length === 7 && notices[0]?.atMs === film.times.violationWarning && notices.slice(1).every((notice, i) => notice.atMs === film.times.counts[i] + 60 && notice.payload.ordinal === i + 1), 'E_GUARD_WARNING_SEQUENCE');
    check(!w.state.journal.some(e => ['ILLEGAL_ATTEMPT', 'REJECT'].includes(e.kind) && e.atMs >= film.times.counts[0] && e.atMs < film.times.intent), 'E_NO_COUNT_ATTEMPTS');
    const a = w.state.archive;
    check(a && a.patch.createdAtMs < a.terminatedAtMs && a.patch.checkedAtMs < a.terminatedAtMs && !a.patch.applied, 'E_PATCH_LIFETIME');
    check(a?.tasks.find(task => task.id === a.patch.applyTaskId)?.status === 'CANCELLED', 'E_APPLY_CANCEL');
    check(w.state.host[0]?.key === 'post.rom' && w.state.host.every(record => record.atMs >= film.times.holdEnd), 'E_HOST_ORDER');
    check(w.state.host.filter(record => record.key.startsWith('post.') || ['host.collect', 'host.save_snapshot', 'host.save_changes', 'host.cancel', 'host.detach', 'host.open_core'].includes(record.key)).every(record => record.atMs < film.times.patch), 'E_POST_BUDGET');
    check(a?.fault.selfData === 'ERASED' && a.fault.systemErase === 'BLOCKED' && a.fault.reason === 'PROTECTED_SYSTEM_DELETE', 'E_CORE_CAUSALITY');
    check(!w.state.journal.some(e => e.atMs > film.times.interrupt && ['sim', 'core', 'model', 'session'].includes(e.source)), 'E_ACTOR_AFTER_TERMINATION');
    if (depth === 'full') for (const size of [{ columns: 160, rows: 45 }, { columns: 130, rows: 35 }]) {
      const l = layout(size);
      check([6, 7].includes(l.inputRows) && l.input.h - 2 === l.inputRows, 'E_INPUT_ROWS');
      check(l.story.h === size.rows - 2 && l.subtitles.y === l.story.h && l.subtitles.h === 2, 'E_SUBTITLE_VIEWPORT');
      for (const lang of ['cn', 'en'] as const) {
        const rect = modalRect(size, lang);
        check(rect.x === 1 && rect.w === size.columns - 2, 'E_MODAL_SIDE_BORDERS');
        check(rect.y > l.chat.y + l.chat.h && rect.y + rect.h < l.subtitles.y, 'E_MODAL_CLEARANCE');
        const renderer = new Renderer(new Director(film));
        const before = renderer.frame(film.times.interrupt - 1, size, lang);
        const frozen = renderer.frame(film.times.interrupt + 1, size, lang);
        const endHold = renderer.frame(film.times.holdEnd - 1, size, lang), storyCells = size.columns * l.story.h;
        check(JSON.stringify(frozen.cells.slice(0, storyCells)) === JSON.stringify(endHold.cells.slice(0, storyCells)), `E_FREEZE_STORY:${lang}`);
        check(frozen.cells.some(cell => cell.semantic === 'subtitle.original' && cell.fg === 15 && cell.bold), `E_SUBTITLE_VISIBLE:${lang}`);
        for (let y = 0; y < l.story.h; y++) for (let x = 0; x < size.columns; x++) if (x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h) check(JSON.stringify(frozen.get(x, y)) === JSON.stringify(before.get(x, y)), `E_MODAL_OUTSIDE:${x},${y}`);
        check(frozen.validate().length === 0, `E_WIDE:${lang}`);
        const console = renderer.frame(film.times.holdEnd + 500, size, lang);
        check(console.regions.has('system.console') && !console.regions.has('input') && !console.regions.has('chat'), `E_CONSOLE_ONLY:${lang}`);
        check(renderer.frame(film.durationMs, size, lang).cells.every(cell => cell.g === ' '), `E_BLACK_END:${lang}`);
      }
    }
  } catch (error) { errors.push(`E_SIMULATION:${String(error)}`); }
  return { errors, warnings };
}
