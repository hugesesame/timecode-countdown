import { describe, expect, test } from 'vitest';
import {
  createCue,
  createPage,
  createShow,
  isEmptyShow,
  moveItem,
  nextCueNumber,
  parseShow,
  parseShowIo,
  serializeShow,
  type Cue,
  type ShowIo,
} from './show';

const cue = (number: string): Cue => ({
  id: `id-${number}`,
  number,
  triggerFrame: null,
  name: '',
  info: '',
  enabled: true,
  midiOn: true,
  channel: null,
  note: null,
  velocity: null,
  standbySec: null,
});

describe('nextCueNumber', () => {
  test('空のリストでは 1', () => {
    expect(nextCueNumber([])).toBe('1');
  });

  test('一番大きい番号の次の整数を返す', () => {
    expect(nextCueNumber([cue('1'), cue('2')])).toBe('3');
    expect(nextCueNumber([cue('10'), cue('3')])).toBe('11');
  });

  test('小数の番号があれば切り捨てた次の整数を返す', () => {
    expect(nextCueNumber([cue('1'), cue('2.5')])).toBe('3');
  });

  test('数字でない番号は無視する', () => {
    expect(nextCueNumber([cue('A')])).toBe('1');
  });
});

describe('moveItem', () => {
  test('下へ移動する', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  test('上へ移動する', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  test('元の配列は書き換えない', () => {
    const list = ['a', 'b'];
    moveItem(list, 0, 1);
    expect(list).toEqual(['a', 'b']);
  });

  test('範囲外の指定では並びを変えない', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });
});

describe('serializeShow / parseShow', () => {
  test('書き出したショーをそのまま読み込める', () => {
    const show = createShow('p1');
    show.frameRate = '25';
    show.pages[0]?.cues.push({ ...cue('1'), triggerFrame: 250, name: 'Intro', info: 'memo' });
    expect(parseShow(serializeShow(show))).toEqual(show);
  });

  test('JSON でない文字列はエラー', () => {
    expect(() => parseShow('not json')).toThrow();
  });

  test('TC-CD のショーファイルでなければエラー', () => {
    expect(() => parseShow('{"foo":1}')).toThrow();
    expect(() => parseShow('[]')).toThrow();
  });

  test('知らないフレームレートはエラー', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.frameRate = '60';
    expect(() => parseShow(JSON.stringify(data))).toThrow();
  });

  test('ページが 1 つもなければエラー', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.pages = [];
    expect(() => parseShow(JSON.stringify(data))).toThrow();
  });

  test('設定が欠けていたら初期値で補う', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    delete data.settings;
    expect(parseShow(JSON.stringify(data)).settings).toEqual(createShow('p1').settings);
  });

  test('Cue の欠けた項目は初期値で補い、不正な Trigger Time は未設定にする', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.pages[0].cues = [{ id: 'c1', triggerFrame: 'abc' }];
    expect(parseShow(JSON.stringify(data)).pages[0]?.cues[0]).toEqual({
      id: 'c1',
      number: '',
      triggerFrame: null,
      name: '',
      info: '',
      enabled: true,
      midiOn: true,
      channel: null,
      note: null,
      velocity: null,
      standbySec: null,
    });
  });

  test('ページのオフセットとタイムコード無視が欠けていたら補う', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    delete data.pages[0].offsetFrames;
    delete data.pages[0].tcIgnore;
    expect(parseShow(JSON.stringify(data)).pages[0]).toMatchObject({ offsetFrames: 0, tcIgnore: false });
  });

  test('ページのオフセットは負の値も保持し、整数でなければ 0 にする', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.pages[0].offsetFrames = -300;
    expect(parseShow(JSON.stringify(data)).pages[0]?.offsetFrames).toBe(-300);
    data.pages[0].offsetFrames = 'x';
    expect(parseShow(JSON.stringify(data)).pages[0]?.offsetFrames).toBe(0);
  });

  test('Cue の色が変わり始める秒数は、正の数だけ保持する', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.pages[0].cues = [
      { id: 'a', standbySec: 30 },
      { id: 'b', standbySec: 0 },
      { id: 'c', standbySec: 'x' },
    ];
    expect(parseShow(JSON.stringify(data)).pages[0]?.cues.map((c) => c.standbySec)).toEqual([30, null, null]);
  });

  test('ページの MIDI 初期値が欠けていたら補う', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    delete data.pages[0].midi;
    expect(parseShow(JSON.stringify(data)).pages[0]?.midi).toEqual({ channel: 1, note: 60, velocity: 127 });
  });

  test('範囲外の MIDI の値は、Cue では未設定に、ページでは初期値にする', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.pages[0].midi = { channel: 17, note: 128, velocity: 0 };
    data.pages[0].cues = [{ id: 'c1', channel: 0, note: 60.5, velocity: 200 }];
    const page = parseShow(JSON.stringify(data)).pages[0];
    expect(page?.midi).toEqual({ channel: 1, note: 60, velocity: 127 });
    expect(page?.cues[0]).toMatchObject({ channel: null, note: null, velocity: null });
  });

  test('Cue の MIDI 設定を保持する', () => {
    const show = createShow('p1');
    show.pages[0]?.cues.push({ ...cue('1'), channel: 16, note: 0, velocity: 1 });
    expect(parseShow(serializeShow(show)).pages[0]?.cues[0]).toMatchObject({ channel: 16, note: 0, velocity: 1 });
  });
});

