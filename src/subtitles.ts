import type { Film, Language, Lyric } from './types.js';

// Viewer captions use the music clock, never the simulated process or its UI.
export function currentLyric(film: Film, timeMs: number): Lyric | undefined {
  const index = film.lyrics.findLastIndex(lyric => lyric.startMs <= timeMs);
  if (index < 0) return undefined;
  const lyric = film.lyrics[index], next = film.lyrics[index + 1];
  const until = next && next.startMs - lyric.endMs <= 800 ? next.startMs : lyric.endMs + 300;
  return timeMs < until ? lyric : undefined;
}

export function subtitleLines(film: Film, timeMs: number, lang: Language): [string, string] {
  const lyric = currentLyric(film, timeMs);
  return lyric ? [lyric.text, lang === 'cn' ? lyric.translation : lyric.englishMeaning ?? ''] : ['', ''];
}
