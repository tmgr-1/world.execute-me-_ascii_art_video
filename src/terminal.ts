import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import type { Canvas } from './canvas.js';
import type { Size } from './types.js';

const require = createRequire(import.meta.url);
// Keep the third-party backend behind one boundary; its own type declarations
// describe the older major version and omit createTerminal's injected streams.
const kit = require('terminal-kit') as { createTerminal: (options: object) => unknown; ScreenBuffer: new (options: object) => { fill: (options?: object) => void; put: (options: object, text: string) => void; draw: (options: object) => void } };
class Capture extends Writable {
  isTTY = true; columns = 1; rows = 1; chunks: Buffer[] = [];
  resize(size: Size): void {
    this.columns = size.columns; this.rows = size.rows;
    // terminal-kit caches its destination bounds on the stream's resize event.
    // Changing columns/rows alone leaves ScreenBuffer.draw() clipping to old bounds.
    this.emit('resize');
  }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { this.chunks.push(Buffer.from(chunk)); callback(); }
  take(): Buffer { const value = Buffer.concat(this.chunks); this.chunks = []; return value; }
}
export interface Submission { storyMs: number; full: boolean; encodeMs: number; bytes: number; acceptedAt: number }
export class TerminalAdapter {
  private capture = new Capture({ highWaterMark: 1024 * 1024 });
  private terminal = kit.createTerminal({ stdout: this.capture, stderr: this.capture, stdin: process.stdin, generic: 'xterm-256color', isTTY: true });
  private screen?: InstanceType<typeof kit.ScreenBuffer>;
  private dimensions?: Size;
  private blocked = false;
  private pending?: { canvas: Canvas; full: boolean; storyMs: number };
  private begun = false;
  private stopped = false;
  dropped = 0;
  bytes = 0;
  onSubmission?: (submission: Submission) => void;
  onFailure?: (error: Error) => void;
  private readonly outputError = (error: Error): void => { if (!this.stopped) this.onFailure?.(error); };
  private readonly drain = (): void => {
    this.blocked = false;
    const pending = this.pending; this.pending = undefined;
    if (pending && !this.stopped) this.submit(pending.canvas, pending.full, pending.storyMs);
  };
  constructor(private readonly output: NodeJS.WriteStream = process.stdout, readonly noColor = false) {}
  begin(): void {
    if (this.begun) return; this.begun = true;
    this.output.on('drain', this.drain);
    this.output.on('error', this.outputError);
    this.output.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[0m');
  }
  submit(canvas: Canvas, full = false, storyMs = 0): boolean {
    if (this.stopped) return false;
    if (this.blocked) { if (this.pending) this.dropped++; this.pending = { canvas, full: full || this.pending?.full || false, storyMs }; return false; }
    const started = performance.now();
    if (!this.dimensions || canvas.columns !== this.dimensions.columns || canvas.rows !== this.dimensions.rows) {
      this.capture.resize(canvas.size);
      this.screen = new kit.ScreenBuffer({ dst: this.terminal, width: canvas.columns, height: canvas.rows, x: 1, y: 1 });
      this.dimensions = canvas.size; full = true;
    }
    this.screen!.fill({ attr: { color: 7, bgColor: 0 }, char: ' ' });
    for (let y = 0; y < canvas.rows; y++) {
      let x = 0;
      while (x < canvas.columns) {
        const cell = canvas.get(x, y)!;
        if (cell.continuation) { x++; continue; }
        const start = x; let text = '';
        while (x < canvas.columns) {
          const next = canvas.get(x, y)!;
          if (next.continuation) { x++; continue; }
          if (next.fg !== cell.fg || next.bg !== cell.bg || next.bold !== cell.bold) break;
          text += next.g.normalize('NFC'); x += next.width;
        }
        this.screen!.put({ x: start, y, wrap: false, markup: false, attr: { color: this.noColor ? cell.bg === 255 ? 0 : 7 : cell.fg, bgColor: this.noColor ? cell.bg === 255 ? 7 : 0 : cell.bg, bold: cell.bold || this.noColor && [81, 222].includes(cell.fg) } }, text);
      }
    }
    this.screen!.draw({ delta: !full });
    const data = this.capture.take(); this.bytes += data.length;
    if (data.length) this.blocked = !this.output.write(data);
    this.onSubmission?.({ storyMs, full, encodeMs: performance.now() - started, bytes: data.length, acceptedAt: performance.now() });
    return true;
  }
  async close(): Promise<void> {
    if (this.stopped) return; this.stopped = true; this.pending = undefined;
    this.output.off('drain', this.drain);
    if (this.begun) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 800); this.output.write('\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l', () => { clearTimeout(timer); resolve(); }); });
    this.output.off('error', this.outputError);
    this.capture.destroy();
  }
}
