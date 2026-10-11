import { describe, expect, test } from 'vitest';
import {
  convertFrameRate,
  formatOffset,
  formatTimecode,
  framesToParts,
  framesToSeconds,
  parseOffset,
  parseTimecode,
  secondsToFrames,
  timecodeToFrames,
} from './timecode';

describe('formatTimecode', () => {
  test('0 フレームは 00:00:00:00', () => {
    expect(formatTimecode(0, '30')).toBe('00:00:00:00');
  });

  test('30fps で 1 時間は 108000 フレーム', () => {
    expect(formatTimecode(108000, '30')).toBe('01:00:00:00');
  });

  test('25fps は 25 フレームで 1 秒繰り上がる', () => {
    expect(formatTimecode(24, '25')).toBe('00:00:00:24');
    expect(formatTimecode(25, '25')).toBe('00:00:01:00');
  });

  test('24fps は 24 フレームで 1 秒繰り上がる', () => {
    expect(formatTimecode(24, '24')).toBe('00:00:01:00');
  });

  test('小数のフレーム位置は切り捨てて表示する', () => {
    expect(formatTimecode(29.9, '30')).toBe('00:00:00:29');
  });

  test('ドロップフレームはフレームの前が ; になる', () => {
    expect(formatTimecode(0, '29.97df')).toBe('00:00:00;00');
  });

  test('ドロップフレームは毎分の頭で 00 と 01 を飛ばす', () => {
    expect(formatTimecode(1799, '29.97df')).toBe('00:00:59;29');
    expect(formatTimecode(1800, '29.97df')).toBe('00:01:00;02');
  });

  test('ドロップフレームは 10 分ごとには飛ばさない', () => {
    expect(formatTimecode(17981, '29.97df')).toBe('00:09:59;29');
    expect(formatTimecode(17982, '29.97df')).toBe('00:10:00;00');
  });

  test('ドロップフレームの 1 時間は 107892 フレーム', () => {
    expect(formatTimecode(107892, '29.97df')).toBe('01:00:00;00');
  });
});

describe('parseTimecode', () => {
  test('HH:MM:SS:FF をフレーム数にする', () => {
    expect(parseTimecode('01:00:00:00', '30')).toBe(108000);
    expect(parseTimecode('00:00:01:00', '25')).toBe(25);
  });

  test('区切りは ; と . も受け付ける', () => {
    expect(parseTimecode('00:00:01;05', '30')).toBe(35);
    expect(parseTimecode('00.00.01.05', '30')).toBe(35);
  });

  test('数字だけの入力は右詰めで解釈する', () => {
    expect(parseTimecode('1000', '30')).toBe(300);
    expect(parseTimecode('01000000', '30')).toBe(108000);
  });

  test('前後の空白は無視する', () => {
    expect(parseTimecode('  00:00:01:00 ', '30')).toBe(30);
  });

  test('フレームがレートの上限を超えたら null', () => {
    expect(parseTimecode('00:00:00:25', '25')).toBeNull();
    expect(parseTimecode('00:00:00:24', '24')).toBeNull();
  });

  test('分と秒が 60 以上なら null', () => {
    expect(parseTimecode('00:60:00:00', '30')).toBeNull();
    expect(parseTimecode('00:00:60:00', '30')).toBeNull();
  });

  test('24 時間以上は null', () => {
    expect(parseTimecode('24:00:00:00', '30')).toBeNull();
  });

  test('形式が違う入力は null', () => {
    expect(parseTimecode('', '30')).toBeNull();
    expect(parseTimecode('abc', '30')).toBeNull();
    expect(parseTimecode('1:2:3', '30')).toBeNull();
    expect(parseTimecode('123456789', '30')).toBeNull();
  });

  test('ドロップフレームで存在しない時刻は null', () => {
    expect(parseTimecode('00:01:00;00', '29.97df')).toBeNull();
    expect(parseTimecode('00:01:00;01', '29.97df')).toBeNull();
  });

  test('ドロップフレームでも 10 分ちょうどは存在する', () => {
    expect(parseTimecode('00:10:00;00', '29.97df')).toBe(17982);
  });

  test.each(['24', '25', '29.97df', '30'] as const)('%s で format と parse が往復する', (rate) => {
    for (const frames of [0, 1, 29, 1799, 1800, 17981, 17982, 107891, 107892, 1234567]) {
      expect(parseTimecode(formatTimecode(frames, rate), rate)).toBe(frames);
    }
  });
});

