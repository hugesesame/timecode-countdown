import { realFps, type FrameRate } from './timecode';

/**
 * 外部タイムコード（MTC / LTC）に追従する時計。
 * 受信の合間は内部時計で進め、信号が切れたら freewheelMs だけ自走して止まる。
 */
export class ExternalClock {
  private anchor: { frames: number; at: number } | null = null;
  private held = 0;
  private last = 0;

  constructor(
    readonly rate: FrameRate,
    private readonly freewheelMs = 250,
    /** 受信の揺れと見なして、戻りを無視するフレーム数 */
    private readonly slackFrames = 2,
  ) {}

  /** 走っている最中の位置を受信した */
  update(frames: number, nowMs: number): void {
    this.anchor = { frames, at: nowMs };
  }

  /** 頭出しされた。その位置で止まる。 */
  locate(frames: number): void {
    this.anchor = null;
    this.held = frames;
    this.last = frames;
  }

  isRunning(nowMs: number): boolean {
    return this.anchor !== null && nowMs - this.anchor.at <= this.freewheelMs;
  }

  /** 小数を含むフレーム位置 */
  position(nowMs: number): number {
    if (!this.anchor) return this.held;
    const elapsed = Math.min(Math.max(0, nowMs - this.anchor.at), this.freewheelMs);
    let pos = this.anchor.frames + (elapsed / 1000) * realFps(this.rate);
    // 少しだけ手前の位置が来た時に戻ると、同じ Cue を二度実行してしまう
    if (pos < this.last && this.last - pos <= this.slackFrames) pos = this.last;
    this.last = pos;
    return pos;
  }
}

/**
 * メッセージに付いてきた時刻を、時計の基準として使える時刻に直す。
 * 送り元によっては、今の時刻と大きくずれた時刻が付いてくる。その時は、届いた時刻を使う。
 */
export function arrivalTime(stampMs: number, nowMs: number, maxLagMs = 100): number {
  const lag = nowMs - stampMs;
  return lag >= 0 && lag <= maxLagMs ? stampMs : nowMs;
}
