import { color, type Canvas } from '../../src/canvas.js';
import { style } from '../../src/drawing.js';
import type { ErasureWrite } from '../../src/store.js';
import type { Language, Rect } from '../../src/types.js';
import type { World } from '../../src/world.js';

export interface ErasureMemory {
  objectId: string; label: string; address: number; size: number; phase: 'SELECT' | 'ERASE' | 'ERASED';
  before: number[]; now: number[]; writes: ErasureWrite[]; completed?: number; total?: number;
}
const hex = (n: number, digits = 8): string => n.toString(16).toUpperCase().padStart(digits, '0');

/** PRE is host audit evidence; NOW always comes from the current store. */
export function erasureMemory(world: World, t: number): ErasureMemory | undefined {
  const read = (address: number, size: number): number[] => [...world.store.bytes.subarray(address - world.store.base, address - world.store.base + size)];
  if (t >= world.film.times.selfErase - 150) {
    const owned = [...world.store.allocations.values()].filter(a => a.type === 'FormSnapshot' && a.owner === 'me');
    const a = owned.at(-1); if (!a) return undefined;
    const write = world.store.erasures.findLast(w => w.objectId === a.id && w.scope === 'object' && w.atMs <= t);
    const now = read(a.address, a.size);
    return { objectId: a.id, label: a.id, address: a.address, size: a.size, phase: write ? 'ERASED' : 'SELECT',
      before: write?.beforeBytes ?? now, now, writes: write ? [write] : [],
      completed: owned.filter(a => a.missing.some(range => range.offset === 0 && range.length === a.size)).length, total: owned.length };
  }
  const starts = world.film.cues.filter(c => c.command.kind === 'ERASE_COPY' && c.command.clearedBytes === 2);
  const selected = starts.findLast(c => c.atMs - 150 <= t);
  if (!selected || selected.command.kind !== 'ERASE_COPY') return undefined;
  const fragment = selected.command.fragment, copy = world.state.memoryCopies.find(copy => copy.fragment === fragment)!;
  const a = world.store.allocation('me'), address = a.address + world.store.field('me', 'fragments').offset + copy.fragment * 8;
  const now = read(address, 8);
  return { objectId: a.id, label: `fragments[${copy.fragment}]`, address, size: 8,
    phase: t < selected.atMs ? 'SELECT' : copy.clearedBytes === 8 ? 'ERASED' : 'ERASE', before: copy.beforeErase ?? now, now,
    writes: world.store.erasures.filter(w => w.scope === 'fragments' && w.address >= address && w.address < address + 8 && w.atMs <= t) };
}

export function drawErasureMemory(c: Canvas, world: World, _lang: Language, r: Rect, t: number): boolean {
  const view = erasureMemory(world, t); if (!view) return false;
  c.text(r.x + 2, r.y + 1, `${view.phase} ${view.label} / ${view.size} B`, style(view.phase === 'SELECT' ? color.cyan : color.dim), r.w - 4, 'memory.erase.label');
  const groups = Math.min(Math.floor((r.h - 3) / 2), Math.ceil(view.size / 4));
  for (let group = 0; group < groups; group++) for (const [source, values, dy] of [['PRE', view.before, 0], ['NOW', view.now, 1]] as const) {
    const y = r.y + 2 + group * 2 + dy, offset = group * 4, semantic = source === 'PRE' ? 'before' : 'now';
    c.text(r.x + 2, y, `${source} ${hex(view.address + offset)} `, style(source === 'PRE' ? color.cyan : color.dim), 13, `memory.erase.address.${semantic}`);
    for (let b = 0; b < 4 && offset + b < values.length; b++) {
      const address = view.address + offset + b;
      const changed = source === 'NOW' && view.writes.some(w => address >= w.address && address < w.address + w.size && t - w.atMs < 350
        && w.beforeBytes[address - w.address] !== w.afterBytes[address - w.address]);
      const fg = changed ? color.gold : values[offset + b] ? source === 'PRE' ? color.cyan : color.dim : color.faint;
      c.text(r.x + 15 + b * 3, y, hex(values[offset + b], 2), style(fg), 2, `memory.erase.${semantic}.${hex(address)}`);
    }
    const ascii = values.slice(offset, offset + 4).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    c.text(r.x + 27, y, `|${ascii}|`, style(color.faint), r.w - 29, `memory.erase.ascii.${semantic}`);
  }
  const objects = view.total === undefined ? '' : ` objects=${view.completed}/${view.total}`;
  c.text(r.x + 2, r.y + r.h - 1, ` view ${Math.min(view.size, groups * 4)}/${view.size} B${objects} `, style(color.dim), r.w - 4, 'memory.erase.range');
  return true;
}
