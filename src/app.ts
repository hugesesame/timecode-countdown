import { nextCue, type CountdownStyle } from './core/countdown';
import { ExternalClock } from './core/clock';
import { advance, locate, withOffset, type EngineCue } from './core/engine';
import { Generator } from './core/generator';
import type { MtcEvent } from './core/mtc';
import {
  createCue,
  createPage,
  createShow,
  isEmptyShow,
  moveItem,
  nextCueNumber,
  parseShow,
  serializeShow,
  type Cue,
  type MidiTarget,
  type Page,
  type Settings,
  type Show,
  type ShowIo,
} from './core/show';
import { convertFrameRate, parseTimecode, secondsToFrames, type FrameRate } from './core/timecode';

const STORAGE_KEY = 'tc-cd:show';
const IO_KEY = 'tc-cd:io';
/** 今のショーがファイルに書き出し済みなら '1' が入る */
const SAVED_KEY = 'tc-cd:saved';
const UNDO_LIMIT = 50;
/** これより大きく先に進んだら「飛んだ」と見なす秒数 */
const JUMP_SEC = 2;

export const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** 初回起動時に入れておくサンプル */
function sampleShow(): Show {
  const show = createShow(newId());
  const page = show.pages[0] as Page;
  page.name = 'Song 1';
  const rows: [string, string, string, string, boolean][] = [
    ['1', '00:00:15:00', 'Kabuki Drop', 'SL and SR together', true],
    ['2', '00:00:24:00', 'CO2 Jet', 'Top of chorus, 4 shots', true],
    ['3', '00:00:28:00', 'CO2 Jet', 'Second time', true],
    ['4', '00:00:45:00', 'Sparkular', 'Guitar solo, 8 bars', true],
    ['5', '00:01:02:15', 'Confetti', 'Silver streamers', false],
    ['6', '00:01:10:00', 'Confetti', 'After the breakdown', true],
    ['7', '00:01:30:00', 'Blackout', 'End of outro', true],
  ];
  page.cues = rows.map(([number, tc, name, info, enabled]) => ({
    ...createCue(newId(), number),
    triggerFrame: parseTimecode(tc, show.frameRate),
    name,
    info,
    enabled,
  }));
  return show;
}

function loadShow(): Show {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return parseShow(saved);
  } catch {
    // 保存データが読めない時はサンプルから始める
  }
  return sampleShow();
}

export type Source = 'int' | 'mtc';

/** このマシンでの入出力の選択。ショーファイルには含めない。 */
export type Mode = 'program' | 'show';

export interface IoPrefs {
  source: Source;
  /** program: 仕込み用 / show: 本番用（編集をロックし、表示を大きくする） */
  mode: Mode;
  /** カウントダウンの数字の表示。数字をクリックして切り替える */
  countdownStyle: CountdownStyle;
  midiInId: string | null;
  midiOutId: string | null;
  /** 内蔵ジェネレーターのタイムコードを MTC として送る出力ポート */
  mtcOutId: string | null;
  /** カウントダウンの 3、2、1 でクリック音を鳴らす */
  clickOn: boolean;
  /** クリック音の音量（0 〜 1） */
  clickVolume: number;
  /** クリック音の出力先。null はシステムの既定の出力 */
  clickSinkId: string | null;
}

function loadIo(): IoPrefs {
  const prefs: IoPrefs = { source: 'int', mode: 'program', countdownStyle: 'whole', midiInId: null, midiOutId: null, mtcOutId: null, clickOn: false, clickVolume: 0.6, clickSinkId: null };
  try {
    const saved = JSON.parse(localStorage.getItem(IO_KEY) ?? '{}') as Partial<IoPrefs>;
    if (saved.source === 'mtc') prefs.source = 'mtc';
    if (saved.mode === 'show') prefs.mode = 'show';
    if (saved.countdownStyle === 'tenths') prefs.countdownStyle = 'tenths';
    if (typeof saved.midiInId === 'string') prefs.midiInId = saved.midiInId;
    if (typeof saved.midiOutId === 'string') prefs.midiOutId = saved.midiOutId;
    if (typeof saved.mtcOutId === 'string') prefs.mtcOutId = saved.mtcOutId;
    if (saved.clickOn === true) prefs.clickOn = true;
    if (typeof saved.clickVolume === 'number' && saved.clickVolume >= 0 && saved.clickVolume <= 1) prefs.clickVolume = saved.clickVolume;
    if (typeof saved.clickSinkId === 'string') prefs.clickSinkId = saved.clickSinkId;
  } catch {
    // 読めない時は初期値のまま
  }
  return prefs;
}

