import { describe, expect, test } from 'vitest';
import { Generator } from './generator';

describe('Generator', () => {
  test('最初は停止していて位置は 0', () => {
    const g = new Generator('30');
    expect(g.running).toBe(false);
    expect(g.position(5000)).toBe(0);
  });

  test('再生すると 30fps で 1 秒に 30 フレーム進む', () => {
    const g = new Generator('30');
    g.play(1000);
    expect(g.running).toBe(true);
    expect(g.position(2000)).toBeCloseTo(30, 9);
  });

  test('29.97 DF は 1001ms で 30 フレーム進む', () => {
    const g = new Generator('29.97df');
    g.play(0);
    expect(g.position(1001)).toBeCloseTo(30, 9);
  });

  test('停止すると位置が止まる', () => {
    const g = new Generator('25');
    g.play(0);
    g.stop(2000);
    expect(g.running).toBe(false);
    expect(g.position(9000)).toBeCloseTo(50, 9);
  });

  test('停止後に再生すると止めた位置から続く', () => {
    const g = new Generator('25');
    g.play(0);
    g.stop(2000);
    g.play(10000);
    expect(g.position(11000)).toBeCloseTo(75, 9);
  });

  test('再生中に play を重ねて呼んでも位置は飛ばない', () => {
    const g = new Generator('30');
    g.play(0);
    g.play(500);
    expect(g.position(1000)).toBeCloseTo(30, 9);
  });

  test('停止中の locate は位置だけを変える', () => {
    const g = new Generator('30');
    g.locate(108000, 0);
    expect(g.running).toBe(false);
    expect(g.position(5000)).toBe(108000);
  });

  test('再生中の locate はその位置から再生を続ける', () => {
    const g = new Generator('30');
    g.play(0);
    g.locate(300, 1000);
    expect(g.running).toBe(true);
    expect(g.position(2000)).toBeCloseTo(330, 9);
  });
});
