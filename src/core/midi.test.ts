import { describe, expect, test } from 'vitest';
import { noteOff, noteOn, resolveMidi, sendsNote } from './midi';

const page = { midi: { channel: 1, note: 60, velocity: 127 } };

describe('resolveMidi', () => {
  test('Cue に設定がなければページの初期値を使う', () => {
    expect(resolveMidi({ channel: null, note: null, velocity: null }, page)).toEqual({
      channel: 1,
      note: 60,
      velocity: 127,
    });
  });

  test('Cue に設定がある項目だけ上書きする', () => {
    expect(resolveMidi({ channel: 10, note: null, velocity: 64 }, page)).toEqual({
      channel: 10,
      note: 60,
      velocity: 64,
    });
  });

  test('Note 0 も設定として扱う', () => {
    expect(resolveMidi({ channel: null, note: 0, velocity: null }, page).note).toBe(0);
  });
});

describe('noteOn / noteOff', () => {
  test('Channel 1 の Note On は 0x90 で始まる', () => {
    expect(noteOn({ channel: 1, note: 60, velocity: 100 })).toEqual([0x90, 60, 100]);
  });

  test('Channel 16 の Note On は 0x9F で始まる', () => {
    expect(noteOn({ channel: 16, note: 36, velocity: 127 })).toEqual([0x9f, 36, 127]);
  });

  test('Note Off は 0x80 台で Velocity 0', () => {
    expect(noteOff({ channel: 2, note: 60, velocity: 100 })).toEqual([0x81, 60, 0]);
  });
});

describe('sendsNote', () => {
  test('MIDI が On の Cue は、タイムコードでも手動でも Note を送る', () => {
    expect(sendsNote({ midiOn: true }, false)).toBe(true);
    expect(sendsNote({ midiOn: true }, true)).toBe(true);
  });

  test('MIDI が Off の Cue は、タイムコードで実行された時は Note を送らない', () => {
    expect(sendsNote({ midiOn: false }, false)).toBe(false);
  });

  test('MIDI が Off の Cue でも、手動で実行した時は Note を送る', () => {
    expect(sendsNote({ midiOn: false }, true)).toBe(true);
  });
});