const initialShow = loadShow();

export const state = {
  show: initialShow,
  activePageId: (initialShow.pages[0] as Page).id,
  selectedCueId: null as string | null,
  gen: new Generator(initialShow.frameRate),
  /** MTC に追従する時計 */
  ext: new ExternalClock(initialShow.frameRate),
  /** 受信中の MTC のフレームレート。まだ受信していなければ null */
  mtcRate: null as FrameRate | null,
  io: loadIo(),
  /** ページごとの実行済み・通過済みの Cue */
  fired: new Map<string, Set<string>>(),
  /** 全ページでタイムコードによる実行を止める */
  tcIgnore: false,
  prevPos: 0,
};

const undoStack: string[] = [];

// ---------- 通知 ----------

export interface FireEvent {
  pageId: string;
  cue: Cue;
  manual: boolean;
}

type Listener = () => void;
const changeListeners: Listener[] = [];
const selectionListeners: Listener[] = [];
const fireListeners: ((e: FireEvent) => void)[] = [];

/** ショーの内容や前面ページが変わった時 */
export const onChange = (fn: Listener): void => void changeListeners.push(fn);
/** 選択中の Cue が変わった時 */
export const onSelection = (fn: Listener): void => void selectionListeners.push(fn);
/** Cue が実行された時 */
export const onFire = (fn: (e: FireEvent) => void): void => void fireListeners.push(fn);

const notifyChange = (): void => changeListeners.forEach((fn) => fn());
const notifySelection = (): void => selectionListeners.forEach((fn) => fn());

// ---------- 参照 ----------

/** 選択中の入力元での現在のフレーム位置（小数を含む） */
export function clockPosition(now: number): number {
  return state.io.source === 'int' ? state.gen.position(now) : state.ext.position(now);
}

export function clockRunning(now: number): boolean {
  return state.io.source === 'int' ? state.gen.running : state.ext.isRunning(now);
}

export function activePage(): Page {
  return state.show.pages.find((p) => p.id === state.activePageId) ?? (state.show.pages[0] as Page);
}

export function firedOf(pageId: string): Set<string> {
  let set = state.fired.get(pageId);
  if (!set) {
    set = new Set();
    state.fired.set(pageId, set);
  }
  return set;
}

/** ショーモードでは編集をロックする */
export const isShowMode = (): boolean => state.io.mode === 'show';

let rev = 0;
const timedCache = new WeakMap<Page, { rev: number; cues: EngineCue[] }>();

/** ページのオフセットを足した、実際に実行する時刻での Cue の一覧 */
export function timedCues(page: Page): EngineCue[] {
  const cached = timedCache.get(page);
  if (cached && cached.rev === rev) return cached.cues;
  const cues = withOffset(page.cues, page.offsetFrames);
  timedCache.set(page, { rev, cues });
  return cues;
}

/** そのページで次に来る Cue と、実行される時刻（オフセット込みのフレーム位置） */
export function nextOf(page: Page, pos: number): { cue: Cue; at: number } | null {
  const next = nextCue(timedCues(page), firedOf(page.id), pos);
  const cue = next && page.cues.find((c) => c.id === next.id);
  return cue && next.triggerFrame !== null ? { cue, at: next.triggerFrame } : null;
}

export function selectedCue(): Cue | null {
  return activePage().cues.find((c) => c.id === state.selectedCueId) ?? null;
}

/** Go ボタンとスペースキーが実行する Cue: 選択中、なければ次に来る Cue */
export function goTarget(pos: number): Cue | null {
  return selectedCue() ?? nextOf(activePage(), pos)?.cue ?? null;
}

export const canUndo = (): boolean => undoStack.length > 0;

// ---------- 保存と元に戻す ----------

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeShow(state.show));
    // 内容が変わったので、ファイルには未保存の状態になる
    localStorage.removeItem(SAVED_KEY);
  } catch {
    // 保存できない環境でも動作は続ける
  }
}

