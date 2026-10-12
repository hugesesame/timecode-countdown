export interface Click {
  /** 何秒前のクリックか（3、2、1。0 は GO の瞬間） */
  count: number;
  /** 今から何秒後に鳴らすか */
  inSec: number;
}

export interface ClickTick {
  /** 止めた時や頭出しの時: 予定済みでまだ鳴っていないクリックを取り消す */
  cancel: boolean;
  clicks: Click[];
}

/** 残り時間がこれより長いまま Cue が切り替わったら、実行ではなく頭出しとみなす */
const LOCATE_SEC = 0.5;
/** 残り時間がこれより大きく増えたら、巻き戻しとみなす */
const REWIND_SEC = 0.05;

/**
 * 次の Cue までの残り時間から、クリック音（3、2、1 秒前と GO の瞬間）を鳴らす時刻を決める。
 * 呼ばれる間隔が揺れても正確な時刻に鳴らせるよう、少し先の分まで予定として返す。
 */
export class ClickScheduler {
  private cue: string | null = null;
  private last = 0;
  private scheduled = new Set<number>();

  constructor(
    private readonly counts: readonly number[] = [3, 2, 1, 0],
    private readonly lookaheadSec = 0.2,
  ) {}

  tick(cue: string | null, remainingSec: number, running: boolean): ClickTick {
    if (!running || cue === null) {
      // 最後の Cue が実行されて次がなくなっただけなら、鳴り始める GO の音は残す
      const cancel = this.scheduled.size > 0 && (!running || this.last > LOCATE_SEC);
      this.scheduled.clear();
      this.cue = null;
      this.last = 0;
      return { cancel, clicks: [] };
    }

    let cancel = false;
    const moved = cue !== this.cue ? this.last > LOCATE_SEC : remainingSec > this.last + REWIND_SEC;
    if (cue !== this.cue || moved) {
      cancel = moved && this.scheduled.size > 0;
      this.scheduled.clear();
    }
    this.cue = cue;
    this.last = remainingSec;

    const clicks: Click[] = [];
    for (const count of this.counts) {
      const inSec = remainingSec - count;
      if (inSec < 0 || inSec > this.lookaheadSec || this.scheduled.has(count)) continue;
      this.scheduled.add(count);
      clicks.push({ count, inSec });
    }
    return { cancel, clicks };
  }
}
