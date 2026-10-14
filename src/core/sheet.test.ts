import { describe, expect, test } from 'vitest';
import { cueSheet } from './sheet';
import { createCue, createPage, createShow, type Show } from './show';

function show(): Show {
  const s = createShow('p1');
  const page = s.pages[0]!;
  page.name = 'Opening';
  const a = createCue('a', '1');
  a.triggerFrame = 300;
  a.name = 'Flash';
  a.info = 'SL';
  const b = createCue('b', '2');
  b.name = 'Manual only';
  b.standbySec = 20;
  b.note = 64;
  page.cues = [a, b];
  return s;
}

describe('cueSheet', () => {
  test('Cue の番号、時刻、名前、Info を表示どおりの文字で並べる', () => {
    const [page] = cueSheet(show());
    expect(page?.name).toBe('Opening');
    expect(page?.rows.map((r) => [r.number, r.time, r.name, r.info])).toEqual([
      ['1', '00:00:10:00', 'Flash', 'SL'],
      ['2', 'Manual', 'Manual only', ''],
    ]);
  });

  test('Stby と MIDI は、未設定ならページや全体の初期値で埋める', () => {
    const [page] = cueSheet(show());
    expect(page?.rows.map((r) => [r.stby, r.midi])).toEqual([
      ['10', '1 / 60 / 127'],
      ['20', '1 / 64 / 127'],
    ]);
  });

  test('MIDI を Off にした Cue は Off、Cue 全体を Off にした Cue は印を付ける', () => {
    const s = show();
    s.pages[0]!.cues[0]!.midiOn = false;
    s.pages[0]!.cues[1]!.enabled = false;
    const [page] = cueSheet(s);
    expect(page?.rows.map((r) => [r.midi, r.off])).toEqual([
      ['Off', false],
      ['1 / 64 / 127', true],
    ]);
  });

  test('オフセットがなければ、実行される時刻の列は出さない', () => {
    const [page] = cueSheet(show());
    expect(page?.offset).toBeNull();
    expect(page?.rows[0]?.at).toBeNull();
  });

  test('オフセットがあれば、それを足した実行時刻も出す', () => {
    const s = show();
    s.pages[0]!.offsetFrames = 30 * 60 * 5;
    const [page] = cueSheet(s);
    expect(page?.offset).toBe('+00:05:00:00');
    expect(page?.rows.map((r) => r.at)).toEqual(['00:05:10:00', '']);
  });

  test('すべてのページを順に出し、タイムコードを止めたページには印を付ける', () => {
    const s = show();
    const second = createPage('p2', 'Encore');
    second.tcIgnore = true;
    s.pages.push(second);
    expect(cueSheet(s).map((p) => [p.name, p.tcOff, p.rows.length])).toEqual([
      ['Opening', false, 2],
      ['Encore', true, 0],
    ]);
  });
});
