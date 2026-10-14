import {
  addPage,
  deletePage,
  exportShow,
  hasUnsavedChanges,
  importShow,
  isShowMode,
  markSaved,
  newShow,
  nextOf,
  onChange,
  onFire,
  renamePage,
  setActivePage,
  setPageOffset,
  state,
  togglePageTcIgnore,
  updatePageMidi,
  updateSettings,
} from '../app';
import { cueThresholds, formatCountdown, stageFor } from '../core/countdown';
import { MIDI_RANGE, parseShowIo, type MidiTarget } from '../core/show';
import { formatOffset, framesToSeconds, parseOffset } from '../core/timecode';
import {
  canSelectClickOutput,
  clickNamesKnown,
  clickOutputs,
  onClickChange,
  revealClickOutputs,
  selectClickOutput,
  setClickOn,
  setClickVolume,
  testClick,
} from '../io/click';
import {
  ltcActiveName,
  ltcChannels,
  ltcError,
  ltcInputs,
  ltcLevel,
  ltcStatus,
  onLtcChange,
  retryLtc,
  selectLtcChannel,
  selectLtcInput,
} from '../io/ltc';
import {
  applyShowIo,
  currentShowIo,
  enableMidi,
  midiInputs,
  midiOutputs,
  midiStatus,
  clearRemote,
  learnRemote,
  mtcDiagnostics,
  remoteLearning,
  onMidiChange,
  resetMtcDiagnostics,
  selectInput,
  selectMtcOutput,
  selectOutput,
  type PortInfo,
} from '../io/midi';
import { initOffline } from '../io/offline';
import { REMOTE_ACTIONS, type RemoteAction } from '../core/remote';
import { $, el, replay, setAttr, setText, toast } from './dom';
import { version } from '../../package.json';

interface PageEls {
  item: HTMLElement;
  cd: HTMLElement;
}

const pageEls = new Map<string, PageEls>();

export function initSide(): void {
  $('app-version').textContent = `TC-CD ${version} beta`;
  initOffline(() => {
    $('app-version').textContent = `TC-CD ${version} beta · Offline ready`;
  });
  $('page-add').addEventListener('click', addPage);
  initSettings();
  initMidiPanel();
  initClickPanel();
  initLtcPanel();
  initFile();
  onChange(render);
  onMidiChange(renderMidi);
  onClickChange(renderClick);
  onFire((e) => {
    const els = pageEls.get(e.pageId);
    if (els && e.pageId !== state.activePageId) replay(els.item, 'is-go');
  });
  render();
}

function render(): void {
  pageEls.clear();
  const canDelete = state.show.pages.length > 1;
  const nodes = state.show.pages.map((page) => {
    const item = el('div', 'page');
    item.classList.toggle('is-active', page.id === state.activePageId);
    item.classList.toggle('is-ignored', page.tcIgnore);

    const top = el('div', 'page__top');
    const name = el('span', 'page__name', page.name);
    name.title = 'Double-click to rename';
    top.append(name, el('span', 'page__count', String(page.cues.length)));
    if (canDelete) {
      const del = el('button', 'page__delete', '×');
      del.title = 'Delete this page';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePage(page.id);
        toast(`Deleted "${page.name}". Use Undo to restore it.`);
      });
      top.append(del);
    }

    const bottom = el('div', 'page__bottom');
    const tc = el('button', 'page__tc', page.tcIgnore ? 'TC OFF' : 'TC ON');
    tc.title = 'Stop timecode from firing cues on this page only';
    tc.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePageTcIgnore(page.id);
    });

    const offset = el('span', 'page__offset', formatOffset(page.offsetFrames, state.show.frameRate));
    offset.classList.toggle('is-zero', page.offsetFrames === 0);
    offset.title = 'Offset: time added to each cue\'s Trigger Time (e.g. the timecode at the top of the song). Click to edit';
    offset.addEventListener('click', (e) => {
      if (isShowMode()) return;
      e.stopPropagation();
      startOffsetEdit(page.id, offset);
    });

    const cd = el('span', 'page__cd', '--');
    cd.title = 'Time until the next cue on this page';
    bottom.append(tc, offset, cd);

    item.append(top, bottom);
    item.addEventListener('click', () => setActivePage(page.id));
    name.addEventListener('dblclick', () => {
      if (!isShowMode()) startRename(page.id, page.name, name);
    });
    pageEls.set(page.id, { item, cd });
    return item;
  });
  $('page-list').replaceChildren(...nodes);

  const { standbySec, warnSec, finalSec } = state.show.settings;
  $<HTMLInputElement>('set-standby').value = String(standbySec);
  $<HTMLInputElement>('set-warn').value = String(warnSec);
  $<HTMLInputElement>('set-final').value = String(finalSec);
  renderMidi();
}

