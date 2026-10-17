import { Canvas, color, graphemes, width } from './canvas.js';
import { hash } from './math.js';
import type { Film } from './types.js';
import { countLanguages, countText } from '../films/world-execute/story.js';

export function corruptionDensity(film: Film, timeMs: number): number {
  if (timeMs >= film.times.interrupt) return 0;
  return film.corruption.findLast(stage => stage.atMs <= timeMs)?.density ?? 0;
}

const ascii = Array.from('#/\\:;|_.01+=');
const noise = countText.map(data => Array.from(data.noise).filter(g => width(g) === 1));
const fragments = countText.map(data => data.fragments.map(text => graphemes(text)));

/** One transient, viewport-wide budget. Nothing from a previous frame is retained. */
export function corrupt(c: Canvas, film: Film, seed: number, timeMs: number, count: number): void {
  const density = corruptionDensity(film, timeMs);
  if (!density) return;
  const quantum = Math.floor(timeMs / 90), total = c.cells.length;
  let rng = Math.floor(hash(seed, 'viewport-noise', c.columns, c.rows, quantum) * 0x100000000) || 1;
  const random = (): number => {
    rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
    return (rng >>> 0) / 0x100000000;
  };
  const changed = new Uint8Array(total);
  let remaining = Math.floor(total * density);

  // Expand each write to whole underlying glyphs, including both halves of CJK.
  const span = (index: number, columns: number): { x: number; y: number; n: number } => {
    const y = Math.floor(index / c.columns);
    let x = index % c.columns;
    if (c.get(x, y)!.continuation) x--;
    let end = Math.min(c.columns, x + columns);
    if (end < c.columns && c.get(end, y)!.continuation) end++;
    return { x, y, n: end - x };
  };
  const write = (index: number, columns: number, text: string[], language?: string, region?: string): boolean => {
    const { x, y, n } = span(index, columns), at = y * c.columns + x;
    if (n > remaining || changed.subarray(at, at + n).some(Boolean)) return false;
    // Clear the entire selected span first, so every changed cell carries the
    // damage semantic even when a former wide glyph becomes single-cell noise.
    for (let i = 0; i < n; i++) {
      changed[at + i] = 1;
      c.set(x + i, y, ascii[Math.floor(random() * ascii.length)], { fg: color.dim }, 'corruption', language);
    }
    let dx = 0;
    for (const g of text) {
      const w = width(g); if (dx + w > n) break;
      const r = random();
      c.set(x + dx, y, g, { fg: r > .9 ? color.red : r > .45 ? color.purple : color.dim }, 'corruption', language);
      dx += w;
    }
    remaining -= n;
    if (region) c.regions.set(region, { x, y, w: n, h: 1 });
    return true;
  };

  // Existing languages accumulate, but their addresses are resampled each tick.
  // A growing share of the SAME budget becomes text spill at each count.
  // Meaningful translations belong to the base view, not this noise stream.
  const budget = remaining, spillTarget = Math.floor(budget * ([0, .08, .18, .28, .40, .53, .67][count] ?? .67));
  let spill = 0;
  for (let i = 0; count && (i < count || spill < spillTarget) && i < 64; i++) {
    const stage = i % count;
    const text = fragments[stage][Math.floor(random() * fragments[stage].length)];
    const columns = text.reduce((n, g) => n + width(g), 0);
    for (let attempt = 0; attempt < 24; attempt++) {
      const index = Math.floor(random() * total);
      if (index % c.columns + columns > c.columns) continue;
      const before = remaining;
      if (write(index, columns, text, countLanguages[stage], `spill.${countLanguages[stage]}.${i}`)) {
        spill += before - remaining;
        break;
      }
    }
  }

  // A partial Fisher–Yates sample covers the whole canvas without replacement.
  // Sampling addresses, rather than panes or fixed scars, also includes blanks.
  const order = Uint32Array.from({ length: total }, (_, i) => i);
  for (let i = 0; i < total && remaining; i++) {
    const j = i + Math.floor(random() * (total - i));
    [order[i], order[j]] = [order[j], order[i]];
    const index = order[i];
    if (changed[index]) continue;
    const language = count ? Math.floor(random() * count) : -1;
    const pool = language < 0 ? ascii : noise[language];
    const text = [pool[Math.floor(random() * pool.length)]];
    write(index, 1, text, language < 0 ? undefined : countLanguages[language]);
  }
}
