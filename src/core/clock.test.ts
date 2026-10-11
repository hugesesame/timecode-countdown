import { describe, expect, test } from 'vitest';
import { ExternalClock } from './clock';

describe('ExternalClock', () => {
  test('信号が来るまでは位置 0 で止まっている', () => {
    const c = new ExternalClock('30');
    expect(c.position(1000)).toBe(0);
    expect(c.isRunning(1000)).toBe(false);
  });

  test('受信した位置から内部時計で進む', () => {
    const c = new ExternalClock('30');
    c.update(100, 0);
    expect(c.position(100)).toBeCloseTo(103, 9);
    expect(c.isRunning(100)).toBe(true);
  });

  test('信号が切れたら自走の上限で止まる', () => {
    const c = new ExternalClock('30', 200);
    c.update(100, 0);
    expect(c.position(200)).toBeCloseTo(106, 9);
    expect(c.position(5000)).toBeCloseTo(106, 9);
    expect(c.isRunning(5000)).toBe(false);
  });

  test('頭出しはその位置で止まる', () => {
    const c = new ExternalClock('30');
    c.update(100, 0);
    c.locate(500);
    expect(c.position(50)).toBe(500);
    expect(c.isRunning(50)).toBe(false);
  });

  test('受信の揺れで少し手前の位置が来ても、位置は戻らない', () => {
    const c = new ExternalClock('30');
    c.update(100, 0);
    expect(c.position(100)).toBeCloseTo(103, 9);
    c.update(102.5, 100);
    expect(c.position(100)).toBeCloseTo(103, 9);
    expect(c.position(200)).toBeCloseTo(105.5, 9);
  });

  test('大きく戻った時はその位置に従う', () => {
    const c = new ExternalClock('30');
    c.update(100, 0);
    c.position(100);
    c.update(10, 100);
    expect(c.position(100)).toBe(10);
  });

  test('頭出しで少し手前に戻った時もその位置に従う', () => {
    const c = new ExternalClock('30');
    c.update(100, 0);
    c.position(100);
    c.locate(102);
    expect(c.position(100)).toBe(102);
  });
});