/** 毎フレーム: 各ページの次の Cue までの残り時間。裏のページの Cue に気づけるようにする。 */
export function updateSide(pos: number): void {
  const { frameRate, settings } = state.show;
  for (const page of state.show.pages) {
    const els = pageEls.get(page.id);
    if (!els) continue;
    const next = nextOf(page, pos);
    if (next) {
      const remaining = framesToSeconds(next.at - pos, frameRate);
      setText(els.cd, formatCountdown(remaining, state.io.countdownStyle));
      setAttr(els.cd, 'data-stage', stageFor(remaining, cueThresholds(next.cue.standbySec, settings)));
    } else {
      setText(els.cd, '--');
      setAttr(els.cd, 'data-stage', 'none');
    }
  }
}

function startOffsetEdit(id: string, holder: HTMLElement): void {
  if (holder.querySelector('input')) return;
  const input = el('input');
  input.spellcheck = false;
  input.value = holder.textContent ?? '';
  holder.replaceChildren(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit: boolean): boolean => {
    if (done) return true;
    const frames = commit ? parseOffset(input.value, state.show.frameRate) : null;
    if (commit && frames === null) {
      input.classList.add('is-invalid');
      return false;
    }
    done = true;
    if (frames !== null) setPageOffset(id, frames);
    render();
    return true;
  };
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => {
    if (!finish(true)) finish(false);
  });
}

function startRename(id: string, current: string, holder: HTMLElement): void {
  if (holder.querySelector('input')) return;
  const input = el('input');
  input.value = current;
  holder.replaceChildren(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    if (commit) renamePage(id, input.value);
    render();
  };
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

/** Standby >= Warn >= Final になるように丸めて保存する */
function initSettings(): void {
  const standby = $<HTMLInputElement>('set-standby');
  const warn = $<HTMLInputElement>('set-warn');
  const final = $<HTMLInputElement>('set-final');
  const read = (input: HTMLInputElement, fallback: number): number => {
    const value = Number(input.value);
    return input.value.trim() !== '' && Number.isFinite(value) ? value : fallback;
  };
  const apply = (): void => {
    const current = state.show.settings;
    const standbySec = Math.max(1, read(standby, current.standbySec));
    const warnSec = Math.max(0, Math.min(standbySec, read(warn, current.warnSec)));
    const finalSec = Math.max(0, Math.min(warnSec, read(final, current.finalSec)));
    updateSettings({ standbySec, warnSec, finalSec });
  };
  for (const input of [standby, warn, final]) {
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    });
  }
}

