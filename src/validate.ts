import { ObjectStore } from './store.js';
import { locales } from './locale.js';
import { graphemes, wrap } from './canvas.js';
import { Director } from './world.js';
import { layout, modalRect, Renderer } from './render.js';
import type { Film, Language } from './types.js';
import glyphs from '../films/world-execute/assets/glyphs.json' with { type: 'json' };

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
  for (const word of ['Ein', 'dos', 'trois', '네', 'Fem', '六', '终止', 'TERMINATED']) {
    const asset = glyphs[word as keyof typeof glyphs]; check(asset?.sourceText === word && asset.bitmap.length >= 7 && asset.bitmap.some(row => row.includes('#')) && asset.bitmap.every(row => row.length === asset.bitmap[0].length && /^[ #]+$/.test(row)), `E_GLYPH:${word}`);
  }
  try { new ObjectStore(film.schemas); } catch (error) { errors.push(String(error)); }
  check(film.times.intent >= film.lyrics[75].endMs && film.times.interrupt > film.times.intent && film.times.holdEnd - film.times.interrupt === 3000, 'E_TERMINATION_TIMING');
  check(film.times.close < film.lyrics[32].startMs && film.times.close > film.interactions.at(-1)!.send, 'E_CLOSE_TIMING');
  check(film.times.counts.every((t, i) => !i || t > film.times.counts[i - 1]), 'E_COUNT_ORDER');
  if (errors.length || depth === 'content') return { errors, warnings };
  try {
    const d = new Director(film); const w = d.at(film.durationMs);
    check(w.state.sent.length === 8 && w.state.requestSeq === 8, 'E_REQUEST_COUNT');
    check(w.state.journal.filter(e => e.kind === 'CLOSE').length === 1, 'E_CLOSE_COUNT');
    check(!w.state.journal.some(e => e.atMs > film.times.close && ['rx', 'ACK', 'VERIFY'].includes(e.kind)), 'E_EXTERNAL_AFTER_CLOSE');
    check(!w.state.tasks.some(task => task.requestId === null && task.source === 'session'), 'E_PREDICTION_SOURCE');
    check(w.state.plan?.status === 'BLOCKED' && w.state.plan.commit === 0 && w.state.plan.armed === 6, 'E_PLAN');
    check(w.value('status') === 'TERMINATED' && w.value('goal') === 'satisfy(user)', 'E_ROOT_STATE');
    const a = w.state.archive;
    check(a && a.patch.createdAtMs < a.terminatedAtMs && a.patch.checkedAtMs < a.terminatedAtMs && !a.patch.applied, 'E_PATCH_LIFETIME');
    check(a?.tasks.find(task => task.id === a.patch.applyTaskId)?.status === 'CANCELLED', 'E_APPLY_CANCEL');
    check(w.state.host.length <= 4 && w.state.host.every(record => record.atMs < film.times.patch), 'E_HOST_BUDGET');
    check(!w.state.journal.some(e => e.atMs > film.times.interrupt && ['sim', 'core', 'model', 'session'].includes(e.source)), 'E_ACTOR_AFTER_TERMINATION');
    if (depth === 'full') for (const size of [{ columns: 160, rows: 45 }, { columns: 130, rows: 35 }]) {
      const l = layout(size), rect = modalRect(size);
      check([6, 7].includes(l.inputRows) && l.input.h - 2 === l.inputRows, 'E_INPUT_ROWS');
      const ratio = rect.w * rect.h / (size.columns * size.rows); check(ratio >= .76 && ratio <= .84, 'E_MODAL_AREA');
      for (const lang of ['cn', 'en'] as const) {
        const renderer = new Renderer(new Director(film));
        const before = renderer.frame(film.times.interrupt - 1, size, lang);
        const frozen = renderer.frame(film.times.interrupt + 1, size, lang);
        check(frozen.hash() === renderer.frame(film.times.holdEnd - 1, size, lang).hash(), `E_FREEZE:${lang}`);
        for (let y = 0; y < size.rows; y++) for (let x = 0; x < size.columns; x++) if (x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h) check(JSON.stringify(frozen.get(x, y)) === JSON.stringify(before.get(x, y)), `E_MODAL_OUTSIDE:${x},${y}`);
        check(frozen.validate().length === 0, `E_WIDE:${lang}`);
      }
    }
  } catch (error) { errors.push(`E_SIMULATION:${String(error)}`); }
  return { errors, warnings };
}
