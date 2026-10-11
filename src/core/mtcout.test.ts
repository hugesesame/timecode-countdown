import { describe, expect, test } from 'vitest';
import { MtcDecoder, type MtcEvent } from './mtc';
import { MtcOutScheduler, type TimedMessage } from './mtcout';

const isFullFrame = (m: TimedMessage): boolean => m.data[0] === 0xf0;
const isQuarter = (m: TimedMessage): boolean => m.data[0] === 0xf1;
const piece = (m: TimedMessage): number => ((m.data[1] as number) >> 4) & 0x7;

/** 送ったメッセージを受信側のデコーダーに通す */
function decode(messages: TimedMessage[]): { at: number; event: MtcEvent }[] {
  const decoder = new MtcDecoder();
  const out: { at: number; event: MtcEvent }[] = [];
  for (const m of messages) {
    const event = decoder.feed(m.data);
    if (event) out.push({ at: m.at, event });
  }
  return out;
}

describe('MtcOutScheduler: 停止中', () => {
  test('最初に現在位置をフルフレームで送る', () => {
    const s = new MtcOutScheduler('30');
    const out = s.tick(0, 108000, false);
    expect(out).toHaveLength(1);
    expect(decode(out)[0]?.event).toEqual({ kind: 'locate', frames: 108000, rate: '30' });
  });

  test('位置が変わらなければ何も送らない', () => {
    const s = new MtcOutScheduler('30');
    s.tick(0, 300, false);
    expect(s.tick(20, 300, false)).toEqual([]);
  });

  test('頭出しされたら新しい位置をフルフレームで送る', () => {
    const s = new MtcOutScheduler('30');
    s.tick(0, 300, false);
    const out = s.tick(20, 900, false);
    expect(decode(out)[0]?.event).toEqual({ kind: 'locate', frames: 900, rate: '30' });
  });
});

