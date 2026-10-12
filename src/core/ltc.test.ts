import { describe, expect, test } from 'vitest';
import { LtcDecoder, type LtcEvent } from './ltc';
import { nominalFps, timecodeToFrames, framesToParts, type FrameRate } from './timecode';

/** 1 フレーム分の LTC の 80 ビットを作る */
function ltcBits(frames: number, rate: FrameRate): number[] {
  const [hh, mm, ss, ff] = framesToParts(frames, rate);
  const bits = new Array<number>(80).fill(0);
  const put = (start: number, length: number, value: number): void => {
    for (let i = 0; i < length; i++) bits[start + i] = (value >> i) & 1;
  };
  put(0, 4, ff % 10);
  put(8, 2, Math.floor(ff / 10));
  bits[10] = rate === '29.97df' ? 1 : 0;
  put(16, 4, ss % 10);
  put(24, 3, Math.floor(ss / 10));
  put(32, 4, mm % 10);
  put(40, 3, Math.floor(mm / 10));
  put(48, 4, hh % 10);
  put(56, 2, Math.floor(hh / 10));
  [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1].forEach((b, i) => (bits[64 + i] = b));
  return bits;
}

interface Options {
  sampleRate?: number;
  /** 実際の 1 秒あたりのフレーム数。省略時はレートどおり */
  fps?: number;
  amplitude?: number;
  /** 最初のフレームの前に入れる無音のサンプル数 */
  lead?: number;
}

/** start から count フレーム分の LTC の音声を作る */
function ltcAudio(start: number, count: number, rate: FrameRate, options: Options = {}): Float32Array {
  const { sampleRate = 48000, amplitude = 0.5, lead = 0 } = options;
  const fps = options.fps ?? (rate === '29.97df' ? 30000 / 1001 : nominalFps(rate));
  const perBit = sampleRate / fps / 80;
  // 最後のフレームの終わりが分かるよう、次のビットの頭を少しだけ足す
  const tail = 8;
  const out = new Float32Array(lead + Math.ceil(count * 80 * perBit) + tail);
  let level = 1;
  let n = lead;
  for (let f = 0; f < count; f++) {
    const bits = ltcBits(start + f, rate);
    for (let b = 0; b < 80; b++) {
      const bitStart = lead + (f * 80 + b) * perBit;
      const mid = bitStart + perBit / 2;
      const end = bitStart + perBit;
      level = -level;
      for (; n < end && n < out.length; n++) out[n] = amplitude * (bits[b] === 1 && n >= mid ? -level : level);
      if (bits[b] === 1) level = -level;
    }
  }
  for (; n < out.length; n++) out[n] = amplitude * -level;
  return out;
}

function decode(audio: Float32Array, sampleRate = 48000, chunk = audio.length): LtcEvent[] {
  const decoder = new LtcDecoder(sampleRate);
  const events: LtcEvent[] = [];
  for (let i = 0; i < audio.length; i += chunk) events.push(...decoder.feed(audio.subarray(i, i + chunk)));
  return events;
}

const at = (hh: number, mm: number, ss: number, ff: number, rate: FrameRate): number =>
  timecodeToFrames(hh, mm, ss, ff, rate) as number;

