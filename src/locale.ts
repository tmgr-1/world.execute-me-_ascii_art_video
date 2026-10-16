import cn from '../films/world-execute/locales/cn.json' with { type: 'json' };
import en from '../films/world-execute/locales/en.json' with { type: 'json' };
import type { Language } from './types.js';
export const locales: Record<Language, Record<string, string>> = { cn, en };
export function tr(lang: Language, key: string, args: Record<string, unknown> = {}): string {
  const template = locales[lang][key];
  if (template === undefined) throw new Error(`E_LOCALE_MISSING:${lang}:${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(args[name] ?? `{${name}}`));
}
export const countLocales: Record<string, Record<string, string>> = {
  de: { memory: 'Speicher', wait: 'Warten', task: 'Aufgabe', log: 'Protokoll', input: 'Eingabe', stack: 'Aufrufstapel', output: 'Ausgabe', state: 'Zustand' },
  es: { memory: 'Memoria', wait: 'Esperando', task: 'Tarea', log: 'Registro', input: 'Entrada', stack: 'Pila', output: 'Salida', state: 'Estado' },
  fr: { memory: 'Mémoire', wait: 'En attente', task: 'Tâche', log: 'Journal', input: 'Entrée', stack: 'Pile', output: 'Sortie', state: 'État' },
  ko: { memory: '메모리', wait: '대기', task: '작업', log: '로그', input: '입력', stack: '호출 스택', output: '출력', state: '상태' },
  sv: { memory: 'Minne', wait: 'Väntar', task: 'Uppgift', log: 'Logg', input: 'Inmatning', stack: 'Anropsstack', output: 'Utmatning', state: 'Tillstånd' },
  zh: { memory: '内存', wait: '等待', task: '任务', log: '日志', input: '输入', stack: '调用栈', output: '输出', state: '状态' },
};
