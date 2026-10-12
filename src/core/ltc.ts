import { timecodeToFrames, type FrameRate } from './timecode';

export interface LtcEvent {
  /** フレームの終わり（= 次のフレームの頭）でのフレーム位置。rate で数える */
  frames: number;
  rate: FrameRate;
  /** そのフレームが終わったサンプル位置（feed に渡した通算のサンプル数で数える） */
  endSample: number;
}

/** フレームの最後の 16 ビットに入っている目印 */
const SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];
/** これより小さい信号は無音として扱う（およそ -50 dBFS） */
const MIN_LEVEL = 0.003;

/**
 * 音声から LTC を読み取る。
 * LTC は 1 フレームが 80 ビットで、ビットの境目では必ず極性が反転し、
 * 1 のビットは真ん中でもう一度反転する。反転の間隔が短いか長いかでビットを見分ける。
 * フレームレートは 1 フレームの長さから見分ける（LTC 自体には入っていない）。
 */
export class LtcDecoder {
  /** 入力のレベル（ピーク、0 〜 1）。無音が続くと下がっていく */
  level = 0;

  private count = 0;
  private prevIn = 0;
  private filtered = 0;
  private sign = 0;
  private lastFlip = -1;
  /** 1 ビットの長さの見積もり（サンプル数） */
  private period: number;
  private half = false;
  private bits = new Uint8Array(80);
  private bitCount = 0;
  private lastSync = -1;
  private bitsSinceSync = 0;

  constructor(private readonly sampleRate: number) {
    // 24 〜 30 fps のどれでも、短い間隔と長い間隔を見分けられる長さから始める
    this.period = sampleRate / 2160;
  }

  feed(samples: Float32Array): LtcEvent[] {
    const events: LtcEvent[] = [];
    for (let i = 0; i < samples.length; i++, this.count++) {
      // 直流のずれを取り除く
      const x = samples[i] as number;
      this.filtered = x - this.prevIn + 0.995 * this.filtered;
      this.prevIn = x;
      const y = this.filtered;
      this.level = Math.max(Math.abs(y), this.level * 0.9995);
      if (this.level < MIN_LEVEL) continue;

      // ノイズで何度も反転しないよう、レベルに応じた幅を越えた時だけ反転とみなす
      const threshold = this.level * 0.3;
      const sign = y > threshold ? 1 : y < -threshold ? -1 : this.sign;
      if (sign === this.sign) continue;
      this.sign = sign;
      if (this.lastFlip >= 0) this.flip(this.count - this.lastFlip, events);
      this.lastFlip = this.count;
    }
    return events;
  }

  private resync(): void {
    this.half = false;
    this.bitCount = 0;
    this.lastSync = -1;
  }

  /** 前の反転から interval サンプル後に反転した */
  private flip(interval: number, events: LtcEvent[]): void {
    if (interval > this.period * 1.6) {
      this.resync();
      return;
    }
    if (interval > this.period * 0.75) {
      this.period += (interval - this.period) * 0.1;
      // 1 のビットの途中で長い間隔が来たら、読み違えている
      if (this.half) this.resync();
      this.push(0, events);
    } else {
      this.period += (interval * 2 - this.period) * 0.05;
      if (this.half) this.push(1, events);
      this.half = !this.half;
    }
    const min = this.sampleRate / 2400 / 1.3;
    const max = (this.sampleRate / 1920) * 1.3;
    this.period = Math.min(max, Math.max(min, this.period));
  }

  private push(bit: number, events: LtcEvent[]): void {
    this.bits.copyWithin(0, 1);
    this.bits[79] = bit;
    this.bitCount++;
    this.bitsSinceSync++;
    if (this.bitCount < 16) return;
    for (let i = 0; i < 16; i++) if (this.bits[64 + i] !== SYNC[i]) return;

    // 1 つ前の目印からちょうど 80 ビットの時だけ、正しいフレームとして扱う
    const previous = this.bitsSinceSync === 80 ? this.lastSync : -1;
    this.lastSync = this.count;
    this.bitsSinceSync = 0;
    if (previous < 0) return;

    const fps = this.sampleRate / (this.count - previous);
    const dropFrame = this.bits[10] === 1;
    const rate: FrameRate = fps < 24.5 ? '24' : fps < 27.5 ? '25' : dropFrame ? '29.97df' : '30';
    const frames = timecodeToFrames(
      this.field(48, 4) + this.field(56, 2) * 10,
      this.field(32, 4) + this.field(40, 3) * 10,
      this.field(16, 4) + this.field(24, 3) * 10,
      this.field(0, 4) + this.field(8, 2) * 10,
      rate,
    );
    if (frames !== null) events.push({ frames: frames + 1, rate, endSample: this.count });
  }

  private field(start: number, length: number): number {
    let value = 0;
    for (let i = 0; i < length; i++) value |= (this.bits[start + i] as number) << i;
    return value;
  }
}