/** 今のショーをファイルに書き出した、またはファイルから読み込んだ直後に呼ぶ */
export function markSaved(): void {
  try {
    localStorage.setItem(SAVED_KEY, '1');
  } catch {
    // 保存できない環境でも動作は続ける
  }
}

/** 今のショーを別のショーに置き換える前に、保存を促すべきか */
export function hasUnsavedChanges(): boolean {
  if (isEmptyShow(state.show)) return false;
  try {
    return localStorage.getItem(SAVED_KEY) !== '1';
  } catch {
    return true;
  }
}

function pushUndo(): void {
  undoStack.push(serializeShow(state.show));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

/** 前面ページや選択が、存在しないものを指さないようにする */
function normalize(): void {
  if (!state.show.pages.some((p) => p.id === state.activePageId)) {
    state.activePageId = (state.show.pages[0] as Page).id;
  }
  if (!selectedCue()) state.selectedCueId = null;
}

/** ショーを書き換える。元に戻せるように直前の状態を残し、自動保存する。 */
function mutate(fn: (show: Show) => void): void {
  pushUndo();
  fn(state.show);
  rev += 1;
  normalize();
  persist();
  notifyChange();
}

/** ショー全体を差し替える（読み込み、新規、元に戻す） */
function adoptShow(show: Show): void {
  const now = performance.now();
  const oldRate = state.show.frameRate;
  const pos = state.gen.position(now);
  const wasRunning = state.gen.running;
  state.show = show;
  rev += 1;
  if (show.frameRate !== oldRate) {
    state.ext = new ExternalClock(show.frameRate);
    state.gen = new Generator(show.frameRate);
    state.gen.locate(convertFrameRate(Math.floor(pos), oldRate, show.frameRate), now);
    if (wasRunning) state.gen.play(now);
  }
  normalize();
  relocate(now);
  persist();
  notifyChange();
}

export function replaceShow(show: Show): void {
  if (isShowMode()) return;
  pushUndo();
  adoptShow(show);
}

export function newShow(): void {
  replaceShow(createShow(newId()));
}

export function importShow(json: string): void {
  replaceShow(parseShow(json));
}

/** 書き出すファイルには、入力元と MIDI ポートの選択も一緒に入れる */
export function exportShow(io: ShowIo): string {
  return serializeShow(state.show, io);
}

export function undo(): void {
  if (isShowMode()) return;
  const prev = undoStack.pop();
  if (prev !== undefined) adoptShow(parseShow(prev));
}

// ---------- タイムコード ----------

/** 今の位置を基準に、全ページの Cue の通過状態を作り直す */
function relocate(now: number): void {
  const pos = clockPosition(now);
  for (const page of state.show.pages) state.fired.set(page.id, locate(timedCues(page), pos));
  state.prevPos = pos;
}

export function locateTo(frames: number): void {
  if (state.io.source !== 'int') return;
  const now = performance.now();
  state.gen.locate(Math.max(0, frames), now);
  relocate(now);
}

export function togglePlay(): void {
  if (state.io.source !== 'int') return;
  const now = performance.now();
  if (state.gen.running) state.gen.stop(now);
  else state.gen.play(now);
}

/** 選択中（なければ次）の Cue の手前に頭出しして再生する */
export function preroll(): void {
  if (state.io.source !== 'int') return;
  const now = performance.now();
  const cue = goTarget(state.gen.position(now));
  if (!cue || cue.triggerFrame === null) return;
  const lead = secondsToFrames(state.show.settings.standbySec + 5, state.show.frameRate);
  locateTo(Math.floor(cue.triggerFrame + activePage().offsetFrames - lead));
  state.gen.play(performance.now());
}

export function setFrameRate(rate: FrameRate): void {
  const old = state.show.frameRate;
  if (isShowMode() || rate === old) return;
  const next = parseShow(serializeShow(state.show));
  next.frameRate = rate;
  for (const page of next.pages) {
    const sign = page.offsetFrames < 0 ? -1 : 1;
    page.offsetFrames = sign * convertFrameRate(Math.abs(page.offsetFrames), old, rate);
    for (const cue of page.cues) {
      if (cue.triggerFrame !== null) cue.triggerFrame = convertFrameRate(cue.triggerFrame, old, rate);
    }
  }
  replaceShow(next);
}

export function toggleTcIgnore(): void {
  state.tcIgnore = !state.tcIgnore;
}

function persistIo(): void {
  try {
    localStorage.setItem(IO_KEY, JSON.stringify(state.io));
  } catch {
    // 保存できない環境でも動作は続ける
  }
}

export function setIo(patch: Partial<IoPrefs>): void {
  const sourceChanged = patch.source !== undefined && patch.source !== state.io.source;
  Object.assign(state.io, patch);
  persistIo();
  if (sourceChanged) relocate(performance.now());
  notifyChange();
}

/** 受信した MTC を時計に反映し、越えた Cue を実行する */
export function feedMtc(event: MtcEvent, now: number): void {
  state.mtcRate = event.rate;
  // レートが食い違っていても、表示される時刻が送り元と揃うように読み替える
  const whole = Math.floor(event.frames);
  const frames = convertFrameRate(whole, event.rate, state.show.frameRate) + (event.frames - whole);
  if (event.kind === 'locate') state.ext.locate(frames);
  else state.ext.update(frames, now);
  if (state.io.source === 'mtc') engineStep(performance.now());
}

function fire(pageId: string, cue: Cue, manual: boolean): void {
  fireListeners.forEach((fn) => fn({ pageId, cue, manual }));
}

/** タイムコードを進め、越えた Cue を実行する。現在のフレーム位置を返す。 */
export function engineStep(now: number): number {
  const pos = clockPosition(now);
  if (pos === state.prevPos) return pos;
  const opts = {
    jumpFrames: secondsToFrames(JUMP_SEC, state.show.frameRate),
    fireSkipped: state.show.settings.fireSkipped,
  };
  for (const page of state.show.pages) {
    const result = advance(timedCues(page), firedOf(page.id), state.prevPos, pos, opts);
    state.fired.set(page.id, result.fired);
    if (state.tcIgnore || page.tcIgnore) continue;
    for (const id of result.toFire) {
      const cue = page.cues.find((c) => c.id === id);
      if (cue) fire(page.id, cue, false);
    }
  }
  state.prevPos = pos;
  return pos;
}

/** Go ボタン / スペースキー: 対象の Cue を実行し、選択を 1 つ下へ送る */
export function manualGo(): void {
  const page = activePage();
  const cue = goTarget(clockPosition(performance.now()));
  if (!cue) return;
  if (cue.enabled) {
    firedOf(page.id).add(cue.id);
    fire(page.id, cue, true);
  }
  if (state.selectedCueId === cue.id) {
    const below = page.cues[page.cues.indexOf(cue) + 1];
    if (below) selectCue(below.id);
  }
}

// ---------- 選択とページ ----------

export function selectCue(id: string | null): void {
  if (state.selectedCueId === id) return;
  state.selectedCueId = id;
  notifySelection();
}

export function moveSelection(delta: number): void {
  const cues = activePage().cues;
  if (cues.length === 0) return;
  const index = cues.findIndex((c) => c.id === state.selectedCueId);
  const target = index < 0 ? (delta > 0 ? 0 : cues.length - 1) : index + delta;
  const cue = cues[Math.max(0, Math.min(cues.length - 1, target))];
  if (cue) selectCue(cue.id);
}

export function setActivePage(id: string): void {
  if (state.activePageId === id) return;
  state.activePageId = id;
  state.selectedCueId = null;
  notifyChange();
}

export function addPage(): void {
  if (isShowMode()) return;
  const id = newId();
  mutate((show) => {
    show.pages.push(createPage(id, `Page ${show.pages.length + 1}`));
    state.activePageId = id;
    state.selectedCueId = null;
  });
}

export function renamePage(id: string, name: string): void {
  const page = state.show.pages.find((p) => p.id === id);
  const trimmed = name.trim();
  if (isShowMode() || !page || trimmed === '' || trimmed === page.name) return;
  mutate(() => {
    page.name = trimmed;
  });
}

export function deletePage(id: string): void {
  if (isShowMode() || state.show.pages.length <= 1) return;
  mutate((show) => {
    show.pages = show.pages.filter((p) => p.id !== id);
  });
  state.fired.delete(id);
}

/** ページごとのタイムコード無視。ショーモードでも切り替えられる。 */
export function togglePageTcIgnore(id: string): void {
  const page = state.show.pages.find((p) => p.id === id);
  if (!page) return;
  mutate(() => {
    page.tcIgnore = !page.tcIgnore;
  });
}

export function setPageOffset(id: string, offsetFrames: number): void {
  const page = state.show.pages.find((p) => p.id === id);
  if (isShowMode() || !page || page.offsetFrames === offsetFrames) return;
  mutate(() => {
    page.offsetFrames = offsetFrames;
  });
  // 実行される時刻が変わるので、今の位置を基準に通過状態を作り直す
  state.fired.set(page.id, locate(timedCues(page), state.prevPos));
}

// ---------- Cue の編集 ----------

/** 選択中の Cue の下（選択がなければ末尾）に追加し、その id を返す */
export function addCue(): string {
  if (isShowMode()) return '';
  const id = newId();
  mutate(() => {
    const page = activePage();
    const index = page.cues.findIndex((c) => c.id === state.selectedCueId);
    const cue = createCue(id, nextCueNumber(page.cues));
    page.cues.splice(index < 0 ? page.cues.length : index + 1, 0, cue);
    state.selectedCueId = id;
  });
  return id;
}

export function deleteSelectedCue(): void {
  const page = activePage();
  const index = page.cues.findIndex((c) => c.id === state.selectedCueId);
  if (isShowMode() || index < 0) return;
  mutate(() => {
    page.cues.splice(index, 1);
    state.selectedCueId = (page.cues[index] ?? page.cues[index - 1])?.id ?? null;
  });
}

export function updateCue(id: string, patch: Partial<Omit<Cue, 'id'>>): void {
  const cue = activePage().cues.find((c) => c.id === id);
  if (!cue) return;
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.every((k) => cue[k] === patch[k])) return;
  // ショーモードで変えられるのはオン / オフだけ
  if (isShowMode() && keys.some((k) => k !== 'enabled')) return;
  mutate(() => {
    Object.assign(cue, patch);
  });
  if ('triggerFrame' in patch) {
    // 時刻を変えた Cue は、今の位置より先なら再び有効にする
    const page = activePage();
    const fired = firedOf(page.id);
    if (cue.triggerFrame !== null && cue.triggerFrame + page.offsetFrames < state.prevPos) fired.add(id);
    else fired.delete(id);
  }
}

