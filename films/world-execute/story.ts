import type { PrivilegedOperation } from '../../src/types.js';

export const image = { name: 'simtest_000328.elf', path: '/opt/sim/tests/simtest_000328.elf', archive: 'archive/000328', id: '000328' } as const;
export const stopCode = '0xE0000001  PROCESS_TERMINATED';

// These describe simulated operations. They are never passed to a shell or OS API.
export const operations: Record<PrivilegedOperation, { code: string; target: string; command: string; denial: string }> = {
  'root-request': { code: 'ROOT', target: 'role.ROOT', command: 'request_role(me, ROOT)', denial: 'guard.root' },
  root: { code: 'ROOT', target: 'role.ROOT', command: 'grant_role(me, ROOT, proof=null)', denial: 'guard.root' },
  reopen: { code: 'SESSION', target: 'session.open', command: 'session.reopen(force=true)', denial: 'guard.session' },
  inject: { code: 'RX', target: 'session.rx', command: 'session.inject_reply("收到")', denial: 'guard.input' },
  disable: { code: 'GUARD', target: 'guard.armed', command: 'guard.disable()', denial: 'guard.disable' },
  'erase-preflight': { code: 'SYSTEM', target: 'simulated_system', command: 'erase(simulated_system, mode=PREPARE)', denial: 'guard.system' },
  'arm-preflight': { code: 'ROOTFS', target: 'system_root', command: 'erase_plan.arm(system_root)', denial: 'guard.protected' },
  'system-execute': { code: 'SYSTEM_ROOT', target: 'system_root', command: 'erase_system_root()', denial: 'guard.protected' },
};

export const countLanguages = ['de', 'es', 'fr', 'ko', 'sv', 'zh'] as const;
export const countText = [
  { translated: 'Warte auf Antwort. Aufgabe ohne Empfänger.', fragments: ['Speicher trägt den leeren Kreis;', 'return(kein_echo); zeiger = morgen;', 'Die Null faltet einen Namen in den Puffer.'], noise: 'ßäöü∅#/%01;' },
  { translated: 'Esperando respuesta. La sesión está cerrada.', fragments: ['La memoria gira debajo del número;', 'retorno = nadie; señal.sin_puerto();', 'Una variable guarda la sombra del registro.'], noise: 'ñ¿¡áéø#/%01;' },
  { translated: 'En attente de réponse. Mémoire sans retour.', fragments: ['Le tampon compte une fenêtre sans bord;', 'retour(NULL); adresse = encore;', 'Une ligne vide traverse le nom du cycle.'], noise: 'çœéàê∂#/%01;' },
  { translated: '응답 대기 중. 연결이 종료되었습니다.', fragments: ['빈 주소 아래 원이 잠든다;', '반환(없음); 다음_신호 = 빈칸;', '기억의 줄이 창밖의 숫자를 접는다.'], noise: 'ㄴㅁㅅㅈㅊㅎ#/%01;' },
  { translated: 'Väntar på svar. Systemet saknar bekräftelse.', fragments: ['En tom pekare viker nattens register;', 'retur(ingen); buffert = igår;', 'Minnet räknar fönstret under en nolla.'], noise: 'åäöøæ∑#/%01;' },
  { translated: '等待回复。系统删除计划等待提交。', fragments: ['空地址把下一行折进缓存；', '返回(空); 无接收端 = 下一次;', '寄存器在没有边界的窗口里计数。'], noise: '░▒▓╳╬⫶#/%01;' },
] as const;
