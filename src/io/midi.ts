import { feedMtc, onFire, setIo, state } from '../app';
import { noteOff, noteOn, resolveMidi } from '../core/midi';
import { MtcDecoder } from '../core/mtc';
import { MtcOutScheduler } from '../core/mtcout';

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
function bindInput(): void {
  const next = access?.inputs.get(state.io.midiInId ?? '') ?? null;
  if (next === boundInput) return;
  if (boundInput) boundInput.onmidimessage = null;
  boundInput = next;
  if (!next) return;
  next.onmidimessage = (e) => {
    const event = e.data ? decoder.feed(e.data) : null;
    if (event) feedMtc(event, e.timeStamp);
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
    mtcOut = null;
    return;
  }
  if (!mtcOut || mtcOut.rate !== state.show.frameRate) mtcOut = new MtcOutScheduler(state.show.frameRate);
  const now = performance.now();
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
    if (!output || !page) return;
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