describe('MtcOutScheduler: 再生中', () => {
  test('先読みの範囲までクォーターフレームを送る', () => {
    const s = new MtcOutScheduler('30', 100);
    const quarters = s.tick(0, 0, true).filter(isQuarter);
    // 30fps では 100ms が 3 フレーム = クォーターフレーム 12 個分（0 個目を含めて 13 個）
    expect(quarters).toHaveLength(13);
    expect(quarters.every((m) => m.at >= 0 && m.at <= 100)).toBe(true);
  });

  test('クォーターフレームは 4 分の 1 フレームごとの時刻で送る', () => {
    const s = new MtcOutScheduler('30', 100);
    const quarters = s.tick(1000, 0, true).filter(isQuarter);
    const step = 1000 / 30 / 4;
    quarters.forEach((m, i) => expect(m.at).toBeCloseTo(1000 + i * step, 6));
  });

  test('ピース 0 から始め、順番に送る', () => {
    const s = new MtcOutScheduler('30', 200);
    const quarters = s.tick(0, 0.3, true).filter(isQuarter);
    expect(piece(quarters[0] as TimedMessage)).toBe(0);
    expect(quarters.slice(0, 9).map(piece)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
  });

  test('位置がフレームの途中なら、次の区切りの時刻から送り始める', () => {
    const s = new MtcOutScheduler('30', 200);
    const first = s.tick(0, 0.5, true).filter(isQuarter)[0] as TimedMessage;
    // 次のピース 0 は 2 フレーム目。そこまで 1.5 フレーム = 50ms
    expect(first.at).toBeCloseTo(50, 6);
  });

  test('続けて呼んでも、抜けや重複なく続きを送る', () => {
    const s = new MtcOutScheduler('30', 100);
    const all = [...s.tick(0, 0, true), ...s.tick(20, 0.6, true), ...s.tick(40, 1.2, true)].filter(isQuarter);
    const step = 1000 / 30 / 4;
    all.forEach((m, i) => {
      expect(piece(m)).toBe(i % 8);
      expect(m.at).toBeCloseTo(i * step, 6);
    });
  });

  test.each(['24', '25', '29.97df', '30'] as const)('%s: 受信側で読むと、送った時刻の位置と一致する', (rate) => {
    const s = new MtcOutScheduler(rate, 400);
    const start = 107890;
    const fps = rate === '29.97df' ? 30000 / 1001 : Number(rate);
    const decoded = decode(s.tick(0, start, true));
    expect(decoded.length).toBeGreaterThan(8);
    for (const d of decoded.filter((x) => x.event.kind === 'running')) {
      expect(d.event.rate).toBe(rate);
      expect(d.event.frames).toBeCloseTo(start + (d.at / 1000) * fps, 6);
    }
  });

  test('再生中に頭出しされたら、フルフレームを送ってピース 0 からやり直す', () => {
    const s = new MtcOutScheduler('30', 100);
    s.tick(0, 0, true);
    const out = s.tick(20, 9000.6, true);
    expect(isFullFrame(out[0] as TimedMessage)).toBe(true);
    expect(piece(out.filter(isQuarter)[0] as TimedMessage)).toBe(0);
    const running = decode(out).filter((d) => d.event.kind === 'running');
    expect(running.length).toBe(0); // 先読み 100ms では 8 個そろわない
    expect(out.filter(isQuarter).every((m) => m.at >= 20)).toBe(true);
  });
});

describe('MtcOutScheduler: 呼び出しが遅れた時', () => {
  test('頭出しとは見なさず、フルフレームを送らない', () => {
    const s = new MtcOutScheduler('30', 100);
    s.tick(0, 0, true);
    // 300ms 遅れて呼ばれた。位置は時間どおり 9 フレーム進んでいる
    const out = s.tick(300, 9, true);
    expect(out.some(isFullFrame)).toBe(false);
  });

  test('送りそびれた分は飛ばし、今の位置以降のピース 0 から送り直す', () => {
    const s = new MtcOutScheduler('30', 100);
    s.tick(0, 0, true);
    const quarters = s.tick(300, 9, true).filter(isQuarter);
    expect(piece(quarters[0] as TimedMessage)).toBe(0);
    expect(quarters.every((m) => m.at >= 300)).toBe(true);
    // 9 フレーム目より後で最初の偶数フレームは 10。そこまで 1 フレーム = 33.3ms
    expect((quarters[0] as TimedMessage).at).toBeCloseTo(300 + 1000 / 30, 6);
  });

  test('送りそびれて送り直した回数を数える', () => {
    const s = new MtcOutScheduler('30', 100);
    s.tick(0, 0, true);
    expect(s.restarts).toBe(0);
    s.tick(300, 9, true);
    expect(s.restarts).toBe(1);
  });

  test('再生開始や頭出しは、送り直しとして数えない', () => {
    const s = new MtcOutScheduler('30', 100);
    s.tick(0, 0, true);
    s.tick(20, 9000.6, true);
    s.tick(40, 9001.2, false);
    s.tick(500, 9001.2, true);
    expect(s.restarts).toBe(0);
  });

  test('少しの遅れなら、抜けなく続きを送る', () => {
    const s = new MtcOutScheduler('30', 100);
    const first = s.tick(0, 0, true).filter(isQuarter);
    const next = s.tick(80, 2.4, true).filter(isQuarter);
    expect(piece(next[0] as TimedMessage)).toBe((piece(first.at(-1) as TimedMessage) + 1) % 8);
  });
});

describe('MtcOutScheduler: 再生から停止', () => {
  test('止まった位置を、送信済みのクォーターフレームより後の時刻でフルフレーム送信する', () => {
    const s = new MtcOutScheduler('30', 100);
    const sent = s.tick(0, 0, true);
    const lastAt = Math.max(...sent.map((m) => m.at));
    const out = s.tick(20, 0.6, false);
    expect(out).toHaveLength(1);
    expect(decode(out)[0]?.event).toEqual({ kind: 'locate', frames: 0, rate: '30' });
    expect((out[0] as TimedMessage).at).toBeGreaterThan(lastAt);
  });

  test('止まった後に再生すると、またピース 0 から送る', () => {
    const s = new MtcOutScheduler('30', 100);
    s.tick(0, 0, true);
    s.tick(20, 0.6, false);
    const quarters = s.tick(500, 0.6, true).filter(isQuarter);
    expect(piece(quarters[0] as TimedMessage)).toBe(0);
    expect(quarters.every((m) => m.at >= 500)).toBe(true);
  });
});
