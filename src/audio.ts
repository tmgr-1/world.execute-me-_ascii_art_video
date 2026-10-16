import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { performance } from 'node:perf_hooks';

export interface ClockSample { mediaTimeMs: number; monotonicMs: number; speed: number; paused: boolean; epoch: number }
export class MediaClock {
  private sample: ClockSample = { mediaTimeMs: 0, monotonicMs: 0, speed: 1, paused: true, epoch: 0 };
  update(sample: ClockSample): boolean {
    if (sample.epoch < this.sample.epoch) return false;
    if (sample.epoch === this.sample.epoch && !sample.paused && !this.sample.paused && sample.speed === this.sample.speed) {
      const estimate = this.read(sample.monotonicMs), error = sample.mediaTimeMs - estimate;
      if (Math.abs(error) < 80) sample = { ...sample, mediaTimeMs: estimate + error * .35 };
    }
    this.sample = { ...sample }; return true;
  }
  read(now = performance.now()): number { return Math.max(0, this.sample.mediaTimeMs + (this.sample.paused ? 0 : Math.max(0, now - this.sample.monotonicMs) * this.sample.speed)); }
  get ageMs(): number { return Math.max(0, performance.now() - this.sample.monotonicMs); }
  get epoch(): number { return this.sample.epoch; }
}
interface Reply { request_id?: number; error?: string; data?: unknown; event?: string; name?: string; reason?: string; file_error?: string }
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class MpvTransport extends EventEmitter {
  readonly clock = new MediaClock();
  private child?: ChildProcess;
  private socket?: net.Socket;
  private endpoint = '';
  private sequence = 0;
  private epoch = 0;
  private paused = true;
  private speed = 1;
  private position = 0;
  private seeking = false;
  private closed = false;
  private ended = false;
  private timer?: NodeJS.Timeout;
  private diagnostics = '';
  private requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; epoch: number }>();
  private fault?: Error;
  durationMs = 0;
  constructor(readonly executable = 'mpv', readonly nullAudio = false, readonly timeoutMs = 8000) { super(); }
  private fail(error: Error): void {
    if (this.closed || this.fault) return; this.fault = error;
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); } this.requests.clear();
    this.emit('failure', error);
  }
  private publish(): void { this.clock.update({ mediaTimeMs: this.position, monotonicMs: performance.now(), paused: this.paused, speed: this.speed, epoch: this.epoch }); }
  private handle(reply: Reply): void {
    if (reply.request_id !== undefined) {
      const request = this.requests.get(reply.request_id); if (!request) return;
      this.requests.delete(reply.request_id); clearTimeout(request.timer);
      if (reply.error && reply.error !== 'success') request.reject(new Error(`E_IPC_COMMAND:${reply.error}`));
      else request.resolve(reply.data);
    }
    if (reply.event === 'property-change' && !this.seeking) {
      if (reply.name === 'time-pos' && typeof reply.data === 'number') { this.position = reply.data * 1000; this.publish(); }
      // Pause/speed transitions are published only together with a confirmed position.
    }
    if (reply.event === 'end-file') {
      if (reply.reason === 'eof') { this.ended = true; if (this.timer) clearInterval(this.timer); this.position = this.durationMs; this.paused = true; this.publish(); this.emit('ended'); }
      else if (reply.reason === 'error') this.fail(new Error(`E_AUDIO_FAILED:${reply.file_error ?? 'decode'}`));
    }
    if (reply.event) this.emit(`mpv:${reply.event}`, reply);
  }
  command(command: unknown[]): Promise<unknown> {
    if (this.closed || this.fault) return Promise.reject(this.fault ?? new Error('E_IPC_CLOSED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`E_IPC_TIMEOUT:${String(command[0])}`)); }, this.timeoutMs);
      this.requests.set(id, { resolve, reject, timer, epoch: this.epoch });
      this.socket!.write(JSON.stringify({ command, request_id: id }) + '\n', error => { if (error) this.fail(error); });
    });
  }
  private waitEvent(name: string): { promise: Promise<void>; cancel: () => void } {
    let stop = (): void => {};
    const promise = new Promise<void>((resolve, reject) => {
      const done = (): void => { stop(); resolve(); };
      const failure = (error: Error): void => { stop(); reject(error); };
      const timer = setTimeout(() => { stop(); reject(new Error(`E_IPC_TIMEOUT:${name}`)); }, this.timeoutMs);
      stop = () => { clearTimeout(timer); this.off(`mpv:${name}`, done); this.off('failure', failure); };
      this.once(`mpv:${name}`, done); this.once('failure', failure);
    });
    // A load command can fail before the file-loaded event. Avoid an unhandled rejection.
    promise.catch(() => {});
    return { promise, cancel: stop };
  }
  async load(path: string): Promise<void> {
    // mpv officially accepts an inherited duplex pipe as a JSON IPC client.
    // It is private to the child and works without listening on a filesystem socket.
    const inheritedPipe = process.platform !== 'win32';
    if (!inheritedPipe) this.endpoint = `\\\\.\\pipe\\ascii-film-${process.pid}-${randomUUID()}`;
    this.child = spawn(this.executable, ['--no-config', '--idle=yes', '--pause=yes', '--no-video', '--audio-display=no', '--no-terminal', '--input-terminal=no', '--input-default-bindings=no', '--osc=no', '--force-window=no', inheritedPipe ? '--input-ipc-client=fd://3' : `--input-ipc-server=${this.endpoint}`, ...(this.nullAudio ? ['--ao=null'] : [])], { stdio: inheritedPipe ? ['ignore', 'ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.child.on('error', error => this.fail(new Error(`E_PLAYER_MISSING:${error.message}`)));
    this.child.stderr?.on('data', chunk => { this.diagnostics = (this.diagnostics + String(chunk)).slice(-16384); });
    this.child.on('exit', code => { if (!this.closed) this.fail(new Error(`E_PLAYER_FAILED:${code}`)); });
    if (inheritedPipe) this.socket = this.child.stdio[3] as net.Socket;
    const deadline = performance.now() + this.timeoutMs;
    while (!this.socket) {
      if (this.fault) throw this.fault;
      if (performance.now() > deadline) throw new Error('E_IPC_TIMEOUT:CONNECT');
      const socket = await new Promise<net.Socket | null>(resolve => {
        const candidate = net.createConnection(this.endpoint);
        candidate.once('connect', () => { candidate.removeAllListeners('error'); resolve(candidate); });
        candidate.once('error', () => { candidate.destroy(); resolve(null); });
      });
      if (socket) this.socket = socket; else await delay(25);
    }
    this.socket.setEncoding('utf8');
    let buffered = '';
    this.socket.on('data', chunk => {
      buffered += chunk.toString('utf8'); if (buffered.length > 1048576) { this.fail(new Error('E_IPC_OVERSIZE')); return; }
      let index: number;
      while ((index = buffered.indexOf('\n')) >= 0) { const line = buffered.slice(0, index); buffered = buffered.slice(index + 1); if (!line) continue; try { this.handle(JSON.parse(line) as Reply); } catch { this.fail(new Error('E_IPC_INVALID_JSON')); } }
    });
    this.socket.on('error', error => this.fail(error)); this.socket.on('close', () => { if (!this.closed) this.fail(new Error('E_IPC_DISCONNECTED')); });
    await this.command(['observe_property', 1, 'time-pos']);
    const loaded = this.waitEvent('file-loaded');
    try { await this.command(['loadfile', path, 'replace']); await loaded.promise; } finally { loaded.cancel(); }
    this.durationMs = Number(await this.command(['get_property', 'duration'])) * 1000;
    if (!Number.isFinite(this.durationMs) || this.durationMs <= 0) throw new Error('E_AUDIO_FAILED:DURATION');
    const positionDeadline = performance.now() + this.timeoutMs;
    do {
      try { const position = await this.command(['get_property', 'time-pos']); this.position = typeof position === 'number' ? position * 1000 : NaN; }
      catch { this.position = NaN; }
      if (Number.isFinite(this.position)) break;
      if (performance.now() > positionDeadline || this.fault) throw this.fault ?? new Error('E_IPC_TIMEOUT:INITIAL_POSITION');
      await delay(25);
    } while (true);
    this.publish();
    let querying = false;
    this.timer = setInterval(() => {
      if (querying || this.seeking || this.closed || this.ended) return;
      querying = true; const epoch = this.epoch;
      this.command(['get_property', 'time-pos']).then(value => {
        if (epoch === this.epoch && !this.seeking && typeof value === 'number') { this.position = value * 1000; this.publish(); }
      }).catch(error => { if (!this.ended) this.fail(error as Error); }).finally(() => { querying = false; });
    }, 75);
  }
  async setPaused(paused: boolean): Promise<void> {
    await this.command(['set_property', 'pause', paused]);
    this.paused = Boolean(await this.command(['get_property', 'pause']));
    this.position = Number(await this.command(['get_property', 'time-pos'])) * 1000; this.publish();
  }
  async setSpeed(speed: number): Promise<void> {
    if (!Number.isFinite(speed) || speed < .25 || speed > 2) throw new Error('E_SPEED');
    await this.command(['set_property', 'speed', speed]);
    this.speed = Number(await this.command(['get_property', 'speed']));
    this.position = Number(await this.command(['get_property', 'time-pos'])) * 1000; this.publish();
  }
  async seek(mediaMs: number): Promise<number> {
    await this.setPaused(true); this.seeking = true; this.epoch++;
    const target = Math.max(0, Math.min(this.durationMs - 1, mediaMs));
    try {
      await this.command(['seek', target / 1000, 'absolute+exact']);
      const deadline = performance.now() + this.timeoutMs;
      do {
        this.position = Number(await this.command(['get_property', 'time-pos'])) * 1000;
        if (Math.abs(this.position - target) < 40) break;
        if (performance.now() > deadline) throw new Error('E_IPC_TIMEOUT:SEEK');
        await delay(20);
      } while (true);
    } finally { this.seeking = false; this.publish(); }
    return this.position;
  }
  get stderrTail(): string { return this.diagnostics; }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; if (this.timer) clearInterval(this.timer);
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(new Error('E_IPC_CLOSED')); } this.requests.clear();
    if (this.socket && !this.socket.destroyed) this.socket.end(JSON.stringify({ command: ['quit'] }) + '\n');
    if (this.child?.pid && this.child.exitCode === null && this.child.signalCode === null) {
      const exited = new Promise<void>(resolve => this.child!.once('exit', () => resolve()));
      await Promise.race([exited, delay(600)]);
      if (this.child.exitCode === null && this.child.signalCode === null) { this.child.kill('SIGTERM'); await Promise.race([exited, delay(600)]); }
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    }
    this.socket?.destroy();
  }
}
