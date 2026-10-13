import { activePage, clockPosition, clockRunning, nextOf, setIo, state } from '../app';
import { ClickScheduler } from '../core/click';
import { framesToSeconds } from '../core/timecode';

export interface AudioDevice {
  id: string;
  name: string;
}

const CLICK_HZ = 1000;
const CLICK_SEC = 0.07;
/** GO の瞬間は、1 オクターブ高く、少し長く鳴らす */
const GO_HZ = 2000;
const GO_SEC = 0.18;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let appliedSinkId = '';
let devices: AudioDevice[] = [];
let namesKnown = false;
const scheduler = new ClickScheduler();
/** 予定済みで、まだ鳴り終わっていないクリック */
const pending = new Set<{ osc: OscillatorNode; at: number }>();
const listeners: (() => void)[] = [];

const notify = (): void => listeners.forEach((fn) => fn());

/** 出力先の一覧が変わった時 */
export const onClickChange = (fn: () => void): void => void listeners.push(fn);
export const clickOutputs = (): AudioDevice[] => devices;
/** 出力先の名前が読めているか。ブラウザはマイクの使用を許可するまで名前を隠す */
export const clickNamesKnown = (): boolean => namesKnown;
/** 出力先を選べるブラウザか（Chrome / Edge） */
export const canSelectClickOutput = (): boolean => 'setSinkId' in AudioContext.prototype;

function context(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  (master as GainNode).gain.value = state.io.clickVolume;
  applySink();
  return ctx;
}

function applySink(): void {
  const id = state.io.clickSinkId ?? '';
  if (!ctx || id === appliedSinkId || !canSelectClickOutput()) return;
  appliedSinkId = id;
  // 選んだ機器が外されている時は、今の出力先のまま鳴らす
  const audio = ctx as AudioContext & { setSinkId(id: string): Promise<void> };
  audio.setSinkId(id).catch(() => (appliedSinkId = ''));
}

function beep(audio: AudioContext, at: number, isGo = false): void {
  const length = isGo ? GO_SEC : CLICK_SEC;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = isGo ? GO_HZ : CLICK_HZ;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(1, at + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, at + length);
  osc.connect(gain).connect(master as GainNode);
  osc.start(at);
  osc.stop(at + length);
  const entry = { osc, at };
  pending.add(entry);
  osc.onended = () => pending.delete(entry);
}

function cancelPending(audio: AudioContext): void {
  for (const entry of pending) {
    if (entry.at <= audio.currentTime) continue;
    entry.osc.onended = null;
    entry.osc.stop();
    pending.delete(entry);
  }
}

/** 前面のページの次の Cue に向けて、3、2、1 秒前と GO の瞬間のクリックを予定する */
function tick(): void {
  // 音を出せない間は予定をためない（再開した瞬間にまとめて鳴ってしまう）
  if (!state.io.clickOn || !ctx || ctx.state !== 'running') {
    if (ctx && scheduler.tick(null, 0, false).cancel) cancelPending(ctx);
    return;
  }
  const now = performance.now();
  const pos = clockPosition(now);
  const next = nextOf(activePage(), pos);
  const remaining = next ? framesToSeconds(next.at - pos, state.show.frameRate) : 0;
  const result = scheduler.tick(next?.cue.id ?? null, remaining, clockRunning(now));
  if (result.cancel) cancelPending(ctx);
  for (const click of result.clicks) beep(ctx, ctx.currentTime + click.inSec, click.count === 0);
}

/** Click が On なのに、ブラウザがまだ音を出させてくれない状態か（ページを操作すると出せるようになる） */
export const clickBlocked = (): boolean => state.io.clickOn && ctx?.state !== 'running';

/** ブラウザは、ユーザーの操作があるまで音を出させない。操作のたびに再開を試みる */
function resume(): void {
  if (!state.io.clickOn) return;
  const audio = context();
  if (audio.state !== 'running') void audio.resume();
}

export function setClickOn(on: boolean): void {
  setIo({ clickOn: on });
  resume();
}

export function setClickVolume(volume: number): void {
  setIo({ clickVolume: Math.min(1, Math.max(0, volume)) });
  if (master) master.gain.value = state.io.clickVolume;
}

export function selectClickOutput(id: string | null): void {
  setIo({ clickSinkId: id });
  applySink();
}

/** 設定の確認用に、今すぐ 1 回鳴らす */
export function testClick(): void {
  const audio = context();
  void audio.resume().then(() => beep(audio, audio.currentTime + 0.02));
}

/** 出力先の一覧を読み直す（マイクの使用が許可された後は、名前が読めるようになる） */
export async function refreshClickOutputs(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const outputs = all.filter((d) => d.kind === 'audiooutput');
    namesKnown = outputs.some((d) => d.label !== '');
    devices = outputs
      .filter((d) => d.label !== '' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, name: d.label }));
  } catch {
    devices = [];
  }
  notify();
}

/** 出力先の名前を読めるようにする。ブラウザの仕様で、マイクの使用許可が必要 */
export async function revealClickOutputs(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    return false;
  }
  await refreshClickOutputs();
  return namesKnown;
}

export function initClick(): void {
  // タブが裏に回ると通常のタイマーは間引かれるので、Worker のタイマーで刻む
  try {
    const source = 'setInterval(() => postMessage(0), 50);';
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onmessage = tick;
  } catch {
    setInterval(tick, 50);
  }
  document.addEventListener('pointerdown', resume, true);
  document.addEventListener('keydown', resume, true);
  navigator.mediaDevices?.addEventListener('devicechange', () => void refreshClickOutputs());
  if (navigator.mediaDevices) void refreshClickOutputs();
}
