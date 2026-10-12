import { feedLtc, onChange, setIo, state } from '../app';
import { LtcDecoder } from '../core/ltc';
import { SampleClock } from '../core/sampleclock';
import { refreshClickOutputs, type AudioDevice } from './click';

/**
 * off: LTC を使っていない / starting: 音声入力を開いている途中 / ready: 読み取り中
 * suspended: ブラウザが音声を止めている（画面の操作で再開する）
 * denied: マイクの使用が許可されなかった / error: 音声入力を開けなかった
 */
export type LtcStatus = 'off' | 'starting' | 'ready' | 'suspended' | 'denied' | 'error';

// 音声を 1 チャンネルだけ取り出して、そのまま画面側へ渡す
const TAP_SOURCE = `
class Tap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channel = options.processorOptions.channel;
    this.port.onmessage = (e) => (this.channel = e.data.channel);
  }
  process(inputs) {
    const input = inputs[0];
    const samples = input && (input[this.channel] || input[0]);
    if (samples) {
      const copy = samples.slice();
      this.port.postMessage({ samples: copy, end: currentFrame + copy.length }, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('tc-cd-tap', Tap);
`;

interface Session {
  deviceId: string | null;
  stream: MediaStream | null;
  ctx: AudioContext | null;
  tap: Tap | null;
  decoder: LtcDecoder | null;
}

interface Tap {
  node: AudioNode;
  setChannel(channel: number): void;
}

type OnSamples = (samples: Float32Array, end: number) => void;

/**
 * 音声を 1 チャンネルだけ取り出す部品を作る。
 * AudioWorklet を読み込めない環境（HTML ファイルを直接開いた時など）では、古い方式で代用する。
 */
async function createTap(ctx: AudioContext, count: number, channel: number, onSamples: OnSamples): Promise<Tap> {
  const urls = [
    URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' })),
    `data:text/javascript;charset=utf-8,${encodeURIComponent(TAP_SOURCE)}`,
  ];
  for (const url of urls) {
    try {
      await ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(ctx, 'tc-cd-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: count,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: { channel },
      });
      node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; end: number }>) =>
        onSamples(e.data.samples, e.data.end);
      return { node, setChannel: (next) => node.port.postMessage({ channel: next }) };
    } catch {
      // 次の読み込み方を試す
    }
  }
  const node = ctx.createScriptProcessor(256, count, 1);
  node.channelCountMode = 'explicit';
  node.channelInterpretation = 'discrete';
  let current = channel;
  let end = 0;
  node.onaudioprocess = (e) => {
    const samples = e.inputBuffer.getChannelData(Math.min(current, e.inputBuffer.numberOfChannels - 1)).slice();
    end += samples.length;
    onSamples(samples, end);
  };
  // 出力につながっていないと処理が呼ばれない。何も書き込まないので、音は出ない
  node.connect(ctx.destination);
  return { node, setChannel: (next) => (current = next) };
}

let lastError = '';
/** 音声入力を開けなかった理由（ブラウザが返したエラー） */
export const ltcError = (): string => lastError;

let session: Session | null = null;
let status: LtcStatus = 'off';
let devices: AudioDevice[] = [];
let channels = 1;
const listeners: (() => void)[] = [];

const notify = (): void => listeners.forEach((fn) => fn());

/** 状態や入力の一覧が変わった時 */
export const onLtcChange = (fn: () => void): void => void listeners.push(fn);
export const ltcStatus = (): LtcStatus => status;
export const ltcInputs = (): AudioDevice[] => devices;
/** 開いている音声入力のチャンネル数 */
export const ltcChannels = (): number => channels;
/** 入力のレベル（ピーク、0 〜 1） */
export const ltcLevel = (): number => (status === 'ready' ? (session?.decoder?.level ?? 0) : 0);
/** 今開いている音声入力の名前。開いていなければ空 */
export const ltcActiveName = (): string => session?.stream?.getAudioTracks()[0]?.label ?? '';
export const ltcInputName = (): string | null =>
  devices.find((d) => d.id === state.io.ltcInId)?.name ?? null;

function setStatus(next: LtcStatus): void {
  if (status === next) return;
  status = next;
  notify();
}

async function refreshInputs(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    devices = all
      .filter((d) => d.kind === 'audioinput' && d.label !== '' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, name: d.label }));
  } catch {
    devices = [];
  }
  notify();
}

function stop(): void {
  const old = session;
  session = null;
  old?.tap?.node.disconnect();
  old?.stream?.getTracks().forEach((track) => track.stop());
  void old?.ctx?.close();
  setStatus('off');
}

