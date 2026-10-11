import { framesToParts, realFps, type FrameRate } from './timecode';

export interface TimedMessage {
  data: number[];
  /** 送信する時刻（ms） */
  at: number;
}

const RATE_CODE: Record<FrameRate, number> = { '24': 0, '25': 1, '29.97df': 2, '30': 3 };

function fullFrame(frame: number, rate: FrameRate): number[] {
  const [hh, mm, ss, ff] = framesToParts(frame, rate);
  return [0xf0, 0x7f, 0x7f, 0x01, 0x01, (RATE_CODE[rate] << 5) | (hh & 0x1f), mm, ss, ff, 0xf7];
}

/** quarter: タイムコード 0 から数えたクォーターフレームの通し番号（位置 = quarter / 4 フレーム） */
function quarterFrame(quarter: number, rate: FrameRate): number[] {
  const piece = quarter % 8;
  // 8 個で 1 つの時刻を送る。その時刻はピース 0 を送る時点のフレーム
  const [hh, mm, ss, ff] = framesToParts(Math.floor(quarter / 8) * 2, rate);
  const nibbles = [
    ff & 0xf,
    ff >> 4,
    ss & 0xf,
    ss >> 4,
    mm & 0xf,
    mm >> 4,
    hh & 0xf,
    (RATE_CODE[rate] << 1) | ((hh >> 4) & 0x1),
  ];
  return [0xf1, (piece << 4) | (nibbles[piece] as number)];
}

/**
 * 内蔵ジェネレーターの位置から、送信する MTC のメッセージを作る。
 * 再生中は少し先の分まで時刻を付けて渡し、停止や頭出しはフルフレームで知らせる。
 */
export class MtcOutScheduler {
  /** 次に送るクォーターフレームの通し番号。再生中でなければ null */
  private nextQuarter: number | null = null;
  /** 最後に渡したメッセージの送信時刻 */
  private lastAt = -Infinity;
  /** 停止中に最後に知らせたフレーム */
  private heldFrame: number | null = null;
  /** 前回の再生中の呼び出し。位置が飛んだかどうかの判定に使う */
  private previous: { nowMs: number; pos: number } | null = null;

  constructor(
    readonly rate: FrameRate,
    /** 何 ms 先の分までまとめて渡すか */
    private readonly lookaheadMs = 100,
  ) {}

  tick(nowMs: number, pos: number, running: boolean): TimedMessage[] {
    const out: TimedMessage[] = [];
    const push = (data: number[], at: number): void => {
      out.push({ data, at });
      this.lastAt = at;
    };

    if (!running) {
      const frame = Math.floor(pos);
      if (this.nextQuarter !== null || this.heldFrame !== frame) {
        // 送信済みのクォーターフレームより後に届くようにする
        push(fullFrame(frame, this.rate), Math.max(nowMs, this.lastAt + 1));
        this.heldFrame = frame;
        this.nextQuarter = null;
      }
      this.previous = null;
      return out;
    }

    this.heldFrame = null;
    const fps = realFps(this.rate);
    const quarter = pos * 4;
    const horizon = quarter + (this.lookaheadMs / 1000) * fps * 4;

    // 経過時間から見込まれる位置と大きく違えば、再生中に頭出しされている
    const expected = this.previous ? this.previous.pos + ((nowMs - this.previous.nowMs) / 1000) * fps : pos;
    const jumped = Math.abs(pos - expected) > 2;
    this.previous = { nowMs, pos };
    if (jumped) push(fullFrame(Math.floor(pos), this.rate), nowMs);
    // 呼び出しが遅れて送りそびれた分は飛ばし、次の区切りから送り直す
    if (this.nextQuarter === null || jumped || this.nextQuarter < quarter) {
      this.nextQuarter = Math.ceil(quarter / 8) * 8;
    }

    while (this.nextQuarter <= horizon + 1e-9) {
      const at = nowMs + ((this.nextQuarter - quarter) / 4 / fps) * 1000;
      push(quarterFrame(this.nextQuarter, this.rate), at);
      this.nextQuarter += 1;
    }
    return out;
  }
}
