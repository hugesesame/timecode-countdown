import { realFps, type FrameRate } from './timecode';

/** 内蔵タイムコードジェネレーター。時刻は呼び出し側から ms で渡す。 */
export class Generator {
  private base = 0;
  private startedAt: number | null = null;

  constructor(readonly rate: FrameRate) {}

  get running(): boolean {
    return this.startedAt !== null;
  }

  /** 小数を含むフレーム位置 */
  position(nowMs: number): number {
    if (this.startedAt === null) return this.base;
    return this.base + ((nowMs - this.startedAt) / 1000) * realFps(this.rate);
  }

  play(nowMs: number): void {
    if (this.startedAt === null) this.startedAt = nowMs;
  }

  stop(nowMs: number): void {
    this.base = this.position(nowMs);
    this.startedAt = null;
  }

  locate(frames: number, nowMs: number): void {
    this.base = frames;
    if (this.startedAt !== null) this.startedAt = nowMs;
  }
}
