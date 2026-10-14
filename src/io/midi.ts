import { feedMtc, onFire, remoteControl, setIo, state } from '../app';
import { arrivalTime } from '../core/clock';
import { GapMeter } from '../core/gapmeter';
import { noteOff, noteOn, resolveMidi, sendsNote } from '../core/midi';
import { MtcDecoder } from '../core/mtc';
import { MtcOutScheduler } from '../core/mtcout';
import { assignRemote, noteOnKey, remoteAction, type RemoteAction } from '../core/remote';
import type { ShowIo } from '../core/show';
import { applyLtcShowIo, ltcInputName } from './ltc';

/** unsupported: ブラウザが非対応 / idle: 未接続 / ready: 使用可 / denied: 許可されなかった */
export type MidiStatus = 'unsupported' | 'idle' | 'ready' | 'denied';

export interface PortInfo {
  id: string;
  name: string;
}

let access: MIDIAccess | null = null;
let status: MidiStatus = typeof navigator.requestMIDIAccess === 'function' ? 'idle' : 'unsupported';
let boundInput: MIDIInput | null = null;
const decoder = new MtcDecoder();
/** MTC の受信が途切れた回数（クォーターフレームは通常 10ms 以内の間隔で届く） */
const rxGaps = new GapMeter(100);
/** MTC の送信処理が遅れた回数（通常は 20ms ごとに呼ばれる） */
const txGaps = new GapMeter(60);
let txRestartsBefore = 0;
const listeners: (() => void)[] = [];

const notify = (): void => listeners.forEach((fn) => fn());

/** 接続状態やポートの一覧が変わった時 */
export const onMidiChange = (fn: () => void): void => void listeners.push(fn);
export const midiStatus = (): MidiStatus => status;

const list = (ports: Iterable<MIDIPort> | undefined): PortInfo[] =>
  [...(ports ?? [])].map((p) => ({ id: p.id, name: p.name ?? p.id }));

export const midiInputs = (): PortInfo[] => list(access?.inputs.values());
export const midiOutputs = (): PortInfo[] => list(access?.outputs.values());

/** 選択中の入力ポートから MTC を受け取るようにつなぎ直す */
/** 次に届いた Note を割り当てる操作。待っていなければ null */
let learning: RemoteAction | null = null;

export const remoteLearning = (): RemoteAction | null => learning;

/** 次に届く Note を、その操作に割り当てる。null で待つのをやめる */
export function learnRemote(action: RemoteAction | null): void {
  learning = action;
  notify();
}

export function clearRemote(action: RemoteAction): void {
  setIo({ genRemote: assignRemote(state.io.genRemote, action, null) });
  notify();
}

function handleNote(data: Uint8Array): void {
  const key = noteOnKey(data);
  if (!key) return;
  if (learning) {
    setIo({ genRemote: assignRemote(state.io.genRemote, learning, key) });
    learning = null;
    notify();
    return;
  }
  const action = remoteAction(state.io.genRemote, key);
  if (action) remoteControl(action);
}

function bindInput(): void {
  const next = access?.inputs.get(state.io.midiInId ?? '') ?? null;
  if (next === boundInput) return;
  if (boundInput) boundInput.onmidimessage = null;
  boundInput = next;
  if (!next) return;
  next.onmidimessage = (e) => {
    if (!e.data) return;
    if (e.data[0] === 0xf1) rxSeen.quarter += 1;
    else if (e.data[0] === 0xf0) rxSeen.full += 1;
    const now = performance.now();
    rxSeen.stampLagMs = now - e.timeStamp;
    // 送り元によっては、付いてくる時刻が今の時刻と大きくずれている
    const at = arrivalTime(e.timeStamp, now);
    // 頭出し（フルフレーム）の後は、止まっていても途切れとは数えない
    if (e.data[0] === 0xf1) rxGaps.mark(at);
    else if (e.data[0] === 0xf0) rxGaps.pause();
    const event = decoder.feed(e.data);
    if (event) feedMtc(event, at);
    else handleNote(e.data);
  };
}

/** ブラウザに MIDI の使用許可を求める。フルフレームの MTC を読むために SysEx も求める。 */
export async function enableMidi(): Promise<void> {
  if (status === 'unsupported' || status === 'ready') return;
  try {
    access = await navigator.requestMIDIAccess({ sysex: true });
  } catch {
    try {
      access = await navigator.requestMIDIAccess();
    } catch {
      status = 'denied';
      notify();
      return;
    }
  }
  status = 'ready';
  startMtcOut();
  access.onstatechange = () => {
    bindInput();
    notify();
  };
  bindInput();
  notify();
}

export function selectInput(id: string | null): void {
  setIo({ midiInId: id });
  bindInput();
  notify();
}

export function selectOutput(id: string | null): void {
  setIo({ midiOutId: id });
  notify();
}

export function selectMtcOutput(id: string | null): void {
  setIo({ mtcOutId: id });
  notify();
}

let mtcOut: MtcOutScheduler | null = null;