describe('LtcDecoder', () => {
  test('30 fps の LTC を読み、各フレームの終わりで次のフレーム位置を返す', () => {
    const start = at(1, 0, 0, 0, '30');
    const events = decode(ltcAudio(start, 6, '30'));
    // 最初のフレームは長さが分からないので、2 フレーム目から返す
    expect(events.map((e) => e.frames)).toEqual([start + 2, start + 3, start + 4, start + 5, start + 6]);
    expect(events.every((e) => e.rate === '30')).toBe(true);
  });

  test('フレームの終わりのサンプル位置を返す', () => {
    const events = decode(ltcAudio(at(1, 0, 0, 0, '30'), 4, '30', { lead: 100 }));
    expect(events.map((e) => e.endSample)).toEqual([
      expect.closeTo(100 + 3200, -0.5),
      expect.closeTo(100 + 4800, -0.5),
      expect.closeTo(100 + 6400, -0.5),
    ]);
  });

  test.each(['24', '25', '30'] as const)('%s fps を見分ける', (rate) => {
    const start = at(0, 10, 5, 3, rate);
    const events = decode(ltcAudio(start, 4, rate));
    expect(events.at(-1)).toMatchObject({ frames: start + 4, rate });
  });

  test('ドロップフレームのフラグが立っていれば 29.97 DF として読む', () => {
    const start = at(0, 1, 0, 2, '29.97df');
    const events = decode(ltcAudio(start, 4, '29.97df'));
    expect(events.at(-1)).toMatchObject({ frames: start + 4, rate: '29.97df' });
  });

  test('44.1 kHz でも読める', () => {
    const start = at(0, 0, 59, 20, '25');
    const events = decode(ltcAudio(start, 5, '25', { sampleRate: 44100 }), 44100);
    expect(events.map((e) => e.frames)).toEqual([start + 2, start + 3, start + 4, start + 5]);
  });

  test('細かく分けて渡しても結果は変わらない', () => {
    const audio = ltcAudio(at(2, 30, 0, 0, '30'), 6, '30', { lead: 37 });
    expect(decode(audio, 48000, 128)).toEqual(decode(audio));
  });

  test('極性が逆でも読める', () => {
    const start = at(0, 0, 10, 0, '30');
    const audio = ltcAudio(start, 4, '30').map((v) => -v);
    expect(decode(audio).at(-1)?.frames).toBe(start + 4);
  });

  test('小さなレベルでも読める', () => {
    const start = at(0, 0, 10, 0, '30');
    expect(decode(ltcAudio(start, 4, '30', { amplitude: 0.02 })).at(-1)?.frames).toBe(start + 4);
  });

  test('直流のずれと、なまった波形でも読める', () => {
    const start = at(0, 0, 10, 0, '30');
    const audio = ltcAudio(start, 6, '30');
    let y = 0;
    const soft = audio.map((v) => (y += (v - y) * 0.35) + 0.2);
    expect(decode(soft).at(-1)?.frames).toBe(start + 6);
  });

  test('ノイズが乗っていても読める', () => {
    const start = at(0, 0, 10, 0, '30');
    let seed = 1;
    const noise = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1;
    const audio = ltcAudio(start, 6, '30').map((v) => v + noise());
    expect(decode(audio).map((e) => e.frames)).toEqual([start + 2, start + 3, start + 4, start + 5, start + 6]);
  });

  test('少し速い・遅い再生でも読める', () => {
    const start = at(0, 0, 10, 0, '30');
    expect(decode(ltcAudio(start, 6, '30', { fps: 31 })).at(-1)?.frames).toBe(start + 6);
    expect(decode(ltcAudio(start, 6, '30', { fps: 29 })).at(-1)?.frames).toBe(start + 6);
  });

  test('無音やノイズだけでは何も返さない', () => {
    expect(decode(new Float32Array(48000))).toEqual([]);
    let seed = 7;
    const noise = Float32Array.from({ length: 48000 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4);
    expect(decode(noise)).toEqual([]);
  });

  test('時刻が飛んでも、飛んだ先の位置を返す', () => {
    const a = at(0, 0, 10, 0, '30');
    const b = at(0, 5, 0, 0, '30');
    const first = ltcAudio(a, 4, '30');
    const second = ltcAudio(b, 4, '30');
    const audio = new Float32Array(first.length + second.length);
    audio.set(first);
    audio.set(second, first.length);
    const frames = decode(audio).map((e) => e.frames);
    expect(frames.slice(0, 3)).toEqual([a + 2, a + 3, a + 4]);
    expect(frames.at(-1)).toBe(b + 4);
  });

  test('途切れた後は、また 2 フレーム目から返す', () => {
    const start = at(0, 0, 10, 0, '30');
    const first = ltcAudio(start, 3, '30');
    const second = ltcAudio(start + 100, 3, '30');
    const audio = new Float32Array(first.length + 24000 + second.length);
    audio.set(first);
    audio.set(second, first.length + 24000);
    expect(decode(audio).map((e) => e.frames)).toEqual([start + 2, start + 3, start + 102, start + 103]);
  });

  test('入力のレベル（ピーク）が分かる', () => {
    const decoder = new LtcDecoder(48000);
    decoder.feed(ltcAudio(0, 2, '30', { amplitude: 0.25 }));
    expect(decoder.level).toBeCloseTo(0.25, 1);
  });
});
