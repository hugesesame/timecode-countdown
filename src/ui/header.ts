import {
  clockRunning,
  goTarget,
  isShowMode,
  locateTo,
  manualGo,
  onChange,
  onFire,
  preroll,
  setFrameRate,
  setIo,
  state,
  type Source,
  togglePlay,
  toggleTcIgnore,
} from '../app';
import { FRAME_RATES, FRAME_RATE_LABELS, formatTimecode, parseTimecode, type FrameRate } from '../core/timecode';
import { ltcStatus } from '../io/ltc';
import { enableMidi } from '../io/midi';
import { createCountdownView, type CountdownView } from './countdown';
import { $, el, setText } from './dom';

let countdown: CountdownView;

const cueLabel = (number: string, name: string): string => [number, name].filter(Boolean).join('  ') || '—';

export function initHeader(): void {
  $('go').addEventListener('click', manualGo);
  $('tc-rewind').addEventListener('click', () => locateTo(0));
  $('tc-play').addEventListener('click', togglePlay);
  $('tc-preroll').addEventListener('click', preroll);
  $('tc-ignore').addEventListener('click', toggleTcIgnore);

  const rate = $<HTMLSelectElement>('rate');
  for (const r of FRAME_RATES) {
    const option = el('option', '', `${FRAME_RATE_LABELS[r]} fps`);
    option.value = r;
    rate.append(option);
  }
  rate.addEventListener('change', () => {
    setFrameRate(rate.value as FrameRate);
    rate.blur();
  });

  const source = $<HTMLSelectElement>('source');
  source.addEventListener('change', () => {
    setIo({ source: source.value as Source });
    if (source.value === 'mtc') void enableMidi();
    source.blur();
  });

  // カウントダウンの数字をクリックすると、整数と小数ありを切り替える
  $('cd-time').addEventListener('click', () => {
    setIo({ countdownStyle: state.io.countdownStyle === 'whole' ? 'tenths' : 'whole' });
  });

  countdown = createCountdownView({
    root: $('cd'),
    number: $('cd-number'),
    name: $('cd-name'),
    info: $('cd-info'),
    time: $('cd-time'),
    lane: $('lane'),
    ticks: $('lane-ticks'),
    track: $('lane-track'),
  });

  initLocateInput();
  onChange(renderStatic);
  renderStatic();

  onFire((e) => {
    if (e.pageId !== state.activePageId) return;
    setText($('cd-last'), cueLabel(e.cue.number, e.cue.name) + (e.manual ? '  (manual)' : ''));
    countdown.go();
  });
}

/** タイムコード表示をクリックすると、時刻を打ち込んで頭出しできる */
function initLocateInput(): void {
  const digits = $('tc-digits');
  const input = $<HTMLInputElement>('tc-locate');
  const close = (): void => {
    input.hidden = true;
    digits.hidden = false;
  };
  digits.addEventListener('click', () => {
    if (state.io.source !== 'int') return;
    input.value = digits.textContent ?? '';
    input.classList.remove('is-invalid');
    digits.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key !== 'Enter') return;
    const frames = parseTimecode(input.value, state.show.frameRate);
    if (frames === null) {
      input.classList.add('is-invalid');
      return;
    }
    locateTo(frames);
    close();
  });
  input.addEventListener('blur', close);
}

/** 設定が変わった時だけ作り直す部分 */
function renderStatic(): void {
  $<HTMLSelectElement>('rate').value = state.show.frameRate;
  // 本番中に入力元やフレームレートを誤って変えないようにする
  $<HTMLSelectElement>('rate').disabled = isShowMode();
  $<HTMLSelectElement>('source').disabled = isShowMode();

  // 再生や頭出しは内蔵ジェネレーターの時だけ使える
  const isInt = state.io.source === 'int';
  $<HTMLSelectElement>('source').value = state.io.source;
  $('tc-digits').parentElement?.parentElement?.classList.toggle('is-int', isInt);
  $('tc-digits').title = isInt ? 'Click to locate' : '';
  for (const id of ['tc-rewind', 'tc-play', 'tc-preroll']) $<HTMLButtonElement>(id).disabled = !isInt;

  countdown.renderStatic();
}

/** LTC の音声入力を使えない時の表示 */
const LTC_ALERTS: Record<string, string> = {
  denied: '⚠ Mic blocked',
  error: '⚠ No input',
  suspended: '⚠ Click page',
};

/** 入力元の状態: タイムコードを受信できているか、レートがショーと合っているか */
function updateStatus(now: number): void {
  const status = $('tc-status');
  let text = '';
  let level = '';
  if (state.io.source !== 'int') {
    const { extRate } = state;
    const alert = state.io.source === 'ltc' ? LTC_ALERTS[ltcStatus()] : undefined;
    if (alert) {
      text = alert;
      level = 'is-alert';
    } else if (extRate && extRate !== state.show.frameRate) {
      text = `⚠ ${state.io.source.toUpperCase()} is ${FRAME_RATE_LABELS[extRate]} fps`;
      level = 'is-alert';
    } else if (clockRunning(now)) {
      text = '● Receiving';
      level = 'is-ok';
    } else {
      text = extRate ? 'Stopped' : 'No signal';
    }
  }
  setText(status, text);
  status.classList.toggle('is-ok', level === 'is-ok');
  status.classList.toggle('is-alert', level === 'is-alert');
}

export function updateHeader(now: number, pos: number): void {
  setText($('tc-digits'), formatTimecode(pos, state.show.frameRate));
  $('tc-play').classList.toggle('is-running', state.io.source === 'int' && state.gen.running);
  updateStatus(now);

  const ignore = $('tc-ignore');
  setText(ignore, state.tcIgnore ? 'TC IGNORE' : 'TC ON');
  ignore.classList.toggle('is-on', !state.tcIgnore);
  ignore.classList.toggle('is-alert', state.tcIgnore);
  ignore.parentElement?.parentElement?.classList.toggle('is-ignored', state.tcIgnore);

  const target = goTarget(pos);
  setText($('go-target'), target ? cueLabel(target.number, target.name) : '—');

  countdown.update(pos);
}
