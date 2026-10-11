import { describe, expect, test } from 'vitest';
import { advance, locate, withOffset, type EngineCue } from './engine';

const cue = (id: string, triggerFrame: number | null, enabled = true): EngineCue => ({
  id,
  triggerFrame,
  enabled,
});
const opts = { jumpFrames: 60, fireSkipped: false };

describe('advance: 連続して進む時', () => {
  test('位置が Trigger Time を越えたら実行する', () => {
    const r = advance([cue('a', 100)], new Set(), 99, 100.5, opts);
    expect(r.toFire).toEqual(['a']);
    expect(r.fired.has('a')).toBe(true);
  });

  test('Trigger Time に届く前は実行しない', () => {
    const r = advance([cue('a', 100)], new Set(), 98, 99.9, opts);
    expect(r.toFire).toEqual([]);
    expect(r.fired.has('a')).toBe(false);
  });

  test('位置がちょうど Trigger Time になった時に実行する', () => {
    const r = advance([cue('a', 100)], new Set(), 99, 100, opts);
    expect(r.toFire).toEqual(['a']);
  });

  test('一度実行した Cue は二度実行しない', () => {
    const first = advance([cue('a', 100)], new Set(), 99, 100, opts);
    const second = advance([cue('a', 100)], first.fired, 100, 101, opts);
    expect(second.toFire).toEqual([]);
  });

  test('頭出しした位置ちょうどの Cue は再生開始で実行する', () => {
    const cues = [cue('a', 100)];
    const r = advance(cues, locate(cues, 100), 100, 100.5, opts);
    expect(r.toFire).toEqual(['a']);
  });

  test('オフの Cue は実行しないが通過済みになる', () => {
    const r = advance([cue('a', 100, false)], new Set(), 99, 101, opts);
    expect(r.toFire).toEqual([]);
    expect(r.fired.has('a')).toBe(true);
  });

  test('過去の時刻で後から追加された Cue は実行せず通過済みにする', () => {
    const r = advance([cue('a', 100)], new Set(), 500, 501, opts);
    expect(r.toFire).toEqual([]);
    expect(r.fired.has('a')).toBe(true);
  });

  test('同じ区間に複数あれば Trigger Time の順に実行する', () => {
    const r = advance([cue('b', 101), cue('a', 100)], new Set(), 99, 102, opts);
    expect(r.toFire).toEqual(['a', 'b']);
  });

  test('Trigger Time が未設定の Cue は無視する', () => {
    const r = advance([cue('a', null)], new Set(), 0, 1000, { ...opts, jumpFrames: 5000 });
    expect(r.toFire).toEqual([]);
    expect(r.fired.has('a')).toBe(false);
  });

  test('渡された実行済みの集合は書き換えない', () => {
    const fired = new Set<string>();
    advance([cue('a', 100)], fired, 99, 100, opts);
    expect(fired.size).toBe(0);
  });
});

describe('advance: 戻った時', () => {
  test('戻った位置以降の Cue を再び有効にし、何も実行しない', () => {
    const cues = [cue('a', 100), cue('b', 200)];
    const r = advance(cues, new Set(['a', 'b']), 300, 150, opts);
    expect(r.toFire).toEqual([]);
    expect(r.fired.has('b')).toBe(false);
  });

  test('戻った位置より前の Cue は通過済みのまま', () => {
    const cues = [cue('a', 100), cue('b', 200)];
    const r = advance(cues, new Set(['a', 'b']), 300, 150, opts);
    expect(r.fired.has('a')).toBe(true);
  });

  test('戻った位置ちょうどの Cue は再び有効になる', () => {
    const r = advance([cue('a', 100)], new Set(['a']), 300, 100, opts);
    expect(r.fired.has('a')).toBe(false);
  });
});

describe('advance: 先に飛んだ時', () => {
  test('飛び越えた Cue は実行せず通過済みにする', () => {
    const r = advance([cue('a', 100)], new Set(), 50, 500, opts);
    expect(r.toFire).toEqual([]);
    expect(r.fired.has('a')).toBe(true);
  });

  test('飛んだ先より後の Cue は有効なまま', () => {
    const r = advance([cue('a', 100), cue('b', 600)], new Set(), 50, 500, opts);
    expect(r.fired.has('b')).toBe(false);
  });

  test('fireSkipped が有効なら飛び越えた Cue も実行する', () => {
    const r = advance([cue('a', 100)], new Set(), 50, 500, { ...opts, fireSkipped: true });
    expect(r.toFire).toEqual(['a']);
  });

  test('fireSkipped が有効でも実行済みの Cue は実行しない', () => {
    const r = advance([cue('a', 100)], new Set(['a']), 50, 500, { ...opts, fireSkipped: true });
    expect(r.toFire).toEqual([]);
  });

  test('jumpFrames 以内の進みは連続として扱う', () => {
    const r = advance([cue('a', 100)], new Set(), 50, 110, opts);
    expect(r.toFire).toEqual(['a']);
  });
});

describe('locate', () => {
  test('位置より前の Cue を通過済みにする', () => {
    const fired = locate([cue('a', 100), cue('b', 200)], 150);
    expect([...fired]).toEqual(['a']);
  });

  test('位置ちょうどの Cue は有効なまま', () => {
    expect(locate([cue('a', 100)], 100).has('a')).toBe(false);
  });
});

describe('withOffset', () => {
  test('Trigger Time にオフセットを足す', () => {
    expect(withOffset([cue('a', 100)], 1000)).toEqual([cue('a', 1100)]);
  });

  test('負のオフセットも足す', () => {
    expect(withOffset([cue('a', 100)], -40)).toEqual([cue('a', 60)]);
  });

  test('Trigger Time が未設定の Cue は未設定のまま', () => {
    expect(withOffset([cue('a', null)], 1000)).toEqual([cue('a', null)]);
  });

  test('オンとオフの状態はそのまま', () => {
    expect(withOffset([cue('a', 100, false)], 10)).toEqual([cue('a', 110, false)]);
  });
});
