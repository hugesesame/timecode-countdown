import { describe, expect, test } from 'vitest';
import { SampleClock } from './sampleclock';

describe('SampleClock', () => {
  test('サンプル位置を、届いた時刻に合わせて換算する', () => {
    const c = new SampleClock(48000);
    c.mark(48000, 5000);
    expect(c.toMs(48000)).toBe(5000);
    expect(c.toMs(24000)).toBe(4500);
  });

  test('遅れて届いた分には引きずられない', () => {
    const c = new SampleClock(48000);
    c.mark(480, 1010);
    // 画面の処理などで 30ms 遅れて届いた
    c.mark(960, 1050);
    c.mark(1440, 1030.1);
    expect(c.toMs(1440)).toBeCloseTo(1030, 0);
  });

  test('より早く届いたら、そちらに合わせる', () => {
    const c = new SampleClock(48000);
    c.mark(480, 1015);
    c.mark(960, 1020);
    expect(c.toMs(960)).toBe(1020);
  });

  test('音声と時計のずれがゆっくり広がっても追従する', () => {
    const c = new SampleClock(48000);
    // 音声側が 0.01% 遅く進む（1 秒あたり 0.1ms ずつ遅れて届く）
    for (let s = 0; s <= 600; s++) c.mark(s * 48000, s * 1000.1);
    expect(c.toMs(600 * 48000)).toBeCloseTo(600 * 1000.1, 0);
  });

  test('音声が止まって再開した時は、合わせ直す', () => {
    const c = new SampleClock(48000);
    c.mark(480, 1010);
    // 5 秒止まっていた後、続きのサンプルが届き続ける
    for (let i = 1; i <= 200; i++) c.mark(480 + i * 128, 6010 + (i * 128 * 1000) / 48000);
    expect(c.toMs(480 + 200 * 128)).toBeCloseTo(6010 + (200 * 128 * 1000) / 48000, 0);
  });
});
