/** 遅れがこれより大きい状態が続いたら、音声が止まっていたとみなして合わせ直す */
const STALL_MS = 50;
const STALL_MARKS = 100;
/** 音声と時計の進み方の差に追従するため、1 秒あたりこれだけ遅い方へ寄せる */
const DRIFT_MS_PER_SEC = 0.5;

/**
 * 音声のサンプル位置を performance.now() の時刻に換算する。
 * 音声のかたまりは処理の都合で遅れて届くことがあるので、
 * いちばん遅れずに届いたものを基準にする。
 */
export class SampleClock {
  private offset: number | null = null;
  private lastSample = 0;
  private late = 0;

  constructor(private readonly sampleRate: number) {}

  private ms(sample: number): number {
    return (sample * 1000) / this.sampleRate;
  }

  /** sample 番目までのサンプルが nowMs に届いた */
  mark(sample: number, nowMs: number): void {
    const offset = nowMs - this.ms(sample);
    if (this.offset === null) {
      this.offset = offset;
    } else {
      const drift = (Math.max(0, sample - this.lastSample) / this.sampleRate) * DRIFT_MS_PER_SEC;
      this.late = offset > this.offset + STALL_MS ? this.late + 1 : 0;
      this.offset = this.late > STALL_MARKS ? offset : Math.min(this.offset + drift, offset);
      if (this.late > STALL_MARKS) this.late = 0;
    }
    this.lastSample = sample;
  }

  /** sample 番目のサンプルが鳴った時刻 */
  toMs(sample: number): number {
    return this.ms(sample) + (this.offset ?? 0);
  }
}
