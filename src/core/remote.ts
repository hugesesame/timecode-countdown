/** 外部の MIDI Note で内蔵ジェネレーターを操作するための割り当て */

export const REMOTE_ACTIONS = ['play', 'stop', 'rewind'] as const;
export type RemoteAction = (typeof REMOTE_ACTIONS)[number];

export interface NoteKey {
  /** 1 〜 16 */
  channel: number;
  /** 0 〜 127 */
  note: number;
}

export type RemoteMap = Record<RemoteAction, NoteKey | null>;

export const emptyRemote = (): RemoteMap => ({ play: null, stop: null, rewind: null });

const sameKey = (a: NoteKey | null, b: NoteKey): boolean => a?.channel === b.channel && a.note === b.note;

/** Note On なら、そのチャンネルとノートを返す。ベロシティ 0 は Note Off として扱う */
export function noteOnKey(data: ArrayLike<number>): NoteKey | null {
  const [status, note, velocity] = [data[0], data[1], data[2]];
  if (status === undefined || note === undefined || velocity === undefined) return null;
  if ((status & 0xf0) !== 0x90 || velocity === 0) return null;
  return { channel: (status & 0x0f) + 1, note };
}

export function remoteAction(map: RemoteMap, key: NoteKey): RemoteAction | null {
  return REMOTE_ACTIONS.find((action) => sameKey(map[action], key)) ?? null;
}

/** 1 つの Note は 1 つの操作にしか使えないので、他の操作に同じ Note があれば外す */
export function assignRemote(map: RemoteMap, action: RemoteAction, key: NoteKey | null): RemoteMap {
  const next = emptyRemote();
  for (const other of REMOTE_ACTIONS) {
    next[other] = key && sameKey(map[other], key) ? null : map[other];
  }
  next[action] = key;
  return next;
}

const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** 保存した割り当てを読む。読めない項目は割り当てなしにする */
export function parseRemote(v: unknown): RemoteMap {
  const map = emptyRemote();
  if (typeof v !== 'object' || v === null) return map;
  for (const action of REMOTE_ACTIONS) {
    const key = (v as Record<string, unknown>)[action];
    if (typeof key !== 'object' || key === null) continue;
    const { channel, note } = key as Record<string, unknown>;
    if (inRange(channel, 1, 16) && inRange(note, 0, 127)) map[action] = { channel, note };
  }
  return map;
}