const describe = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

async function start(): Promise<void> {
  const mine: Session = { deviceId: state.io.ltcInId, stream: null, ctx: null, tap: null, decoder: null };
  session = mine;
  lastError = '';
  setStatus('starting');
  // 途中で入力元や入力が変えられたら、開きかけのものは捨てる
  const stale = (): boolean => session !== mine;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: mine.deviceId ? { exact: mine.deviceId } : undefined,
        // 通話用の加工が入ると LTC の波形が崩れる
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    });
  } catch (err) {
    if (!stale()) {
      session = null;
      lastError = describe(err);
      setStatus(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'error');
    }
    return;
  }
  const release = (): void => stream.getTracks().forEach((track) => track.stop());
  if (stale()) {
    release();
    return;
  }
  mine.stream = stream;
  // 許可が出ると、機器の名前が読めるようになる
  void refreshInputs();
  void refreshClickOutputs();

  try {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    mine.ctx = ctx;
    channels = stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1;
    const decoder = new LtcDecoder(ctx.sampleRate);
    mine.decoder = decoder;
    const clock = new SampleClock(ctx.sampleRate);
    let fed = 0;
    const tap = await createTap(ctx, channels, Math.min(state.io.ltcChannel, channels - 1), (samples, end) => {
      clock.mark(end, performance.now());
      const events = decoder.feed(samples);
      fed += samples.length;
      // フレームが終わった時刻に直して渡す（届いた時刻のままだと、かたまり 1 つ分だけ遅れる）
      for (const event of events) feedLtc(event.frames, event.rate, clock.toMs(end - (fed - event.endSample)));
    });
    if (stale()) {
      tap.node.disconnect();
      release();
      void ctx.close();
      return;
    }
    mine.tap = tap;
    ctx.createMediaStreamSource(stream).connect(tap.node);
    ctx.onstatechange = () => {
      if (session === mine) setStatus(ctx.state === 'running' ? 'ready' : 'suspended');
    };
    setStatus(ctx.state === 'running' ? 'ready' : 'suspended');
  } catch (err) {
    if (stale()) return;
    stop();
    lastError = describe(err);
    setStatus('error');
  }
}

/** 入力元が LTC の間だけ、選ばれた音声入力を開いておく */
function sync(): void {
  const want = state.io.source === 'ltc';
  if (!want) {
    if (session) stop();
    else if (status !== 'off') setStatus('off');
    return;
  }
  if (session && session.deviceId === state.io.ltcInId) {
    session.tap?.setChannel(Math.min(state.io.ltcChannel, channels - 1));
    return;
  }
  // 許可されなかった時などは、選び直すまで開き直さない
  if (!session && (status === 'denied' || status === 'error') && lastTried === tryKey()) return;
  lastTried = tryKey();
  if (session) stop();
  void start();
}

let lastTried = '';
const tryKey = (): string => `${state.io.source}:${state.io.ltcInId ?? ''}`;

/** 止まっている音声入力を開き直す（許可を出し直した後など） */
export function retryLtc(): void {
  lastTried = '';
  if (status === 'denied' || status === 'error') setStatus('off');
  sync();
}

export function selectLtcInput(id: string | null): void {
  setIo({ ltcInId: id });
}

export function selectLtcChannel(channel: number): void {
  setIo({ ltcChannel: channel });
}

/** ブラウザは、ユーザーの操作があるまで音声を動かさないことがある。操作のたびに再開を試みる */
function resume(): void {
  if (session?.ctx?.state === 'suspended') void session.ctx.resume();
}

/**
 * ショーファイルの LTC の設定を反映する。
 * 同じ名前の音声入力が見つからなかった時は、今の選択のままにしてその名前を返す。
 */
export async function applyLtcShowIo(name: string | null, channel: number): Promise<string | null> {
  setIo({ ltcChannel: channel - 1 });
  if (name === null) return null;
  await refreshInputs();
  if (devices.length === 0) {
    // 機器の名前は、マイクの使用を許可するまで読めない
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await refreshInputs();
    } catch {
      // 許可されなければ、見つからなかったものとして扱う
    }
  }
  const found = devices.find((d) => d.name === name);
  if (found) setIo({ ltcInId: found.id });
  return found ? null : name;
}

export function initLtc(): void {
  if (!navigator.mediaDevices) return;
  onChange(sync);
  document.addEventListener('pointerdown', resume, true);
  document.addEventListener('keydown', resume, true);
  navigator.mediaDevices.addEventListener('devicechange', () => void refreshInputs());
  void refreshInputs();
  sync();
}
