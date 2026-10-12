import { describe, expect, test } from 'vitest';
import { ClickScheduler } from './click';

/** 0.05 秒刻みで時計を進めながら tick を呼び、鳴らす予定になったクリックを集める */
function run(s: ClickScheduler, cue: string, from: number, to: number): { count: number; at: number }[] {
  const out: { count: number; at: number }[] = [];
  for (let i = 0; from - i * 0.05 >= to - 1e-9; i++) {
    const remaining = from - i * 0.05;
    for (const c of s.tick(cue, remaining, true).clicks) {
      // at: Cue の何秒前に鳴るか
      out.push({ count: c.count, at: Math.round((remaining - c.inSec) * 1000) / 1000 });
    }
  }
  return out;
}

describe('ClickScheduler', () => {
  test('残り 3、2、1 秒と GO の瞬間に 1 回ずつ鳴らす', () => {
    const s = new ClickScheduler();
    expect(run(s, 'a', 5, 0)).toEqual([
      { count: 3, at: 3 },
      { count: 2, at: 2 },
      { count: 1, at: 1 },
      { count: 0, at: 0 },
    ]);
  });

  test('先読みの範囲に入るまでは予定しない', () => {
    const s = new ClickScheduler([3, 2, 1], 0.2);
    expect(s.tick('a', 3.3, true).clicks).toEqual([]);
    const [click] = s.tick('a', 3.15, true).clicks;
    expect(click?.count).toBe(3);
    expect(click?.inSec).toBeCloseTo(0.15);
  });

  test('すでに過ぎた秒は鳴らさない', () => {
    const s = new ClickScheduler();
    expect(run(s, 'a', 2.5, 0).map((c) => c.count)).toEqual([2, 1, 0]);
  });

  test('時計が止まっている間は鳴らさない', () => {
    const s = new ClickScheduler();
    expect(s.tick('a', 3.1, false).clicks).toEqual([]);
  });

  test('次の Cue がなければ鳴らさない', () => {
    const s = new ClickScheduler();
    expect(s.tick(null, 0, true).clicks).toEqual([]);
  });

  test('Cue が切り替わったら、その Cue の残り秒で鳴らす', () => {
    const s = new ClickScheduler();
    run(s, 'a', 4, 0);
    expect(run(s, 'b', 1.5, 0).map((c) => c.count)).toEqual([1, 0]);
  });

  test('巻き戻したら、もう一度鳴らす', () => {
    const s = new ClickScheduler();
    run(s, 'a', 4, 1.5);
    expect(run(s, 'a', 4, 0).map((c) => c.count)).toEqual([3, 2, 1, 0]);
  });

  test('止めた時は、予定済みのクリックを取り消す', () => {
    const s = new ClickScheduler();
    expect(s.tick('a', 3.1, true).cancel).toBe(false);
    expect(s.tick('a', 3.1, false).cancel).toBe(true);
    // 止まったままなら、取り消しは 1 回だけ
    expect(s.tick('a', 3.1, false).cancel).toBe(false);
  });

  test('止めて再開したら、取り消した分をもう一度予定する', () => {
    const s = new ClickScheduler();
    s.tick('a', 3.1, true);
    s.tick('a', 3.1, false);
    expect(s.tick('a', 3.1, true).clicks.map((c) => c.count)).toEqual([3]);
  });

  test('巻き戻した時は、予定済みのクリックを取り消す', () => {
    const s = new ClickScheduler();
    s.tick('a', 3.1, true);
    expect(s.tick('a', 8, true).cancel).toBe(true);
  });

  test('頭出しで別の Cue に移った時は、予定済みのクリックを取り消す', () => {
    const s = new ClickScheduler();
    s.tick('a', 3.1, true);
    expect(s.tick('b', 20, true).cancel).toBe(true);
  });

  test('Cue が実行されて次の Cue に移った時は、取り消さない', () => {
    const s = new ClickScheduler();
    run(s, 'a', 1.2, 0);
    expect(s.tick('b', 1.1, true)).toEqual({ cancel: false, clicks: [{ count: 1, inSec: expect.closeTo(0.1) }] });
  });

  test('最後の Cue が実行されて次がなくなった時は、GO の音を取り消さない', () => {
    const s = new ClickScheduler();
    run(s, 'a', 1.2, 0);
    expect(s.tick(null, 0, true).cancel).toBe(false);
  });

  test('頭出しで次の Cue がなくなった時は、予定済みのクリックを取り消す', () => {
    const s = new ClickScheduler();
    s.tick('a', 3.1, true);
    expect(s.tick(null, 0, true).cancel).toBe(true);
  });
});
