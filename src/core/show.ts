import { FRAME_RATES, type FrameRate } from './timecode';

export interface Cue {
  id: string;
  number: string;
  /** フレーム数。未設定なら null（マニュアル実行のみ） */
  triggerFrame: number | null;
  name: string;
  info: string;
  enabled: boolean;
  /** false なら、この Cue では MIDI Note を送らない */
  midiOn: boolean;
  /** MIDI の設定。null ならページの初期値を使う */
  channel: number | null;
  note: number | null;
  velocity: number | null;
  /** カウントダウンの色が変わり始める秒数。null なら全体の設定を使う */
  standbySec: number | null;
}

export interface MidiTarget {
  /** 1 - 16 */
  channel: number;
  /** 0 - 127 */
  note: number;
  /** 1 - 127 */
  velocity: number;
}

export interface Page {
  id: string;
  name: string;
  /** このページの Cue が使う MIDI の初期値 */
  midi: MidiTarget;
  /** Cue の Trigger Time に足すフレーム数（曲の頭のタイムコードなど） */
  offsetFrames: number;
  /** このページだけタイムコードによる実行を止める */
  tcIgnore: boolean;
  cues: Cue[];
}

export const DEFAULT_MIDI: Readonly<MidiTarget> = { channel: 1, note: 60, velocity: 127 };

/** MIDI の各項目に入れられる値の範囲 */
export const MIDI_RANGE: Readonly<Record<keyof MidiTarget, readonly [number, number]>> = {
  channel: [1, 16],
  note: [0, 127],
  velocity: [1, 127],
};

export function createPage(id: string, name: string): Page {
  return { id, name, midi: { ...DEFAULT_MIDI }, offsetFrames: 0, tcIgnore: false, cues: [] };
}

export function createCue(id: string, number: string): Cue {
  return {
    id,
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
  };
}

export interface Settings {
  /** レーンが流れ始め、色が変わり始める秒数 */
  standbySec: number;
  warnSec: number;
  finalSec: number;
  /** 先に飛んだ時、飛び越えた Cue も実行するか */
  fireSkipped: boolean;
  autoScroll: boolean;
  /** Note On から Note Off までの長さ */
  noteLengthMs: number;
}

