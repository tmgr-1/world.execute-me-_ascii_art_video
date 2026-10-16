import { clamp, hash, mix } from './math.js';
import type { World } from './world.js';

export interface Point { x: number; y: number }
export const tangentAt = (x: number, x0: number): number => Math.sin(x0) + Math.cos(x0) * (x - x0);
export function unrollCircle(radius: number, theta: number): { center: Point; length: number; marker: Point } {
  return { center: { x: radius * theta, y: radius }, length: radius * theta,
    marker: { x: radius * theta - radius * Math.sin(theta), y: radius - radius * Math.cos(theta) } };
}
export function points(seed: number, count = 20): { x: number; y: number; z: number }[] {
  return Array.from({ length: count }, (_, i) => ({ x: hash(seed, 'point', i, 'x') * 2 - 1, y: hash(seed, 'point', i, 'y') * 2 - 1, z: hash(seed, 'point', i, 'z') * 2 - 1 }));
}
export function currentSample(x: number, mode: string): number {
  const sine = Math.sin(x * 2);
  if (mode === 'SINE') return sine;
  if (mode === 'LIMITED') return clamp(sine * 8, -1, 1);
  if (mode === 'RECTIFIED_PULSE') return sine > -.3 ? .85 : 0;
  return .85;
}
export function era(year: number): string { return year >= 1 ? `AD ${Math.round(year)}` : `BC ${1 - Math.round(year)}`; }
export function activity(world: World, channel: 'rx' | 'tx', atMs: number): number {
  let value = 0;
  const sample = (eventAt: number, frequency?: number): void => {
    const elapsed = atMs - eventAt;
    if (elapsed < 0 || elapsed > 900) return;
    const signal = Math.exp(-elapsed / (frequency === undefined ? 240 : 350)) * Math.sin(frequency === undefined ? elapsed / 24 : elapsed / 1000 * Math.PI * 2 * frequency);
    if (Math.abs(signal) > Math.abs(value)) value = signal;
  };
  if (channel === 'rx') for (const request of world.state.sent) sample(request.atMs);
  else for (const output of world.state.outputs) sample(output.queuedAtMs, output.frequency);
  return value;
}
export function shape(kind: string, t: number): Point {
  const a = t * Math.PI * 2;
  if (kind === 'EGGPLANT') { const r = .62 + .22 * Math.sin(a); return { x: Math.cos(a) * r * .6 + Math.sin(a) * .2, y: Math.sin(a) * .9 }; }
  if (kind === 'TOMATO') return { x: Math.cos(a) * (.85 + .025 * Math.cos(a * 7)), y: Math.sin(a) * .72 };
  // A continuous outline with two distinct ears, cheeks and a curled tail.
  const outline = [[-.7,.75],[-.85,.1],[-.75,-.3],[-.7,-.95],[-.25,-.5],[.25,-.5],[.7,-.95],[.78,-.2],[.7,.65],[.95,.7],[1.15,.3],[1.12,.02],[.98,.02],[.96,.35],[.75,.7],[.2,.9],[-.5,.9],[-.7,.75]];
  const p = clamp(t) * (outline.length - 1), index = Math.min(outline.length - 2, Math.floor(p)), f = p - index;
  return { x: mix(outline[index][0], outline[index+1][0], f), y: mix(outline[index][1], outline[index+1][1], f) };
}
