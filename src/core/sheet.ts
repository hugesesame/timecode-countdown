import { resolveMidi } from './midi';
import type { Show } from './show';
import { formatOffset, formatTimecode } from './timecode';

/** 印刷する Cue シートの 1 行。画面の Cue List と同じ文字で表す */
export interface SheetRow {
  number: string;
  /** 入力した Trigger Time。未設定なら Manual */
  time: string;
  /** オフセットを足した、実際に実行される時刻。オフセットのないページでは null */
  at: string | null;
  name: string;
  info: string;
  stby: string;
  /** Ch / Note / Vel。MIDI を Off にした Cue は Off */
  midi: string;
  /** Cue 全体が Off */
  off: boolean;
}

export interface SheetPage {
  name: string;
  /** オフセットがなければ null */
  offset: string | null;
  /** このページだけタイムコードによる実行を止めている */
  tcOff: boolean;
  rows: SheetRow[];
}

export function cueSheet(show: Show): SheetPage[] {
  const rate = show.frameRate;
  return show.pages.map((page) => {
    const shifted = page.offsetFrames !== 0;
    return {
      name: page.name,
      offset: shifted ? formatOffset(page.offsetFrames, rate) : null,
      tcOff: page.tcIgnore,
      rows: page.cues.map((cue) => {
        const frame = cue.triggerFrame;
        const midi = resolveMidi(cue, page);
        return {
          number: cue.number,
          time: frame === null ? 'Manual' : formatTimecode(frame, rate),
          at: !shifted ? null : frame === null ? '' : formatTimecode(frame + page.offsetFrames, rate),
          name: cue.name,
          info: cue.info,
          stby: String(cue.standbySec ?? show.settings.standbySec),
          midi: cue.midiOn ? `${midi.channel} / ${midi.note} / ${midi.velocity}` : 'Off',
          off: !cue.enabled,
        };
      }),
    };
  });
}
