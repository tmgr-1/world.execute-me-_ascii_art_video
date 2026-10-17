import { color, wrap, type Style } from './canvas.js';
import { tr } from './locale.js';
import type { Language } from './types.js';
import type { Chat, World } from './world.js';
import { image } from '../films/world-execute/story.js';

export interface LogLine { item: Chat; logicalLine: number; text: string; style: Style }

export function messageStyle(item: Chat, world: World): Style {
  let fg: number = color.dim, bold = false;
  if (item.source === 'guard') { fg = color.red; bold = true; }
  else if (item.source === 'session') fg = item.key === 'session.closed' ? color.red : color.green;
  else if (item.source === 'sim') {
    fg = item.atMs >= world.film.lyrics[32].startMs ? color.cyan : color.dim;
    const level = Number(item.key.match(/^sim\.wait\.(\d)$/)?.[1] ?? 0);
    if (level) {
      fg = [color.cyan, 51, color.gold, color.gold, color.red, 196][level - 1];
      bold = level >= 4;
    }
  }
  return { fg, bg: color.bg, bold };
}

/** One chronological stream, wrapped before taking the viewport's tail. */
export function visibleLog(world: World, lang: Language, columns: number, rows: number): LogLine[] {
  return world.state.chat.flatMap(item => {
    const tag = item.source === 'session' && item.requestId !== null ? `user #${String(item.requestId).padStart(2, '0')}>` : `[${item.source}]`;
    return wrap(`${tag} ${tr(lang, item.key, { image: image.name })}`, columns)
      .map((text, logicalLine) => ({ item, logicalLine, text, style: messageStyle(item, world) }));
  }).slice(-rows);
}
