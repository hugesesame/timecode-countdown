import { describe, expect, test } from 'vitest';
import { GapMeter } from './gapmeter';

describe('GapMeter', () => {
  test('間隔がしきい値以内なら数えない', () => {
    const m = new GapMeter(100);
    m.mark(0);
    m.mark(50);
    m.mark(150);
    expect(m.count).toBe(0);
    expect(m.longestMs).toBe(0);
  });

  test('しきい値を超えた間隔を数え、最長を覚える', () => {
    const m = new GapMeter(100);
    m.mark(0);
    m.mark(180);
    m.mark(200);
    m.mark(500);
    expect(m.count).toBe(2);
    expect(m.longestMs).toBe(300);
  });

  test('最初の 1 回は間隔として数えない', () => {
    const m = new GapMeter(100);
    m.mark(5000);
    expect(m.count).toBe(0);
  });

  test('止まった後の再開は、途切れとして数えない', () => {
    const m = new GapMeter(100);
    m.mark(0);
    m.pause();
    m.mark(900);
    expect(m.count).toBe(0);
  });

  test('上限を超える長い間隔は、止まっていたと見なして数えない', () => {
    const m = new GapMeter(100, 5000);
    m.mark(0);
    m.mark(6000);
    expect(m.count).toBe(0);
  });

  test('reset で数え直す', () => {
    const m = new GapMeter(100);
    m.mark(0);
    m.mark(300);
    m.reset();
    expect(m.count).toBe(0);
    expect(m.longestMs).toBe(0);
    m.mark(1000);
    expect(m.count).toBe(0);
  });
});
