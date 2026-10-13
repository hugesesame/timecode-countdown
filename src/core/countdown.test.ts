import { describe, expect, test } from 'vitest';
import { cueThresholds, formatCountdown, laneMarkers, nextCue, stageFor, BeatWatcher } from './countdown';
import type { EngineCue } from './engine';

const cue = (id: string, triggerFrame: number | null, enabled = true): EngineCue => ({
  id,
  triggerFrame,
  enabled,
});

describe('nextCue', () => {
  test('現在位置以降で一番早い Cue を返す', () => {
    const cues = [cue('b', 300), cue('a', 200), cue('past', 50)];
    expect(nextCue(cues, new Set(), 100)?.id).toBe('a');
  });

  test('実行済みの Cue は飛ばす', () => {
    const cues = [cue('a', 200), cue('b', 300)];
    expect(nextCue(cues, new Set(['a']), 100)?.id).toBe('b');
  });

  test('オフの Cue は飛ばす', () => {
    const cues = [cue('a', 200, false), cue('b', 300)];
    expect(nextCue(cues, new Set(), 100)?.id).toBe('b');
  });

  test('Trigger Time が未設定の Cue は飛ばす', () => {
    const cues = [cue('a', null), cue('b', 300)];
    expect(nextCue(cues, new Set(), 100)?.id).toBe('b');
  });

  test('同じ時刻ならリストで上にある方を返す', () => {
    const cues = [cue('first', 200), cue('second', 200)];
    expect(nextCue(cues, new Set(), 100)?.id).toBe('first');
  });

  test('該当がなければ null', () => {
    expect(nextCue([cue('a', 50)], new Set(), 100)).toBeNull();
  });
});

describe('stageFor', () => {
  const t = { standbySec: 10, warnSec: 5, finalSec: 3 };

  test('窓の外は idle', () => {
    expect(stageFor(10.1, t)).toBe('idle');
  });

  test('standbySec 以内は standby', () => {
    expect(stageFor(10, t)).toBe('standby');
    expect(stageFor(5.1, t)).toBe('standby');
  });

  test('warnSec 以内は warn', () => {
    expect(stageFor(5, t)).toBe('warn');
  });

  test('finalSec 以内は final', () => {
    expect(stageFor(3, t)).toBe('final');
    expect(stageFor(0, t)).toBe('final');
  });
});

describe('formatCountdown', () => {
  test('1 分未満は 10 分の 1 秒まで表示する', () => {
    expect(formatCountdown(9.87)).toBe('9.8');
    expect(formatCountdown(59.99)).toBe('59.9');
    expect(formatCountdown(0)).toBe('0.0');
  });

  test('1 分以上は M:SS', () => {
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(125.5)).toBe('2:05');
  });

  test('1 時間以上は H:MM:SS', () => {
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(3725)).toBe('1:02:05');
  });

  test('負の値は 0.0', () => {
    expect(formatCountdown(-1)).toBe('0.0');
  });
});

describe('laneMarkers', () => {
  test('窓の半分まで来た Cue の progress は 0.5', () => {
    const m = laneMarkers([cue('a', 150)], new Set(), 0, '30', 10);
    expect(m).toHaveLength(1);
    expect(m[0]?.id).toBe('a');
    expect(m[0]?.progress).toBeCloseTo(0.5, 9);
  });

  test('GO の瞬間の progress は 1', () => {
    const m = laneMarkers([cue('a', 150)], new Set(), 150, '30', 10);
    expect(m[0]?.progress).toBe(1);
  });

  test('窓の外の Cue は含めない', () => {
    expect(laneMarkers([cue('a', 301)], new Set(), 0, '30', 10)).toEqual([]);
  });

  test('実行済み・オフ・通過済みの Cue は含めない', () => {
    const cues = [cue('fired', 100), cue('off', 110, false), cue('past', 10)];
    expect(laneMarkers(cues, new Set(['fired']), 50, '30', 10)).toEqual([]);
  });

  test('GO に近い順に並ぶ', () => {
    const m = laneMarkers([cue('far', 200), cue('near', 100)], new Set(), 0, '30', 10);
    expect(m.map((x) => x.id)).toEqual(['near', 'far']);
  });
});

describe('cueThresholds', () => {
  const settings = { standbySec: 10, warnSec: 5, finalSec: 3 };

  test('Cue に設定がなければ全体の設定を使う', () => {
    expect(cueThresholds(null, settings)).toEqual(settings);
  });

  test('Cue の設定で色が変わり始める秒数を上書きする', () => {
    expect(cueThresholds(30, settings)).toEqual({ standbySec: 30, warnSec: 5, finalSec: 3 });
  });

  test('Cue の設定が短い時は、後の段階もそれ以内に収める', () => {
    expect(cueThresholds(4, settings)).toEqual({ standbySec: 4, warnSec: 4, finalSec: 3 });
    expect(cueThresholds(2, settings)).toEqual({ standbySec: 2, warnSec: 2, finalSec: 2 });
  });
});

describe('formatCountdown: 整数表示', () => {
  test('端数は切り上げる', () => {
    expect(formatCountdown(2.3, 'whole')).toBe('3');
    expect(formatCountdown(0.01, 'whole')).toBe('1');
  });

  test('ちょうどの秒数はそのまま', () => {
    expect(formatCountdown(3, 'whole')).toBe('3');
    expect(formatCountdown(0, 'whole')).toBe('0');
  });

  test('切り上げて 60 秒になったら 1:00 と表示する', () => {
    expect(formatCountdown(59.2, 'whole')).toBe('1:00');
  });

  test('1 分以上も切り上げる', () => {
    expect(formatCountdown(60.4, 'whole')).toBe('1:01');
    expect(formatCountdown(3599.5, 'whole')).toBe('1:00:00');
  });

  test('負の値は 0', () => {
    expect(formatCountdown(-1, 'whole')).toBe('0');
  });
});

describe('BeatWatcher', () => {
  test('残り時間が 3、2、1 秒を越えるたびに、その数を返す', () => {
    const w = new BeatWatcher();
    expect(w.step('a', 3.2)).toBeNull();
    expect(w.step('a', 3.0)).toBe(3);
    expect(w.step('a', 2.9)).toBeNull();
    w.step('a', 2.4);
    expect(w.step('a', 1.98)).toBe(2);
    w.step('a', 1.5);
    w.step('a', 1.02);
    expect(w.step('a', 0.99)).toBe(1);
    expect(w.step('a', 0.5)).toBeNull();
  });

  test('タイムコードが飛んで入ってきた時は返さない', () => {
    const w = new BeatWatcher();
    w.step('a', 20);
    expect(w.step('a', 2.5)).toBeNull();
    w.step('a', 2.01);
    expect(w.step('a', 1.99)).toBe(2);
  });

  test('次の Cue が替わった時は返さない', () => {
    const w = new BeatWatcher();
    w.step('a', 0.01);
    expect(w.step('b', 2.99)).toBeNull();
    expect(w.step(null, 0)).toBeNull();
  });

  test('止まっている時と戻った時は返さない', () => {
    const w = new BeatWatcher();
    w.step('a', 2.5);
    expect(w.step('a', 2.5)).toBeNull();
    expect(w.step('a', 3.5)).toBeNull();
  });
});
