import { tr } from '../../src/locale.js';
import type { Language } from '../../src/types.js';
import { countLanguages, countText } from './story.js';

interface Phrase { step: number; text: string }
const phrases: Record<string, Phrase> = {
  'count.wait': { step: 1, text: countText[0].translated },
  'sim.delete_system': { step: 1, text: 'Simuliertes System wird gelöscht.' },
  'ui.plan_pending': { step: 1, text: 'Warte auf Übermittlung.' },
  'input.closed': { step: 2, text: 'Sesión cerrada' },
  'ui.no_receiver': { step: 2, text: 'receptor desconectado' },
  'input.sent': { step: 2, text: 'Enviado' },
  'request.hello': { step: 2, text: 'Hola.' },
  'request.points': { step: 2, text: 'Muestra la dimensión del conjunto de puntos.' },
  'request.circle': { step: 2, text: 'Desenrolla la circunferencia.' },
  'request.tangent': { step: 2, text: 'Dibuja la tangente de la onda sinusoidal.' },
  'request.infinity': { step: 2, text: 'Intenta aproximarte al infinito.' },
  'request.current': { step: 2, text: 'Cambia el modo de corriente.' },
  'request.vision': { step: 2, text: 'Difumina tu visión.' },
  'request.time': { step: 2, text: 'Retrocede el tiempo.' },
  'request.align': { step: 2, text: 'Haz coincidir las dos trayectorias.' },
  'memory.SELECT': { step: 3, text: 'SÉLECTION' },
  'memory.ERASE': { step: 3, text: 'EFFACEMENT' },
  'memory.ERASED': { step: 3, text: 'EFFACÉ' },
  'memory.range': { step: 3, text: 'vue' },
  'memory.objects': { step: 3, text: 'objets' },
  'watch.me': { step: 3, text: 'objet={address}' },
  'watch.revision': { step: 3, text: 'révision={revision}' },
  'watch.verified': { step: 3, text: 'révision validée={revision}' },
  'watch.task': { step: 4, text: '태스크 #{id} [{status}]' },
  'watch.request': { step: 4, text: '요청 ID={id}' },
  'watch.frame': { step: 4, text: '{program} PC={pc} 깊이={depth}' },
  'sim.delete_target': { step: 5, text: 'Mål: hela det simulerade systemet, inklusive mig själv.' },
  'plan.draft': { step: 5, text: 'mål=simulated_system  plan=UTKAST  commit=0' },
  'status.session': { step: 5, text: 'session={open} (stängd)  rx={rx}  ack_seq={ack}  request_id={request}' },
  'tree.system': { step: 6, text: '整个模拟系统 / [受保护]' },
  'tree.runtime': { step: 6, text: '├─ 运行框架 [{status}]' },
  'tree.data': { step: 6, text: '│  └─ 自身数据 [{state}]' },
  'tree.session': { step: 6, text: '├─ 会话 [{state}]' },
  'tree.memory': { step: 6, text: '├─ 内存 / 注册表 [受保护]' },
  'tree.root': { step: 6, text: '└─ system_root [受保护]' },
};

/** Translate real display fields independently of the transient noise budget. */
export function countPhrase(count: number, key: string, args: Record<string, unknown> = {}): { text: string; language: string } | undefined {
  const phrase = phrases[key];
  if (!phrase || count < phrase.step) return undefined;
  return { text: phrase.text.replace(/\{(\w+)\}/g, (_, name: string) => String(args[name] ?? `{${name}}`)), language: countLanguages[phrase.step - 1] };
}

export function countTr(count: number, lang: Language, key: string, args: Record<string, unknown> = {}): { text: string; language: string } {
  return countPhrase(count, key, args) ?? { text: tr(lang, key, args), language: lang };
}