describe('ショーファイルの入出力設定', () => {
  const io: ShowIo = { source: 'mtc', midiIn: 'IAC Driver Bus 1', noteOut: 'Desk', mtcOut: null, ltcIn: null, ltcChannel: 1 };

  test('入出力設定を付けて書き出し、読み戻せる', () => {
    expect(parseShowIo(serializeShow(createShow('p1'), io))).toEqual(io);
  });

  test('入出力設定を付けても、ショーの中身は同じように読める', () => {
    const show = createShow('p1');
    expect(parseShow(serializeShow(show, io))).toEqual(show);
  });

  test('入出力設定のないファイルでは null', () => {
    expect(parseShowIo(serializeShow(createShow('p1')))).toBeNull();
  });

  test('JSON として読めない時は null', () => {
    expect(parseShowIo('not json')).toBeNull();
  });

  test('知らない入力元は Gen として扱い、文字列でないポート名は未選択にする', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.io = { source: 'smpte', midiIn: 5, noteOut: 'Desk' };
    expect(parseShowIo(JSON.stringify(data))).toEqual({
      source: 'int',
      midiIn: null,
      noteOut: 'Desk',
      mtcOut: null,
      ltcIn: null,
      ltcChannel: 1,
    });
  });

  test('LTC の入力元、音声入力の名前、チャンネルを読み書きできる', () => {
    const ltc: ShowIo = { source: 'ltc', midiIn: null, noteOut: null, mtcOut: null, ltcIn: 'Scarlett 2i2', ltcChannel: 2 };
    expect(parseShowIo(serializeShow(createShow('p1'), ltc))).toEqual(ltc);
  });

  test('おかしなチャンネル番号は 1 にする', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.io = { source: 'ltc', ltcChannel: 0 };
    expect(parseShowIo(JSON.stringify(data))?.ltcChannel).toBe(1);
    data.io.ltcChannel = 'two';
    expect(parseShowIo(JSON.stringify(data))?.ltcChannel).toBe(1);
  });
});

describe('isEmptyShow', () => {
  test('作ったばかりのショーは空', () => {
    expect(isEmptyShow(createShow('p1'))).toBe(true);
  });

  test('Cue が 1 つでもあれば空ではない', () => {
    const show = createShow('p1');
    show.pages[0]?.cues.push(cue('1'));
    expect(isEmptyShow(show)).toBe(false);
  });

  test('2 ページ目にだけ Cue がある場合も空ではない', () => {
    const show = createShow('p1');
    const page = createPage('p2', 'Page 2');
    page.cues.push(cue('1'));
    show.pages.push(page);
    expect(isEmptyShow(show)).toBe(false);
  });

  test('Cue のないページが増えただけなら空', () => {
    const show = createShow('p1');
    show.pages.push(createPage('p2', 'Page 2'));
    expect(isEmptyShow(show)).toBe(true);
  });
});

describe('Cue の MIDI の On / Off', () => {
  test('新しい Cue は MIDI が On', () => {
    expect(createCue('c1', '1').midiOn).toBe(true);
  });

  test('読み込みで Off を保ち、不正な値は On にする', () => {
    const data = JSON.parse(serializeShow(createShow('p1')));
    data.pages[0].cues = [
      { id: 'c1', midiOn: false },
      { id: 'c2', midiOn: 'no' },
    ];
    expect(parseShow(JSON.stringify(data)).pages[0]?.cues.map((c) => c.midiOn)).toEqual([false, true]);
  });
});
