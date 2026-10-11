import { describe, expect, test } from 'vitest';
import { MtcDecoder } from './mtc';

const RATE_CODE = { '24': 0, '25': 1, '29.97df': 2, '30': 3 } as const;

/** 1 つの時刻を表すクォーターフレーム 8 個 */
function quarterFrames(hh: number, mm: number, ss: number, ff: number, rate: keyof typeof RATE_CODE): number[][] {
  const nibbles = [
    ff & 0xf,
    ff >> 4,
    ss & 0xf,
    ss >> 4,
    mm & 0xf,
    mm >> 4,
    hh & 0xf,
    (RATE_CODE[rate] << 1) | (hh >> 4),
  ];
  return nibbles.map((n, piece) => [0xf1, (piece << 4) | n]);
}

const feedAll = (d: MtcDecoder, messages: number[][]) => messages.map((m) => d.feed(m));

describe('MtcDecoder: クォーターフレーム', () => {
  test('8 個そろうまでは何も返さない', () => {
    const d = new MtcDecoder();
    const results = feedAll(d, quarterFrames(1, 2, 3, 4, '30').slice(0, 7));
    expect(results.every((r) => r === null)).toBe(true);
  });

  test('8 個そろうと、送り始めの時刻から 1.75 フレーム進んだ位置を返す', () => {
    const d = new MtcDecoder();
    const last = feedAll(d, quarterFrames(0, 0, 1, 0, '30')).at(-1);
    expect(last).toEqual({ kind: 'running', frames: 30 + 1.75, rate: '30' });
  });

  test('そろった後は 1 個ごとに 0.25 フレーム進む', () => {
    const d = new MtcDecoder();
    feedAll(d, quarterFrames(0, 0, 1, 0, '30'));
    const next = quarterFrames(0, 0, 1, 2, '30');
    expect(d.feed(next[0] as number[])).toEqual({ kind: 'running', frames: 32, rate: '30' });
    expect(d.feed(next[1] as number[])).toEqual({ kind: 'running', frames: 32.25, rate: '30' });
  });

  test('途中から受け始めた時は、次の 8 個がそろってから返す', () => {
    const d = new MtcDecoder();
    const partial = feedAll(d, quarterFrames(0, 0, 1, 0, '30').slice(3));
    expect(partial.every((r) => r === null)).toBe(true);
    const last = feedAll(d, quarterFrames(0, 0, 1, 2, '30')).at(-1);
    expect(last).toEqual({ kind: 'running', frames: 32 + 1.75, rate: '30' });
  });

  test('順番が飛んだら、次の 8 個がそろうまで何も返さない', () => {
    const d = new MtcDecoder();
    feedAll(d, quarterFrames(0, 0, 1, 0, '30'));
    const next = quarterFrames(0, 0, 1, 2, '30');
    expect(d.feed(next[0] as number[])).not.toBeNull();
    expect(d.feed(next[2] as number[])).toBeNull();
    expect(d.feed(next[3] as number[])).toBeNull();
  });

  test.each(['24', '25', '29.97df', '30'] as const)('レート %s を読み取る', (rate) => {
    const d = new MtcDecoder();
    expect(feedAll(d, quarterFrames(0, 0, 0, 0, rate)).at(-1)?.rate).toBe(rate);
  });

  test('時の上位ビットとレートを分けて読む', () => {
    const d = new MtcDecoder();
    const last = feedAll(d, quarterFrames(23, 59, 59, 24, '25')).at(-1);
    expect(last).toEqual({ kind: 'running', frames: (23 * 3600 + 59 * 60 + 59) * 25 + 24 + 1.75, rate: '25' });
  });

  test('ドロップフレームの時刻をフレーム数にする', () => {
    const d = new MtcDecoder();
    const last = feedAll(d, quarterFrames(0, 1, 0, 2, '29.97df')).at(-1);
    expect(last).toEqual({ kind: 'running', frames: 1800 + 1.75, rate: '29.97df' });
  });
});

describe('MtcDecoder: フルフレーム', () => {
  test('フルフレームのメッセージは頭出しとして返す', () => {
    const d = new MtcDecoder();
    // 01:00:00:00 @ 30fps（レート 3 は時のバイトの上位に入る）
    const msg = [0xf0, 0x7f, 0x7f, 0x01, 0x01, (3 << 5) | 1, 0, 0, 0, 0xf7];
    expect(d.feed(msg)).toEqual({ kind: 'locate', frames: 108000, rate: '30' });
  });

  test('フルフレームの後は、クォーターフレームが 8 個そろうまで何も返さない', () => {
    const d = new MtcDecoder();
    feedAll(d, quarterFrames(0, 0, 1, 0, '30'));
    d.feed([0xf0, 0x7f, 0x7f, 0x01, 0x01, (3 << 5) | 1, 0, 0, 0, 0xf7]);
    expect(d.feed(quarterFrames(1, 0, 0, 0, '30')[0] as number[])).toBeNull();
  });

  test('別の種類の SysEx は無視する', () => {
    expect(new MtcDecoder().feed([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7])).toBeNull();
  });
});

describe('MtcDecoder: その他', () => {
  test('MTC 以外のメッセージは無視する', () => {
    expect(new MtcDecoder().feed([0x90, 60, 127])).toBeNull();
  });

  test('MTC 以外のメッセージが挟まっても同期は切れない', () => {
    const d = new MtcDecoder();
    feedAll(d, quarterFrames(0, 0, 1, 0, '30'));
    d.feed([0xf8]);
    expect(d.feed(quarterFrames(0, 0, 1, 2, '30')[0] as number[])).not.toBeNull();
  });
});
