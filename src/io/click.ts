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
/** 出力先の切り替えを頼んでいる最中か */
let sinkBusy = false;
let sinkRetryAt = 0;
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

/** 出力先を選べるブラウザでの AudioContext */
type SinkContext = AudioContext & { sinkId?: unknown; setSinkId(id: string): Promise<void> };

function createContext(): AudioContext {
  const sinkId = state.io.clickSinkId ?? '';
  if (sinkId && canSelectClickOutput()) {
    try {
      // 最初から選んだ出力先で開く。後から切り替えると、切り替わる前の音が既定の出力先に出てしまう
      return new AudioContext({ latencyHint: 'interactive', sinkId } as AudioContextOptions);
    } catch {
      // 選んだ機器が外されている時は、既定の出力先で開く
    }
  }
  return new AudioContext({ latencyHint: 'interactive' });
}

function context(): AudioContext {
  if (!ctx) {
    ctx = createContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  (master as GainNode).gain.value = state.io.clickVolume;
  applySink();
  return ctx;
}

/** 実際の出力先が選んだものと違っていたら、切り替える。うまくいかなかった時は、少し待ってからやり直す */
function applySink(): void {
  if (!ctx || sinkBusy || !canSelectClickOutput()) return;
  const audio = ctx as SinkContext;
  const id = state.io.clickSinkId ?? '';
  const current = typeof audio.sinkId === 'string' ? audio.sinkId : '';
  if (id === current || performance.now() < sinkRetryAt) return;
  sinkBusy = true;
  audio
    .setSinkId(id)
    // 選んだ機器が外されている時は、今の出力先のまま鳴らす
    .catch(() => (sinkRetryAt = performance.now() + 2000))
    .finally(() => (sinkBusy = false));
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
  applySink();
  const now = performance.now();
  watchClock(ctx, now);
  if (stalled) return;
  const pos = clockPosition(now);
  const next = nextOf(activePage(), pos);
  const remaining = next ? framesToSeconds(next.at - pos, state.show.frameRate) : 0;
  const result = scheduler.tick(next?.cue.id ?? null, remaining, clockRunning(now));
  if (result.cancel) cancelPending(ctx);
  for (const click of result.clicks) beep(ctx, ctx.currentTime + click.inSec, click.count === 0);
}

/** Click が On なのに、音を出せない状態か（ページを操作すると出せるようになる） */
export const clickBlocked = (): boolean => state.io.clickOn && (ctx?.state !== 'running' || stalled);

/** 音声の時計が進んでいるかの見張り。「動いている」と報告されていても、実際には止まっていることがある */
let stalled = false;
let seenTime = -1;
let seenAt = 0;
let kickAt = 0;

function watchClock(audio: AudioContext, now: number): void {
  if (audio.currentTime !== seenTime) {
    seenTime = audio.currentTime;
    seenAt = now;
    stalled = false;
    return;
  }
  if (now - seenAt < 500) return;
  stalled = true;
  if (now < kickAt) return;
  // 止めてから動かし直すと、時計が進み始める
  kickAt = now + 2000;
  void audio.suspend().then(() => audio.resume());
}

/** ブラウザは、ユーザーの操作があるまで音を出させない。操作のたびに再開を試みる */
function resume(): void {
  blockedAtGesture = clickBlocked() ? performance.now() : 0;
  if (!state.io.clickOn) return;
  const audio = context();
  if (audio.state !== 'running') void audio.resume();
}

/** 直前の操作の時点で音が止められていたなら、その時刻 */
let blockedAtGesture = 0;

/**
 * ツールバーの Click ボタン。
 * 音が止められている間（⚠ の表示）に押された時は、Off にはせず、音を出せるようにするだけにする。
 */
export function toggleClick(): void {
  if (state.io.clickOn && performance.now() - blockedAtGesture < 1000) {
    resume();
    return;
  }
  setClickOn(!state.io.clickOn);
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
  sinkRetryAt = 0;
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