/** 入力元が内蔵ジェネレーターの時だけ、その位置を MTC として送る */
function mtcOutTick(): void {
  const output = access?.outputs.get(state.io.mtcOutId ?? '');
  if (!output || state.io.source !== 'int') {
    txRestartsBefore += mtcOut?.restarts ?? 0;
    mtcOut = null;
    txGaps.pause();
    return;
  }
  if (!mtcOut || mtcOut.rate !== state.show.frameRate) {
    txRestartsBefore += mtcOut?.restarts ?? 0;
    mtcOut = new MtcOutScheduler(state.show.frameRate);
  }
  const now = performance.now();
  if (state.gen.running) txGaps.mark(now);
  else txGaps.pause();
  for (const message of mtcOut.tick(now, state.gen.position(now), state.gen.running)) {
    try {
      output.send(message.data, message.at);
    } catch {
      // SysEx が許可されていない時は、フルフレーム（頭出し）だけ送れない
    }
  }
}

let mtcOutStarted = false;

function startMtcOut(): void {
  if (mtcOutStarted) return;
  mtcOutStarted = true;
  // タブが裏に回ると通常のタイマーは 1 秒間隔に間引かれるので、Worker のタイマーで刻む
  try {
    const source = 'setInterval(() => postMessage(0), 20);';
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onmessage = mtcOutTick;
  } catch {
    setInterval(mtcOutTick, 20);
  }
}

export function initMidi(): void {
  // Cue が実行されたら Note On を送り、少し後に Note Off を送る
  onFire((e) => {
    const output = access?.outputs.get(state.io.midiOutId ?? '');
    const page = state.show.pages.find((p) => p.id === e.pageId);
    if (!output || !page || !sendsNote(e.cue)) return;
    const target = resolveMidi(e.cue, page);
    output.send(noteOn(target));
    output.send(noteOff(target), performance.now() + state.show.settings.noteLengthMs);
  });

  // 以前に許可済みなら、起動時に自動でつなぐ
  if (status === 'unsupported') return;
  navigator.permissions
    .query({ name: 'midi', sysex: true } as PermissionDescriptor)
    .then((p) => {
      if (p.state === 'granted') void enableMidi();
    })
    .catch(() => {
      // 許可の状態を調べられないブラウザでは、Enable ボタンを待つ
    });
}

// ---------- MTC の途切れの記録 ----------

export interface MtcDiagnostics {
  /** 受信: 途切れた回数、最長の間隔、クォーターフレームの順番が飛んだ回数 */
  rx: { gaps: number; longestMs: number; resyncs: number };
  /** 受信したメッセージの数（クォーターフレーム、フルフレーム）と、受信時刻の記録が今からどれだけ前か */
  seen: { quarter: number; full: number; stampLagMs: number };
  /** 送信: 処理が遅れた回数、最長の間隔、送りそびれて送り直した回数 */
  tx: { late: number; longestMs: number; restarts: number };
}

let rxResyncsBefore = 0;
const rxSeen = { quarter: 0, full: 0, stampLagMs: 0 };

export function mtcDiagnostics(): MtcDiagnostics {
  return {
    rx: { gaps: rxGaps.count, longestMs: rxGaps.longestMs, resyncs: decoder.resyncs - rxResyncsBefore },
    seen: { ...rxSeen },
    tx: { late: txGaps.count, longestMs: txGaps.longestMs, restarts: txRestartsBefore + (mtcOut?.restarts ?? 0) },
  };
}

export function resetMtcDiagnostics(): void {
  rxGaps.reset();
  txGaps.reset();
  rxResyncsBefore = decoder.resyncs;
  txRestartsBefore = -(mtcOut?.restarts ?? 0);
}

// ---------- ショーファイルに入れる入出力の設定 ----------

const nameOf = (ports: PortInfo[], id: string | null): string | null =>
  ports.find((p) => p.id === id)?.name ?? null;

/** 今の入力元と入出力の選択を、ポートや機器の名前で表す */
export function currentShowIo(): ShowIo {
  return {
    source: state.io.source,
    midiIn: nameOf(midiInputs(), state.io.midiInId),
    noteOut: nameOf(midiOutputs(), state.io.midiOutId),
    mtcOut: nameOf(midiOutputs(), state.io.mtcOutId),
    ltcIn: ltcInputName(),
    ltcChannel: state.io.ltcChannel + 1,
  };
}

/**
 * ショーファイルの入出力の設定を反映する。
 * 同じ名前のポートが見つからなかった項目は今の選択のままにして、その名前を返す。
 */
export async function applyShowIo(io: ShowIo): Promise<string[]> {
  if ((io.midiIn || io.noteOut || io.mtcOut) && status !== 'ready') await enableMidi();
  const missing: string[] = [];
  const idOf = (ports: PortInfo[], name: string | null, current: string | null): string | null => {
    if (name === null) return null;
    const found = ports.find((p) => p.name === name);
    if (!found) missing.push(name);
    return found ? found.id : current;
  };
  setIo({
    source: io.source,
    midiInId: idOf(midiInputs(), io.midiIn, state.io.midiInId),
    midiOutId: idOf(midiOutputs(), io.noteOut, state.io.midiOutId),
    mtcOutId: idOf(midiOutputs(), io.mtcOut, state.io.mtcOutId),
  });
  bindInput();
  notify();
  const ltcMissing = await applyLtcShowIo(io.ltcIn, io.ltcChannel);
  if (ltcMissing) missing.push(ltcMissing);
  return [...new Set(missing)];
}