export function moveCue(id: string, toIndex: number): void {
  const page = activePage();
  const from = page.cues.findIndex((c) => c.id === id);
  if (isShowMode() || from < 0 || from === toIndex || toIndex < 0 || toIndex >= page.cues.length) return;
  mutate(() => {
    page.cues = moveItem(page.cues, from, toIndex);
  });
}

export function updateSettings(patch: Partial<Settings>): void {
  // ショーモードで変えられるのは Auto Scroll だけ
  if (isShowMode() && Object.keys(patch).some((k) => k !== 'autoScroll')) return;
  mutate((show) => {
    Object.assign(show.settings, patch);
  });
}

export function updatePageMidi(patch: Partial<MidiTarget>): void {
  if (isShowMode()) return;
  mutate(() => {
    Object.assign(activePage().midi, patch);
  });
}

/**
 * 現在のタイムコードを Trigger Time に取り込む。
 * 選択中の Cue があればその時刻を書き換えて選択を 1 つ下へ送り、
 * なければ末尾に新しい Cue を作る。
 */
export function captureTime(): void {
  if (isShowMode()) return;
  const page = activePage();
  // Trigger Time はページのオフセットを引いた時刻で持つ
  const frames = Math.max(0, Math.floor(clockPosition(performance.now())) - page.offsetFrames);
  const cue = selectedCue();
  if (!cue) {
    mutate(() => {
      page.cues.push({ ...createCue(newId(), nextCueNumber(page.cues)), triggerFrame: frames });
    });
    return;
  }
  updateCue(cue.id, { triggerFrame: frames });
  firedOf(page.id).add(cue.id);
  const below = page.cues[page.cues.indexOf(cue) + 1];
  if (below) selectCue(below.id);
}
