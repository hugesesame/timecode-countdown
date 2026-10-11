import { timecodeToFrames, type FrameRate } from './timecode';

export interface MtcEvent {
  /** running: 走っている最中の位置 / locate: 頭出し（その位置で止まっている） */
  kind: 'running' | 'locate';
  /** rate で数えたフレーム位置（小数を含む） */
  frames: number;
  rate: FrameRate;
}

const RATES: readonly FrameRate[] = ['24', '25', '29.97df', '30'];

/**
 * MIDI メッセージから MTC を読み取る。
 * クォーターフレームは 8 個で 1 つの時刻になり、そろった時点では
 * 送り始めから 1.75 フレーム進んでいるので、その分を足して返す。
 */
export class MtcDecoder {
  private nibbles = new Array<number>(8).fill(0);
  /** 0 から順に受け取れているピースの数 */
  private collected = 0;
  private lastPiece = -1;
  /** 直近に確定した位置。未確定なら null */
  private current: { frames: number; rate: FrameRate } | null = null;

  feed(data: ArrayLike<number>): MtcEvent | null {
    const status = data[0];
    if (status === 0xf1 && data.length >= 2) return this.quarterFrame(data[1] as number);
    if (status === 0xf0) return this.fullFrame(data);
    return null;
  }

  private reset(): void {
    this.collected = 0;
    this.lastPiece = -1;
    this.current = null;
  }

  private quarterFrame(value: number): MtcEvent | null {
    const piece = (value >> 4) & 0x7;
    const inOrder = piece === (this.lastPiece + 1) % 8;
    if (!inOrder) this.reset();
    this.lastPiece = piece;

    if (piece === 0) this.collected = 1;
    else if (inOrder && this.collected === piece) this.collected += 1;
    else this.collected = 0;
    this.nibbles[piece] = value & 0xf;

    if (this.collected === 8) {
      const n = this.nibbles as [number, number, number, number, number, number, number, number];
      const rate = RATES[(n[7] >> 1) & 0x3] as FrameRate;
      const base = timecodeToFrames(n[6] | ((n[7] & 0x1) << 4), n[4] | (n[5] << 4), n[2] | (n[3] << 4), n[0] | (n[1] << 4), rate);
      this.current = base === null ? null : { frames: base + 1.75, rate };
    } else if (this.current) {
      this.current = { frames: this.current.frames + 0.25, rate: this.current.rate };
    }
    return this.current ? { kind: 'running', ...this.current } : null;
  }

  /** F0 7F <dev> 01 01 hh mm ss ff F7（hh の上位にレートが入る） */
  private fullFrame(data: ArrayLike<number>): MtcEvent | null {
    if (data.length < 10 || data[1] !== 0x7f || data[3] !== 0x01 || data[4] !== 0x01) return null;
    const hh = data[5] as number;
    const rate = RATES[(hh >> 5) & 0x3] as FrameRate;
    const frames = timecodeToFrames(hh & 0x1f, data[6] as number, data[7] as number, data[8] as number, rate);
    this.reset();
    return frames === null ? null : { kind: 'locate', frames, rate };
  }
}
