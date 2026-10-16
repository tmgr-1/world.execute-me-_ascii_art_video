import { color, width, type Canvas, type Style } from './canvas.js';
import type { Rect } from './types.js';
const styles = new Map<number, Partial<Style>>();
export const style = (fg: number, bold = false): Partial<Style> => { const key = fg * 2 + Number(bold); let value = styles.get(key); if (!value) { value = { fg, bold }; styles.set(key, value); } return value; };
export const inner = (r: Rect, margin = 2): Rect => ({ x: r.x + margin, y: r.y + margin, w: r.w - margin * 2, h: r.h - margin * 2 });
export const centerText = (c: Canvas, y: number, text: string, fg = color.text, r: Rect = { x: 0, y: 0, w: c.columns, h: c.rows }): void => { c.text(Math.max(r.x, r.x + Math.floor((r.w - width(text)) / 2)), y, text, style(fg), r.w); };