describe('framesToSeconds / secondsToFrames', () => {
  test('30fps は 30 フレームで 1 秒', () => {
    expect(framesToSeconds(30, '30')).toBe(1);
  });

  test('29.97 DF は 30 フレームで 1.001 秒', () => {
    expect(framesToSeconds(30, '29.97df')).toBeCloseTo(1.001, 9);
  });

  test('29.97 DF の 1 時間は実時間のほぼ 3600 秒', () => {
    expect(framesToSeconds(107892, '29.97df')).toBeCloseTo(3600, 0);
  });

  test('secondsToFrames は framesToSeconds の逆', () => {
    expect(secondsToFrames(2, '25')).toBe(50);
    expect(secondsToFrames(framesToSeconds(1234, '29.97df'), '29.97df')).toBeCloseTo(1234, 6);
  });
});

describe('convertFrameRate', () => {
  test('表示されている時刻を保ったまま別のレートのフレーム数にする', () => {
    // 00:00:01:10
    expect(convertFrameRate(40, '30', '25')).toBe(35);
  });

  test('変換先のレートにないフレーム番号は最後のフレームに丸める', () => {
    // 00:00:00:29 -> 00:00:00:24
    expect(convertFrameRate(29, '30', '25')).toBe(24);
  });

  test('ドロップフレームで存在しない時刻は直後の有効な時刻にする', () => {
    // 00:01:00:00 -> 00:01:00;02
    expect(convertFrameRate(1800, '30', '29.97df')).toBe(1800);
    expect(formatTimecode(convertFrameRate(1800, '30', '29.97df'), '29.97df')).toBe('00:01:00;02');
  });

  test('同じレートなら変わらない', () => {
    expect(convertFrameRate(12345, '25', '25')).toBe(12345);
  });
});

describe('timecodeToFrames', () => {
  test('時・分・秒・フレームの数値をフレーム数にする', () => {
    expect(timecodeToFrames(1, 0, 0, 0, '30')).toBe(108000);
    expect(timecodeToFrames(0, 1, 0, 2, '29.97df')).toBe(1800);
  });

  test('範囲外の値は null', () => {
    expect(timecodeToFrames(0, 0, 0, 30, '30')).toBeNull();
    expect(timecodeToFrames(24, 0, 0, 0, '30')).toBeNull();
  });
});

describe('parseOffset / formatOffset', () => {
  test('符号なしは正のオフセット', () => {
    expect(parseOffset('01:00:00:00', '30')).toBe(108000);
  });

  test('+ と - の符号を受け付ける', () => {
    expect(parseOffset('+00:00:10:00', '30')).toBe(300);
    expect(parseOffset('-00:00:10:00', '30')).toBe(-300);
  });

  test('数字だけの右詰め入力にも符号を付けられる', () => {
    expect(parseOffset('-1000', '30')).toBe(-300);
  });

  test('空欄は 0', () => {
    expect(parseOffset('  ', '30')).toBe(0);
  });

  test('読めない入力は null', () => {
    expect(parseOffset('abc', '30')).toBeNull();
    expect(parseOffset('--10', '30')).toBeNull();
  });

  test('符号を付けて表示する', () => {
    expect(formatOffset(108000, '30')).toBe('+01:00:00:00');
    expect(formatOffset(-300, '30')).toBe('-00:00:10:00');
    expect(formatOffset(0, '30')).toBe('+00:00:00:00');
  });
});

describe('framesToParts', () => {
  test('フレーム数を時・分・秒・フレームに分ける', () => {
    expect(framesToParts(108000 + 1800 * 2 + 30 * 3 + 4, '30')).toEqual([1, 2, 3, 4]);
  });

  test('ドロップフレームの飛ばしを反映する', () => {
    expect(framesToParts(1800, '29.97df')).toEqual([0, 1, 0, 2]);
  });

  test.each(['24', '25', '29.97df', '30'] as const)('%s で timecodeToFrames と往復する', (rate) => {
    for (const frames of [0, 29, 1800, 17982, 107892, 1234567]) {
      expect(timecodeToFrames(...framesToParts(frames, rate), rate)).toBe(frames);
    }
  });
});
