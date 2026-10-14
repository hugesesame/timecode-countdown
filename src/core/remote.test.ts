import { describe, expect, test } from 'vitest';
import { assignRemote, emptyRemote, noteOnKey, parseRemote, remoteAction } from './remote';

describe('noteOnKey', () => {
  test('Note On からチャンネル（1 始まり）とノートを取り出す', () => {
    expect(noteOnKey([0x90, 60, 100])).toEqual({ channel: 1, note: 60 });
    expect(noteOnKey([0x9f, 0, 1])).toEqual({ channel: 16, note: 0 });
  });

  test('ベロシティ 0 の Note On は Note Off なので無視する', () => {
    expect(noteOnKey([0x90, 60, 0])).toBeNull();
  });

  test('Note On 以外のメッセージは無視する', () => {
    expect(noteOnKey([0x80, 60, 64])).toBeNull();
    expect(noteOnKey([0xb0, 60, 127])).toBeNull();
    expect(noteOnKey([0xf1, 0x23])).toBeNull();
    expect(noteOnKey([0x90, 60])).toBeNull();
  });
});

describe('remoteAction', () => {
  const map = { ...emptyRemote(), play: { channel: 1, note: 60 }, stop: { channel: 1, note: 61 } };

  test('割り当てた Note に対応する操作を返す', () => {
    expect(remoteAction(map, { channel: 1, note: 60 })).toBe('play');
    expect(remoteAction(map, { channel: 1, note: 61 })).toBe('stop');
  });

  test('ノートが同じでもチャンネルが違えば反応しない', () => {
    expect(remoteAction(map, { channel: 2, note: 60 })).toBeNull();
  });

  test('何も割り当てていなければ反応しない', () => {
    expect(remoteAction(emptyRemote(), { channel: 1, note: 60 })).toBeNull();
  });
});

describe('assignRemote', () => {
  test('操作に Note を割り当てる。元の設定は書き換えない', () => {
    const before = emptyRemote();
    const after = assignRemote(before, 'rewind', { channel: 3, note: 10 });
    expect(after.rewind).toEqual({ channel: 3, note: 10 });
    expect(before.rewind).toBeNull();
  });

  test('同じ Note を別の操作に割り当てたら、前の操作からは外す', () => {
    const first = assignRemote(emptyRemote(), 'play', { channel: 1, note: 60 });
    const second = assignRemote(first, 'stop', { channel: 1, note: 60 });
    expect(second).toEqual({ play: null, stop: { channel: 1, note: 60 }, rewind: null });
  });

  test('null を渡すと割り当てを外す', () => {
    const first = assignRemote(emptyRemote(), 'play', { channel: 1, note: 60 });
    expect(assignRemote(first, 'play', null).play).toBeNull();
  });
});

describe('parseRemote', () => {
  test('保存した設定をそのまま読める', () => {
    const map = { play: { channel: 1, note: 60 }, stop: { channel: 16, note: 127 }, rewind: null };
    expect(parseRemote(JSON.parse(JSON.stringify(map)))).toEqual(map);
  });

  test('設定がない時や壊れている時は、何も割り当てない', () => {
    expect(parseRemote(undefined)).toEqual(emptyRemote());
    expect(parseRemote('x')).toEqual(emptyRemote());
  });

  test('範囲外の値の項目だけ外す', () => {
    const map = { play: { channel: 0, note: 60 }, stop: { channel: 1, note: 128 }, rewind: { channel: 2, note: 5 } };
    expect(parseRemote(map)).toEqual({ play: null, stop: null, rewind: { channel: 2, note: 5 } });
  });
});
