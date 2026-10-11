/**
 * 続けて来るはずのもの（受信メッセージ、送信処理の呼び出し）の間隔を見て、
 * 途切れた回数と最長の間隔を数える。
 */
export class GapMeter {
  count = 0;
  longestMs = 0;
  private last: number | null = null;

  constructor(
    /** これを超える間隔を途切れとして数える */
    private readonly thresholdMs: number,
    /** これを超える間隔は、止まっていたと見なして数えない */
    private readonly ignoreAboveMs = 5000,
  ) {}

  mark(nowMs: number): void {
    if (this.last !== null) {
      const gap = nowMs - this.last;
      if (gap > this.thresholdMs && gap <= this.ignoreAboveMs) {
        this.count += 1;
        this.longestMs = Math.max(this.longestMs, gap);
      }
    }
    this.last = nowMs;
  }

  /** 止まった。次の mark は間隔として数えない。 */
  pause(): void {
    this.last = null;
  }

  reset(): void {
    this.count = 0;
    this.longestMs = 0;
    this.last = null;
  }
}
