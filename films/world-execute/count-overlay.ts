import { Canvas, color, graphemes, width, type Style } from '../../src/canvas.js';
import { hash } from '../../src/math.js';
import { countLanguages, countText } from './story.js';

export interface CountWrite { x: number; y: number; text: string; columns: number; style: Style; semantic: string }
export interface CountLayer { language: string; columns: number; rows: number; writtenCells: number; writes: CountWrite[] }

/** One authored write per syllable. Its seed never includes later counts or time. */
export function makeCountLayer(source: Canvas, seed: number, ordinal: number): CountLayer {
  const language = countLanguages[ordinal - 1], data = countText[ordinal - 1];
  if (!language) throw new Error('E_COUNT_LAYER');
  const total = source.cells.length, budget = Math.floor(total * .20), used = new Uint8Array(total);
  const writes: CountWrite[] = [];
  let remaining = budget, rng = Math.floor(hash(seed, 'count-write', source.columns, source.rows, ordinal) * 0x100000000) || 1;
  const random = (): number => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 0x100000000; };
  const append = (x: number, y: number, text: string, ink: Style, semantic: string): void => {
    const columns = width(text), start = y * source.columns + x;
    if (!columns || columns > remaining || x + columns > source.columns || used.subarray(start, start + columns).some(Boolean)) return;
    used.fill(1, start, start + columns); remaining -= columns;
    writes.push({ x, y, text, columns, style: { fg: ink.fg, bg: ink.bg, bold: ink.bold }, semantic });
  };

  // Capture only THIS language's real translations at its own entrance. Later
  // source layouts must not relocate or refill earlier translations. At six,
  // Chinese consists entirely of invalid fragments, not a clean system tree.
  if (ordinal < 6) for (let y = 0; y < source.rows; y++) for (let x = 0; x < source.columns;) {
    const first = source.get(x, y)!;
    if (first.language !== language || first.continuation) { x++; continue; }
    const start = x; let text = '';
    while (x < source.columns) {
      const cell = source.get(x, y)!;
      if (cell.language !== language || cell.continuation || cell.semantic !== first.semantic || cell.fg !== first.fg || cell.bg !== first.bg || cell.bold !== first.bold) break;
      text += cell.g; x += cell.width;
    }
    append(start, y, text, first, first.semantic ?? 'count.translation');
  }

  // Sample the WHOLE viewport. Within this write each cell is used once; cells
  // from previous languages are deliberately not consulted or protected.
  const order = Uint32Array.from({ length: total }, (_, i) => i);
  for (let i = 0; i < total && remaining; i++) {
    const j = i + Math.floor(random() * (total - i));
    [order[i], order[j]] = [order[j], order[i]];
    const index = order[i]; if (used[index]) continue;
    const x = index % source.columns, y = Math.floor(index / source.columns);
    let available = 0;
    while (available < remaining && x + available < source.columns && !used[index + available]) available++;
    const a = Math.floor(random() * data.fragments.length), b = Math.floor(random() * data.fragments.length);
    const phrase = data.fragments[a] + (random() < .35 ? ' ' + data.fragments[b] : '');
    let text = '', columns = 0;
    for (const g of graphemes(phrase)) { const w = width(g); if (columns + w > available) break; text += g; columns += w; }
    // A one-column gap beside CJK can still contain a program delimiter.
    if (!text) text = ';';
    const tint = random();
    append(x, y, text, { fg: tint < .12 ? color.cyan : tint < .55 ? color.purple : color.dim, bg: color.bg, bold: false }, 'count.spill');
  }
  return { language, columns: source.columns, rows: source.rows, writtenCells: budget - remaining, writes };
}

export function drawCountLayer(c: Canvas, layer: CountLayer): void {
  if (c.columns !== layer.columns || c.rows !== layer.rows) throw new Error('E_COUNT_LAYER_SIZE');
  layer.writes.forEach((write, i) => {
    c.text(write.x, write.y, write.text, write.style, write.columns, write.semantic, layer.language);
    c.regions.set(`count.layer.${layer.language}.${i}`, { x: write.x, y: write.y, w: write.columns, h: 1 });
  });
}
