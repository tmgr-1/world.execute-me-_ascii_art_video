import { performance } from 'node:perf_hooks';
import { MediaClock } from './audio.js';

/** Use the media clock until EOF, then continue the silent visual tail. */
export class PlaybackClock {
  private tail?: MediaClock;
  private epoch = 0;
  constructor(private readonly media: MediaClock, private readonly now = (): number => performance.now()) {}
  get inTail(): boolean { return this.tail !== undefined; }
  read(): number { return (this.tail ?? this.media).read(this.now()); }
  startTail(positionMs: number, speed: number, paused: boolean): void {
    this.tail ??= new MediaClock();
    this.tail.update({ mediaTimeMs: positionMs, monotonicMs: this.now(), speed, paused, epoch: ++this.epoch });
  }
  pauseTail(paused: boolean, speed: number): void {
    if (!this.tail) throw new Error('E_NOT_IN_TAIL');
    this.startTail(this.read(), speed, paused);
  }
  useMedia(): void { this.tail = undefined; }
}
