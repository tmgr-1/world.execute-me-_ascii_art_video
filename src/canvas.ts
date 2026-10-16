import stringWidth from 'string-width';
import { createHash } from 'node:crypto';
import type { Rect, Size } from './types.js';

export const color = { bg: 0, text: 252, dim: 244, faint: 238, cyan: 81, green: 150, gold: 222, red: 203, purple: 141, blue: 75, paper: 255, ink: 16 };
export interface Style { fg: number; bg: number; bold: boolean }
export interface Cell extends Style { g: string; width: 1 | 2; continuation: boolean; semantic?: string; language?: string }
const base: Style = { fg: color.text, bg: color.bg, bold: false };
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (s: string): string[] => Array.from(segmenter.segment(s), item => item.segment);
const widths = new Map<string, number>();
export function width(s: string): number {
  let n = widths.get(s);
  if (n === undefined) { n = stringWidth(s); if (widths.size < 4096) widths.set(s, n); }
  return n;
}
const blank = (style: Style = base): Cell => ({ g: ' ', width: 1, continuation: false, ...style, semantic: undefined, language: undefined });
export class Canvas {
  readonly cells: Cell[];
  readonly regions = new Map<string, Rect>();
  constructor(readonly columns: number, readonly rows: number) {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) throw new Error('E_CANVAS_SIZE');
    this.cells = Array.from({ length: columns * rows }, () => blank());
  }
  get size(): Size { return { columns: this.columns, rows: this.rows }; }
  get(x: number, y: number): Cell | undefined { return this.cells[y * this.columns + x]; }
  private reset(at: number, style: Partial<Style>): void {
    const cell = this.cells[at]; cell.g = ' '; cell.width = 1; cell.continuation = false;
    cell.fg = style.fg ?? base.fg; cell.bg = style.bg ?? base.bg; cell.bold = style.bold ?? false; cell.semantic = undefined; cell.language = undefined;
  }
  private erase(x: number, y: number, style: Partial<Style> = {}): void {
    const c = this.get(x, y); if (!c || x < 0 || x >= this.columns || y < 0 || y >= this.rows) return;
    const index = y * this.columns + x;
    if (c.continuation && x > 0) this.reset(index - 1, style);
    if (c.width === 2 && !c.continuation && x + 1 < this.columns) this.reset(index + 1, style);
    this.reset(index, style);
  }
  set(x: number, y: number, g: string, style: Partial<Style> = {}, semantic?: string, language?: string): void {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows || /[\x00-\x1f\x7f-\x9f]/u.test(g) || g.length > 1 && graphemes(g).length !== 1) return;
    const w = width(g); if (w < 1 || w > 2 || x + w > this.columns) return;
    this.erase(x, y, style); if (w === 2) this.erase(x + 1, y, style);
    const cell = this.cells[y * this.columns + x]; cell.g = g; cell.width = w as 1 | 2; cell.semantic = semantic; cell.language = language;
    if (w === 2) { const next = this.cells[y * this.columns + x + 1]; next.g = ''; next.width = 2; next.continuation = true; next.semantic = semantic; next.language = language; }
  }
  text(x: number, y: number, text: string, style: Partial<Style> = {}, maxWidth = this.columns - x, semantic?: string, language?: string): number {
    let dx = 0;
    for (const g of graphemes(text)) { const w = width(g); if (dx + w > maxWidth) break; this.set(x + dx, y, g, style, semantic, language); dx += w; }
    return dx;
  }
  fill(rect: Rect, g = ' ', style: Partial<Style> = {}): void {
    for (let y = Math.max(0, rect.y); y < Math.min(this.rows, rect.y + rect.h); y++)
      for (let x = Math.max(0, rect.x); x < Math.min(this.columns, rect.x + rect.w); x++) this.set(x, y, g, style);
  }
  box(rect: Rect, title = '', fg = color.faint, semantic?: string, language?: string): void {
    const { x, y, w, h } = rect; if (w < 2 || h < 2) return;
    this.line(x + 1, y, x + w - 2, y, '─', { fg }); this.line(x + 1, y + h - 1, x + w - 2, y + h - 1, '─', { fg });
    this.line(x, y + 1, x, y + h - 2, '│', { fg }); this.line(x + w - 1, y + 1, x + w - 1, y + h - 2, '│', { fg });
    for (const [dx, dy, g] of [[0, 0, '┌'], [w - 1, 0, '┐'], [0, h - 1, '└'], [w - 1, h - 1, '┘']] as const) this.set(x + dx, y + dy, g, { fg });
    if (title) this.text(x + 2, y, ` ${title} `, { fg: color.dim }, w - 4, semantic, language);
    if (semantic) this.regions.set(semantic, rect);
  }
  line(x0: number, y0: number, x1: number, y1: number, glyph = '·', style: Partial<Style> = {}): void {
    const dx = x1 - x0, dy = y1 - y0, n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    // Sampling is bounded even when a mathematical line lies far beyond the viewport.
    if (n > 10000) return;
    for (let i = 0; i <= n; i++) this.set(Math.round(x0 + dx * i / n), Math.round(y0 + dy * i / n), glyph, style);
  }
  clone(): Canvas {
    const canvas = new Canvas(this.columns, this.rows);
    for (let i = 0; i < this.cells.length; i++) canvas.cells[i] = { ...this.cells[i] };
    for (const [id, rect] of this.regions) canvas.regions.set(id, { ...rect });
    return canvas;
  }
  plain(): string { return Array.from({ length: this.rows }, (_, y) => this.cells.slice(y * this.columns, (y + 1) * this.columns).filter(c => !c.continuation).map(c => c.g).join('')).join('\n'); }
  hash(): string { return createHash('sha256').update(JSON.stringify(this.cells)).digest('hex'); }
  validate(): string[] {
    const errors: string[] = [];
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.columns; x++) {
      const c = this.get(x, y)!;
      if (c.continuation && (x === 0 || this.get(x - 1, y)?.width !== 2 || this.get(x - 1, y)?.continuation)) errors.push(`E_ORPHAN:${x},${y}`);
      if (!c.continuation && c.width === 2 && (x + 1 === this.columns || !this.get(x + 1, y)?.continuation)) errors.push(`E_WIDE:${x},${y}`);
    }
    return errors;
  }
}
export function wrap(text: string, columns: number): string[] {
  const lines: string[] = []; let line = '', used = 0;
  for (const g of graphemes(text)) {
    if (g === '\n') { lines.push(line); line = ''; used = 0; continue; }
    const w = width(g); if (used + w > columns && line) { lines.push(line); line = ''; used = 0; }
    line += g; used += w;
  }
  lines.push(line); return lines;
}