export interface Show {
  app: 'tc-cd';
  version: 1;
  frameRate: FrameRate;
  pages: Page[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  standbySec: 10,
  warnSec: 5,
  finalSec: 3,
  fireSkipped: false,
  autoScroll: true,
  noteLengthMs: 100,
};

export function createShow(pageId: string): Show {
  return {
    app: 'tc-cd',
    version: 1,
    frameRate: '30',
    pages: [createPage(pageId, 'Page 1')],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Cue が 1 つもないショーか（失っても困らない状態か） */
export function isEmptyShow(show: Show): boolean {
  return show.pages.every((page) => page.cues.length === 0);
}

export function nextCueNumber(cues: readonly Cue[]): string {
  let max = 0;
  for (const c of cues) {
    const n = Number(c.number);
    if (c.number.trim() !== '' && Number.isFinite(n)) max = Math.max(max, Math.floor(n));
  }
  return String(max + 1);
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return result;
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item as T);
  return result;
}

/**
 * ショーファイルに一緒に書き出す入出力の設定。
 * ポートの id はブラウザや開き方ごとに変わるので、名前で持つ。
 */
export interface ShowIo {
  source: 'int' | 'mtc' | 'ltc';
  midiIn: string | null;
  noteOut: string | null;
  mtcOut: string | null;
  /** LTC を受ける音声入力の名前 */
  ltcIn: string | null;
  /** LTC が入っているチャンネル（1 から数える） */
  ltcChannel: number;
}

export function serializeShow(show: Show, io?: ShowIo): string {
  return JSON.stringify(io ? { ...show, io } : show, null, 2);
}

/** ショーファイルに入出力の設定が入っていれば取り出す。なければ null。 */
export function parseShowIo(json: string): ShowIo | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObject(data) || !isObject(data.io)) return null;
  const io = data.io;
  const name = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return {
    source: io.source === 'mtc' || io.source === 'ltc' ? io.source : 'int',
    midiIn: name(io.midiIn),
    noteOut: name(io.noteOut),
    mtcOut: name(io.mtcOut),
    ltcIn: name(io.ltcIn),
    ltcChannel: typeof io.ltcChannel === 'number' && Number.isInteger(io.ltcChannel) && io.ltcChannel >= 1 ? io.ltcChannel : 1,
  };
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** 範囲内の整数ならその値、そうでなければ null */
function midiValue(v: unknown, key: keyof MidiTarget): number | null {
  const [min, max] = MIDI_RANGE[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function parseCue(v: unknown, index: number): Cue {
  if (!isObject(v)) throw new Error('Cue data is corrupted');
  const frame = v.triggerFrame;
  return {
    id: str(v.id) || `cue-${index}-${Math.random().toString(36).slice(2)}`,
    number: str(v.number),
    triggerFrame: typeof frame === 'number' && Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : null,
    name: str(v.name),
    info: str(v.info),
    enabled: bool(v.enabled, true),
    midiOn: bool(v.midiOn, true),
    channel: midiValue(v.channel, 'channel'),
    note: midiValue(v.note, 'note'),
    velocity: midiValue(v.velocity, 'velocity'),
    standbySec: typeof v.standbySec === 'number' && Number.isFinite(v.standbySec) && v.standbySec > 0 ? v.standbySec : null,
  };
}

function parsePage(v: unknown, index: number): Page {
  if (!isObject(v) || !Array.isArray(v.cues)) throw new Error('Page data is corrupted');
  const midi = isObject(v.midi) ? v.midi : {};
  return {
    id: str(v.id) || `page-${index}-${Math.random().toString(36).slice(2)}`,
    name: str(v.name, `Page ${index + 1}`),
    midi: {
      channel: midiValue(midi.channel, 'channel') ?? DEFAULT_MIDI.channel,
      note: midiValue(midi.note, 'note') ?? DEFAULT_MIDI.note,
      velocity: midiValue(midi.velocity, 'velocity') ?? DEFAULT_MIDI.velocity,
    },
    offsetFrames: typeof v.offsetFrames === 'number' && Number.isInteger(v.offsetFrames) ? v.offsetFrames : 0,
    tcIgnore: bool(v.tcIgnore, false),
    cues: v.cues.map(parseCue),
  };
}

/** JSON 文字列をショーとして読み込む。読めなければ理由付きの Error を投げる。 */
export function parseShow(json: string): Show {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON');
  }
  if (!isObject(data) || data.app !== 'tc-cd' || !Array.isArray(data.pages)) {
    throw new Error('Not a TC-CD show file');
  }
  if (!FRAME_RATES.includes(data.frameRate as FrameRate)) {
    throw new Error('Unsupported frame rate');
  }
  if (data.pages.length === 0) throw new Error('The show has no pages');

  const s = isObject(data.settings) ? data.settings : {};
  return {
    app: 'tc-cd',
    version: 1,
    frameRate: data.frameRate as FrameRate,
    pages: data.pages.map(parsePage),
    settings: {
      standbySec: num(s.standbySec, DEFAULT_SETTINGS.standbySec),
      warnSec: num(s.warnSec, DEFAULT_SETTINGS.warnSec),
      finalSec: num(s.finalSec, DEFAULT_SETTINGS.finalSec),
      fireSkipped: bool(s.fireSkipped, DEFAULT_SETTINGS.fireSkipped),
      autoScroll: bool(s.autoScroll, DEFAULT_SETTINGS.autoScroll),
      noteLengthMs: num(s.noteLengthMs, DEFAULT_SETTINGS.noteLengthMs),
    },
  };
}
