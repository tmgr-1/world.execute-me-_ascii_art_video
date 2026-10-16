export const clamp = (n: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, n));
export const mix = (a: number, b: number, p: number): number => a + (b - a) * p;
export const smooth = (p: number): number => { p = clamp(p); return p * p * (3 - 2 * p); };
export const progress = (t: number, start: number, end: number): number => clamp((t - start) / Math.max(1, end - start));
export function hash(seed: number, ...parts: (string | number)[]): number {
  let h = seed >>> 0;
  for (const part of parts) for (const c of String(part)) { h = Math.imul(h ^ c.charCodeAt(0), 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export function parseLoop(value: string): { startMs: number; endMs: number } {
  const parts = value.split('..'); if (parts.length !== 2) throw new Error('E_LOOP_RANGE');
  const startMs = parseTime(parts[0]), endMs = parseTime(parts[1]);
  if (endMs - startMs < 500) throw new Error('E_LOOP_RANGE');
  return { startMs, endMs };
}
export function parseTime(value: string): number {
  if (!/^(?:\d+:)?\d+(?:\.\d+)?$/.test(value)) throw new Error(`E_MEDIA_POSITION:${value}`);
  const parts = value.split(':').map(Number);
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return Math.round(seconds * 1000);
}
export const timeCode = (ms: number): string => `${Math.floor(Math.max(0, ms) / 60000).toString().padStart(2, '0')}:${(Math.max(0, ms) / 1000 % 60).toFixed(2).padStart(5, '0')}`;
export const hex = (n: number): string => `0x${n.toString(16).padStart(8, '0').toUpperCase()}`;