function initFile(): void {
  const fileInput = $<HTMLInputElement>('file-input');

  $('file-new').addEventListener('click', async () => {
    const choice = await askToSave('Creating a new show will replace it.');
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await saveShow())) return;
    newShow();
    toast('Created an empty show. Use Undo to go back.');
  });

  $('file-import').addEventListener('click', async () => {
    const choice = await askToSave('Loading a file will replace it.');
    if (choice === 'cancel') return;
    if (choice === 'save') {
      // 保存ダイアログを出した後は、ブラウザがファイル選択を開かせてくれないことがある
      if (await saveShow()) toast('Saved. Press Import again to choose a file.');
      return;
    }
    fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      importShow(text);
      markSaved();
      // 入力元と MIDI ポートの選択も、ファイルに入っていれば戻す
      const io = parseShowIo(text);
      const missing = io ? await applyShowIo(io) : [];
      if (missing.length > 0) toast(`Loaded "${file.name}". Not found: ${missing.join(', ')}`, true);
      else toast(`Loaded "${file.name}".`);
    } catch (err) {
      toast(`Could not load the file: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  });

  $('file-export').addEventListener('click', () => void saveShow());
}

interface SaveFileHandle {
  name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

type SaveFilePicker = (options: {
  id?: string;
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveFileHandle>;

/**
 * ショーを JSON ファイルに書き出す。保存先を選べるブラウザ（Chrome / Edge）では
 * 保存ダイアログを出し、選べないブラウザではダウンロードフォルダに保存する。
 */
type SaveChoice = 'save' | 'discard' | 'cancel';

/**
 * 今のショーを置き換える前に、ファイルへの保存を促す。
 * 未保存の変更がなければ何も聞かずに 'discard' を返す。
 */
function askToSave(consequence: string): Promise<SaveChoice> {
  if (!hasUnsavedChanges()) return Promise.resolve('discard');
  const dialog = $<HTMLDialogElement>('save-dialog');
  $('save-dialog-text').textContent = `This show has changes that are not saved to a file. ${consequence}`;
  dialog.showModal();
  return new Promise((resolve) => {
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
    let settled = false;
    const finish = (choice: SaveChoice): void => {
      if (settled) return;
      settled = true;
      for (const button of buttons) button.removeEventListener('click', onClick);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(choice);
    };
    // close イベントは描画のタイミングまで届かないことがあるので、ボタンのクリックで直接決める
    const onClick = (e: Event): void => {
      e.preventDefault();
      const value = (e.currentTarget as HTMLButtonElement).value;
      finish(value === 'save' || value === 'discard' ? value : 'cancel');
    };
    // Esc キーなど、ボタン以外で閉じられた時はキャンセル
    const onClose = (): void => finish('cancel');
    for (const button of buttons) button.addEventListener('click', onClick);
    dialog.addEventListener('close', onClose);
  });
}

/** 保存できたら true。保存ダイアログを閉じた時や失敗した時は false。 */
async function saveShow(): Promise<boolean> {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const fileName = `tc-cd-show-${stamp}.json`;
  const json = exportShow(currentShowIo());

  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        // 同じ id を使うと、前回保存したフォルダから始まる
        id: 'tc-cd-show',
        suggestedName: fileName,
        types: [{ description: 'TC-CD show', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      markSaved();
      toast(`Saved "${handle.name}".`);
      return true;
    } catch (err) {
      // ダイアログを閉じただけなら何もしない
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        toast(`Could not save the file: ${err instanceof Error ? err.message : String(err)}`, true);
      }
      return false;
    }
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = el('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  markSaved();
  return true;
}

const MIDI_INPUTS: readonly [string, keyof MidiTarget][] = [
  ['midi-ch', 'channel'],
  ['midi-note', 'note'],
  ['midi-vel', 'velocity'],
];

const MIDI_MESSAGES: Record<string, string> = {
  unsupported: 'This browser does not support Web MIDI. Open the app in Chrome or Edge.',
  denied: 'MIDI access was not allowed. Allow it in the browser\'s site settings.',
};

function fillPorts(select: HTMLSelectElement, ports: PortInfo[], selectedId: string | null): void {
  const none = el('option', '', 'None');
  none.value = '';
  const options = ports.map((port) => {
    const option = el('option', '', port.name);
    option.value = port.id;
    return option;
  });
  // 前に選んだ機器がつながっていない時も、選択は残しておく
  if (selectedId && !ports.some((port) => port.id === selectedId)) {
    const missing = el('option', '', '(disconnected)');
    missing.value = selectedId;
    options.push(missing);
  }
  select.replaceChildren(none, ...options);
  select.value = selectedId ?? '';
}

function renderMidi(): void {
  const status = midiStatus();
  const ready = status === 'ready';
  $('midi-enable').hidden = ready || status === 'unsupported';

  const input = $<HTMLSelectElement>('midi-in');
  const output = $<HTMLSelectElement>('midi-out');
  fillPorts(input, midiInputs(), state.io.midiInId);
  const mtcOutput = $<HTMLSelectElement>('mtc-out');
  fillPorts(output, midiOutputs(), state.io.midiOutId);
  fillPorts(mtcOutput, midiOutputs(), state.io.mtcOutId);
  input.disabled = !ready;
  output.disabled = !ready;
  mtcOutput.disabled = !ready;

  const message = $('midi-message');
  message.textContent = MIDI_MESSAGES[status] ?? '';
  message.hidden = !(status in MIDI_MESSAGES);

  const page = state.show.pages.find((p) => p.id === state.activePageId);
  for (const [id, key] of MIDI_INPUTS) {
    if (page) $<HTMLInputElement>(id).value = String(page.midi[key]);
  }

  const waiting = remoteLearning();
  for (const action of REMOTE_ACTIONS) {
    const els = remoteEls.get(action);
    if (!els) continue;
    const key = state.io.genRemote[action];
    setText(els.value, key ? `Ch ${key.channel} · Note ${key.note}` : '—');
    els.value.classList.toggle('is-empty', key === null);
    setText(els.learn, waiting === action ? 'Play a note…' : 'Learn');
    els.learn.classList.toggle('is-on', waiting === action);
    // 受ける入力ポートが決まっていないと、Note は届かない
    els.learn.disabled = !ready || !state.io.midiInId;
    els.clear.hidden = key === null;
  }
}

const REMOTE_LABELS: Record<RemoteAction, string> = {
  play: 'Play',
  stop: 'Stop',
  rewind: 'Rewind',
};

interface RemoteEls {
  value: HTMLElement;
  learn: HTMLButtonElement;
  clear: HTMLButtonElement;
}

const remoteEls = new Map<RemoteAction, RemoteEls>();

function initRemote(): void {
  for (const action of REMOTE_ACTIONS) {
    const row = el('div', 'field remote__row');
    const value = el('span', 'remote__value');
    const learn = el('button', 'btn btn--tiny btn--toggle', 'Learn');
    learn.addEventListener('click', () => learnRemote(remoteLearning() === action ? null : action));
    const clear = el('button', 'btn btn--tiny', '×');
    clear.title = 'Remove this note';
    clear.addEventListener('click', () => clearRemote(action));
    row.append(el('span', '', REMOTE_LABELS[action]), value, learn, clear);
    $('gen-remote').append(row);
    remoteEls.set(action, { value, learn, clear });
  }
}

/** MTC の送受信が途切れた記録を表示する。長時間動かした時に、どちら側で起きたかを見分けるため。 */
let seenBefore = { quarter: 0, full: 0 };

function renderDiagnostics(): void {
  const node = $('midi-diag');
  const { rx, tx, seen } = mtcDiagnostics();
  const lines: string[] = [];
  if (state.io.midiInId) {
    lines.push(`MTC In : ${rx.gaps} gaps (max ${Math.round(rx.longestMs)} ms), ${rx.resyncs} resyncs`);
    // 直近 1 秒に届いたメッセージの種類と、受信時刻の記録のずれ
    const qf = seen.quarter - seenBefore.quarter;
    const full = seen.full - seenBefore.full;
    // 付いてきた時刻が大きくずれている送り元では、届いた時刻を使っている
    const lag = Math.round(seen.stampLagMs);
    const stamp = lag >= 0 && lag <= 100 ? `stamp ${lag} ms` : 'stamp ignored';
    lines.push(`         ${qf} QF/s, ${full} full/s, ${stamp}`);
  }
  seenBefore = { quarter: seen.quarter, full: seen.full };
  if (state.io.mtcOutId) {
    lines.push(`MTC Out: ${tx.late} late (max ${Math.round(tx.longestMs)} ms), ${tx.restarts} restarts`);
  }
  const text = lines.join('\n');
  if (node.textContent !== text) node.textContent = text;
  node.hidden = lines.length === 0 || midiStatus() !== 'ready';
  node.classList.toggle('is-alert', rx.gaps + rx.resyncs + tx.late + tx.restarts > 0);
}

function initMidiPanel(): void {
  $('midi-diag').addEventListener('click', () => {
    resetMtcDiagnostics();
    renderDiagnostics();
  });
  setInterval(renderDiagnostics, 1000);
  $('midi-enable').addEventListener('click', () => void enableMidi());
  initRemote();
  const input = $<HTMLSelectElement>('midi-in');
  const output = $<HTMLSelectElement>('midi-out');
  input.addEventListener('change', () => {
    selectInput(input.value || null);
    input.blur();
  });
  output.addEventListener('change', () => {
    selectOutput(output.value || null);
    output.blur();
  });
  const mtcOutput = $<HTMLSelectElement>('mtc-out');
  mtcOutput.addEventListener('change', () => {
    selectMtcOutput(mtcOutput.value || null);
    mtcOutput.blur();
  });

  for (const [id, key] of MIDI_INPUTS) {
    const field = $<HTMLInputElement>(id);
    field.addEventListener('change', () => {
      const value = Number(field.value);
      const [min, max] = MIDI_RANGE[key];
      // 範囲外の入力は取り消して、今の値に戻す
      if (field.value.trim() !== '' && Number.isInteger(value) && value >= min && value <= max) {
        updatePageMidi({ [key]: value });
      } else {
        renderMidi();
      }
    });
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') field.blur();
    });
  }
}

// ---------- クリック音 ----------

function renderClick(): void {
  const select = $<HTMLSelectElement>('click-out');
  const selectedId = state.io.clickSinkId;
  const fallback = el('option', '', 'System default');
  fallback.value = '';
  const options = clickOutputs().map((device) => {
    const option = el('option', '', device.name);
    option.value = device.id;
    return option;
  });
  // 前に選んだ機器がつながっていない時も、選択は残しておく
  if (selectedId && !clickOutputs().some((device) => device.id === selectedId)) {
    const missing = el('option', '', clickNamesKnown() ? '(disconnected)' : '(saved device)');
    missing.value = selectedId;
    options.push(missing);
  }
  select.replaceChildren(fallback, ...options);
  select.value = selectedId ?? '';
  select.disabled = !canSelectClickOutput();

  const on = $('click-on');
  setText(on, state.io.clickOn ? 'On' : 'Off');
  on.classList.toggle('is-on', state.io.clickOn);

  $('click-names').hidden = clickNamesKnown() || !canSelectClickOutput();
  const message = $('click-message');
  message.textContent = 'This browser cannot choose the click output. Open the app in Chrome or Edge.';
  message.hidden = canSelectClickOutput();
}

function initClickPanel(): void {
  const select = $<HTMLSelectElement>('click-out');
  select.addEventListener('change', () => {
    selectClickOutput(select.value || null);
    select.blur();
  });
  const volume = $<HTMLInputElement>('click-volume');
  volume.value = String(Math.round(state.io.clickVolume * 100));
  volume.addEventListener('input', () => setClickVolume(Number(volume.value) / 100));
  volume.addEventListener('change', () => {
    testClick();
    volume.blur();
  });
  $('click-test').addEventListener('click', testClick);
  $('click-on').addEventListener('click', () => setClickOn(!state.io.clickOn));
  onChange(renderClick);
  $('click-names').addEventListener('click', () => {
    void revealClickOutputs().then((ok) => {
      if (!ok) toast('Microphone access was not allowed, so device names stay hidden', true);
    });
  });
  renderClick();
}

// ---------- LTC ----------

const LTC_MESSAGES: Record<string, string> = {
  denied: 'Microphone access was not allowed. Allow it in the browser\'s site settings, then press Retry.',
  error: 'Could not open the audio input. Check the connection, then press Retry.',
  suspended: 'The browser paused audio. Click anywhere on the page to start.',
};

function renderLtc(): void {
  // 右パネルが長くなりすぎないよう、入力元が LTC の時だけ出す
  $('ltc-section').classList.toggle('is-unused', state.io.source !== 'ltc');
  const input = $<HTMLSelectElement>('ltc-in');
  const selectedId = state.io.ltcInId;
  // 既定の入力で開いている時は、実際に開いた機器の名前も出す
  const active = selectedId === null && ltcActiveName() ? ` (${ltcActiveName().replace(/^Default - /, '')})` : '';
  const fallback = el('option', '', `System default${active}`);
  fallback.value = '';
  const options = ltcInputs().map((device) => {
    const option = el('option', '', device.name);
    option.value = device.id;
    return option;
  });
  // 前に選んだ機器がつながっていない時も、選択は残しておく
  if (selectedId && !ltcInputs().some((device) => device.id === selectedId)) {
    const missing = el('option', '', ltcInputs().length > 0 ? '(disconnected)' : '(saved device)');
    missing.value = selectedId;
    options.push(missing);
  }
  input.replaceChildren(fallback, ...options);
  input.value = selectedId ?? '';

  // 開いている入力のチャンネル数まで選べる。開く前でも、保存済みの選択は残す
  const channel = $<HTMLSelectElement>('ltc-channel');
  const count = Math.max(ltcChannels(), state.io.ltcChannel + 1);
  channel.replaceChildren(
    ...Array.from({ length: count }, (_, i) => {
      const option = el('option', '', String(i + 1));
      option.value = String(i);
      return option;
    }),
  );
  channel.value = String(state.io.ltcChannel);

  const status = ltcStatus();
  $('ltc-retry').hidden = status !== 'denied' && status !== 'error';
  const message = $('ltc-message');
  // 開けなかった時は、ブラウザが返した理由も出す
  const reason = status === 'error' && ltcError() ? ` (${ltcError()})` : '';
  message.textContent = (LTC_MESSAGES[status] ?? '') + reason;
  message.hidden = !(status in LTC_MESSAGES);
}

function initLtcPanel(): void {
  const input = $<HTMLSelectElement>('ltc-in');
  input.addEventListener('change', () => {
    selectLtcInput(input.value || null);
    input.blur();
  });
  const channel = $<HTMLSelectElement>('ltc-channel');
  channel.addEventListener('change', () => {
    selectLtcChannel(Number(channel.value));
    channel.blur();
  });
  $('ltc-retry').addEventListener('click', retryLtc);
  // レベルは -60 dB から 0 dB までを棒の長さにする
  const bar = $('ltc-level');
  setInterval(() => {
    const db = 20 * Math.log10(Math.max(ltcLevel(), 1e-6));
    bar.style.width = `${Math.min(100, Math.max(0, ((db + 60) / 60) * 100))}%`;
  }, 100);
  onLtcChange(renderLtc);
  onChange(renderLtc);
  renderLtc();
}
