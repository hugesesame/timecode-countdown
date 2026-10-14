import type { Cue, MidiTarget, Page } from './show';

/** Cue の設定と、未設定の項目を補うページの初期値から、実際に送る内容を決める */
export function resolveMidi(
  cue: Pick<Cue, 'channel' | 'note' | 'velocity'>,
  page: Pick<Page, 'midi'>,
): MidiTarget {
  return {
    channel: cue.channel ?? page.midi.channel,
    note: cue.note ?? page.midi.note,
    velocity: cue.velocity ?? page.midi.velocity,
  };
}

/** MIDI を Off にした Cue は、タイムコードで実行された時だけ Note を送らない */
export function sendsNote(cue: Pick<Cue, 'midiOn'>, manual: boolean): boolean {
  return manual || cue.midiOn;
}

export function noteOn(t: MidiTarget): number[] {
  return [0x90 | (t.channel - 1), t.note, t.velocity];
}

export function noteOff(t: MidiTarget): number[] {
  return [0x80 | (t.channel - 1), t.note, 0];
}
