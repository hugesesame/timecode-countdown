import { describe, expect, test } from 'vitest';
import { formatTimecode } from './timecode';
import { timeOfDayFrames } from './wallclock';

describe('timeOfDayFrames', () => {
  test('時計の時刻が、そのままタイムコードの表示になる', () => {
    expect(timeOfDayFrames(19, 30, 0, 0, '30')).toBe(19.5 * 3600 * 30);
    expect(formatTimecode(timeOfDayFrames(19, 30, 15, 0, '30'), '30')).toBe('19:30:15:00');
    expect(formatTimecode(timeOfDayFrames(7, 5, 9, 0, '24'), '24')).toBe('07:05:09:00');
  });

  test('1 秒未満の時間は、フレームの小数として進む', () => {
    expect(timeOfDayFrames(0, 0, 1, 500, '25')).toBeCloseTo(37.5, 9);
    expect(timeOfDayFrames(0, 0, 0, 999, '30')).toBeLessThan(30);
  });

  test('ドロップフレームでも、時・分・秒の表示が時計と一致する', () => {
    expect(formatTimecode(timeOfDayFrames(19, 30, 15, 500, '29.97df'), '29.97df').slice(0, 8)).toBe('19:30:15');
    expect(formatTimecode(timeOfDayFrames(23, 59, 59, 999, '29.97df'), '29.97df').slice(0, 8)).toBe('23:59:59');
    // 10 分ごとの分はフレームを飛ばさない
    expect(formatTimecode(timeOfDayFrames(0, 10, 0, 0, '29.97df'), '29.97df')).toBe('00:10:00;00');
  });

  test('ドロップフレームで存在しない ;00 と ;01 の時刻は、;02 から始まる', () => {
    expect(formatTimecode(timeOfDayFrames(0, 1, 0, 0, '29.97df'), '29.97df')).toBe('00:01:00;02');
  });

  test('ドロップフレームの分の境目でも、位置は戻らずに進み続ける', () => {
    const before = timeOfDayFrames(0, 0, 59, 999, '29.97df');
    const at = timeOfDayFrames(0, 1, 0, 0, '29.97df');
    const after = timeOfDayFrames(0, 1, 0, 999, '29.97df');
    const next = timeOfDayFrames(0, 1, 1, 0, '29.97df');
    expect(before).toBeLessThan(at);
    expect(at).toBeLessThan(after);
    expect(after).toBeLessThan(next);
  });
});
