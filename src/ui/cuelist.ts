import {
  activePage,
  addCue,
  canUndo,
  captureTime,
  deleteSelectedCue,
  firedOf,
  isShowMode,
  moveCue,
  nextOf,
  onChange,
  onFire,
  onSelection,
  selectCue,
  setIo,
  state,
  undo,
  updateCue,
  updateSettings,
} from '../app';
import { cueThresholds, stageFor } from '../core/countdown';
import { MIDI_RANGE, type Cue, type MidiTarget } from '../core/show';
import { formatTimecode, framesToSeconds, parseTimecode } from '../core/timecode';
import { clickBlocked, toggleClick } from '../io/click';
import { $, el, replay, setAttr, setText } from './dom';

type TextField = 'number' | 'name' | 'info';
type MidiField = keyof MidiTarget;
type Field = TextField | 'triggerFrame' | 'standbySec' | MidiField;
const MIDI_FIELDS: readonly MidiField[] = ['channel', 'note', 'velocity'];
const FIELDS: readonly Field[] = ['number', 'triggerFrame', 'name', 'info', 'standbySec', ...MIDI_FIELDS];
/** ショーモードでは隠す列 */
const PROGRAM_ONLY: readonly Field[] = ['standbySec', ...MIDI_FIELDS];
const CELL_CLASS: Record<Field, string> = {
  number: 'cue__num',
  triggerFrame: 'cue__time',
  name: 'cue__name',
  info: 'cue__info',
  standbySec: 'cue__stby',
  channel: 'cue__midi',
  note: 'cue__midi',
  velocity: 'cue__midi',
};

const isMidiField = (field: Field): field is MidiField => (MIDI_FIELDS as readonly Field[]).includes(field);

interface RowEls {
  row: HTMLElement;
  bar: HTMLElement;
  cells: Record<Field, HTMLElement>;
}

const rows = new Map<string, RowEls>();
let editing = false;
let lastNextId: string | null = null;
let dragId: string | null = null;

const findCue = (id: string): Cue | undefined => activePage().cues.find((c) => c.id === id);

const timeText = (cue: Cue): string =>
  cue.triggerFrame === null ? '' : formatTimecode(cue.triggerFrame, state.show.frameRate);

export function initCueList(): void {
  const list = $('cue-list');

  $('cue-add').addEventListener('click', () => startEdit(addCue(), 'triggerFrame'));
  $('cue-delete').addEventListener('click', deleteSelectedCue);
  $('undo').addEventListener('click', undo);
  $('capture').addEventListener('click', captureTime);
  $('mode-program').addEventListener('click', () => setIo({ mode: 'program' }));
  $('mode-show').addEventListener('click', () => setIo({ mode: 'show' }));
  $('auto-scroll').addEventListener('click', () =>
    updateSettings({ autoScroll: !state.show.settings.autoScroll }),
  );
  $('click-toggle').addEventListener('click', toggleClick);

  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const id = target.closest<HTMLElement>('.cue')?.dataset.id ?? null;
    const toggle = target.closest('button')?.closest<HTMLElement>('.cue__toggle');
    if (id && toggle) {
      const cue = findCue(id);
      if (cue && toggle.dataset.toggle === 'midiOn') updateCue(id, { midiOn: !cue.midiOn });
      else if (cue) updateCue(id, { enabled: !cue.enabled });
      return;
    }
    if (!target.closest('input')) selectCue(id);
  });

  list.addEventListener('dblclick', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.cue__cell');
    const id = cell?.closest<HTMLElement>('.cue')?.dataset.id;
    const field = cell?.dataset.field as Field | undefined;
    if (id && field && !cell?.querySelector('input')) startEdit(id, field);
  });

  // 見出しの列を行に揃える。スクロールバーの幅は OS の設定で変わる
  const head = list.previousElementSibling as HTMLElement;
  new ResizeObserver(() => {
    head.style.paddingRight = `${list.offsetWidth - list.clientWidth}px`;
  }).observe(list);

  initDrag(list);
  onChange(render);
  onSelection(applySelection);
  onFire((e) => {
    const r = e.pageId === state.activePageId ? rows.get(e.cue.id) : undefined;
    if (r) replay(r.row, 'is-go');
  });
  render();
}

function render(): void {
  const list = $('cue-list');
  const page = activePage();
  rows.clear();
  lastNextId = null;
  editing = false;

  const nodes = page.cues.map((cue) => {
    const row = el('div', 'cue row');
    row.dataset.id = cue.id;
    row.classList.toggle('is-off', !cue.enabled);
    row.classList.toggle('is-midi-off', !cue.midiOn);

    const handle = el('span', 'cue__handle', '⋮⋮');
    handle.draggable = true;
    handle.title = 'Drag to move';

    const cells = {} as Record<Field, HTMLElement>;
    for (const field of FIELDS) {
      const cell = el('div', `cue__cell ${CELL_CLASS[field]}`);
      if (PROGRAM_ONLY.includes(field)) cell.classList.add('prog-only');
      cell.dataset.field = field;
      cells[field] = cell;
    }
    cells.number.textContent = cue.number;
    cells.triggerFrame.textContent = timeText(cue) || '--:--:--:--';
    cells.triggerFrame.classList.toggle('is-empty', cue.triggerFrame === null);
    cells.name.textContent = cue.name;
    cells.info.textContent = cue.info;
    // 未設定なら全体の設定（COUNTDOWN の Standby）を薄く表示する
    cells.standbySec.textContent = String(cue.standbySec ?? state.show.settings.standbySec);
    cells.standbySec.classList.toggle('is-default', cue.standbySec === null);
    for (const field of MIDI_FIELDS) {
      // 未設定の項目はページの初期値を薄く表示する
      cells[field].textContent = String(cue[field] ?? page.midi[field]);
      cells[field].classList.toggle('is-default', cue[field] === null);
    }

    const midiToggle = el('div', 'cue__toggle cue__toggle--midi row__sep prog-only');
    midiToggle.dataset.toggle = 'midiOn';
    const midiButton = el('button', '', cue.midiOn ? 'ON' : 'OFF');
    midiButton.title = 'Send the MIDI Note when this cue fires';
    midiToggle.append(midiButton);

    const toggle = el('div', 'cue__toggle row__sep');
    const button = el('button', '', cue.enabled ? 'ON' : 'OFF');
    button.title = 'Turn this cue on / off';
    toggle.append(button);

    const bar = el('div', 'cue__bar');
    // MIDI のスイッチは、その設定（Ch / Note / Vel）の左に置く
    const [plain, midi] = [FIELDS.filter((f) => !isMidiField(f)), MIDI_FIELDS];
    row.append(handle, ...plain.map((f) => cells[f]), midiToggle, ...midi.map((f) => cells[f]), toggle, bar);
    rows.set(cue.id, { row, bar, cells });
    return row;
  });

  if (nodes.length === 0) {
    list.replaceChildren(el('div', 'cues__empty', 'No cues yet. Use "+ Add Cue" to add one.'));
  } else {
    list.replaceChildren(...nodes);
  }

  $<HTMLButtonElement>('undo').disabled = !canUndo();
  document.body.classList.toggle('is-show', isShowMode());
  $('mode-program').classList.toggle('is-on', !isShowMode());
  $('mode-show').classList.toggle('is-on', isShowMode());
  $('auto-scroll').classList.toggle('is-on', state.show.settings.autoScroll);
  $('click-toggle').classList.toggle('is-on', state.io.clickOn);
  applySelection();
}

function applySelection(): void {
  for (const [id, r] of rows) r.row.classList.toggle('is-selected', id === state.selectedCueId);
  $<HTMLButtonElement>('cue-delete').disabled = state.selectedCueId === null;
  if (state.selectedCueId) rows.get(state.selectedCueId)?.row.scrollIntoView({ block: 'nearest' });
}

/** 選択中の Cue の Trigger Time を編集する（Enter キー） */
export function editSelected(): void {
  if (state.selectedCueId) startEdit(state.selectedCueId, 'triggerFrame');
}

function startEdit(id: string, field: Field): void {
  const cue = findCue(id);
  const cell = rows.get(id)?.cells[field];
  if (isShowMode() || !cue || !cell) return;

  const input = el('input');
  input.spellcheck = false;
  if (field === 'triggerFrame') input.value = timeText(cue);
  else if (isMidiField(field) || field === 'standbySec') input.value = cue[field] === null ? '' : String(cue[field]);
  else input.value = cue[field];
  cell.replaceChildren(input);
  cell.classList.remove('is-empty', 'is-default');
  editing = true;
  selectCue(id);
  input.focus();
  input.select();

  let done = false;
  /** 確定できたら true。Trigger Time が読めない時は編集を続ける。 */
  const finish = (commit: boolean, then?: Field): boolean => {
    if (done) return true;
    let patch: Partial<Cue> | null = null;
    if (commit) {
      const text = input.value.trim();
      if (field === 'triggerFrame') {
        const frames = text === '' ? null : parseTimecode(text, state.show.frameRate);
        if (text !== '' && frames === null) {
          input.classList.add('is-invalid');
          return false;
        }
        patch = { triggerFrame: frames };
      } else if (isMidiField(field)) {
        // 空欄はページの初期値に戻す
        const value = text === '' ? null : Number(text);
        const [min, max] = MIDI_RANGE[field];
        if (value !== null && !(Number.isInteger(value) && value >= min && value <= max)) {
          input.classList.add('is-invalid');
          return false;
        }
        patch = { [field]: value };
      } else if (field === 'standbySec') {
        // 空欄は全体の設定に戻す
        const value = text === '' ? null : Number(text);
        if (value !== null && !(Number.isFinite(value) && value > 0)) {
          input.classList.add('is-invalid');
          return false;
        }
        patch = { standbySec: value };
      } else {
        patch = { [field]: text };
      }
    }
    done = true;
    if (patch) updateCue(id, patch);
    render();
    if (then) startEdit(id, then);
    return true;
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    else if (e.key === 'Tab') {
      e.preventDefault();
      const index = FIELDS.indexOf(field) + (e.shiftKey ? -1 : 1);
      finish(true, FIELDS[index]);
    }
  });
  input.addEventListener('blur', () => {
    if (!finish(true)) finish(false);
  });
}

/** 行の左端のハンドルをつかんで並べ替える */
function initDrag(list: HTMLElement): void {
  const clearMarks = (): void => {
    for (const r of rows.values()) r.row.classList.remove('is-drop-before', 'is-drop-after');
  };

  list.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.cue');
    if (isShowMode() || !row?.dataset.id || !e.dataTransfer) return;
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    e.dataTransfer.setDragImage(row, 14, 20);
  });

  /** ドロップ先の行と、その上下どちらに入れるか */
  const dropTarget = (e: DragEvent): { id: string; after: boolean } | null => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.cue');
    if (!row?.dataset.id) return null;
    const rect = row.getBoundingClientRect();
    return { id: row.dataset.id, after: e.clientY > rect.top + rect.height / 2 };
  };

  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    clearMarks();
    const target = dropTarget(e);
    if (target) rows.get(target.id)?.row.classList.add(target.after ? 'is-drop-after' : 'is-drop-before');
  });

  list.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const target = dropTarget(e);
    const cues = activePage().cues;
    const from = cues.findIndex((c) => c.id === dragId);
    if (target && from >= 0) {
      let to = cues.findIndex((c) => c.id === target.id) + (target.after ? 1 : 0);
      if (from < to) to -= 1;
      moveCue(dragId, to);
    }
  });

  list.addEventListener('dragend', () => {
    dragId = null;
    clearMarks();
  });
}

/** 毎フレーム: 次の Cue の強調、通過済みの表示、行の進捗バー */
const CLICK_TITLE =
  'Play a click at 3, 2 and 1 seconds before the next cue on this page, and a higher tone at GO';

/** 再読み込みの直後など、ブラウザがまだ音を出させてくれない間は、Click ボタンで知らせる */
function updateClickToggle(): void {
  const button = $('click-toggle');
  const blocked = clickBlocked();
  setText(button, blocked ? '⚠ Click' : 'Click');
  button.classList.toggle('is-alert', blocked);
  setAttr(button, 'title', blocked ? 'Sound is blocked by the browser. Click here or anywhere on the page to enable it' : CLICK_TITLE);
}

export function updateCueList(pos: number): void {
  updateClickToggle();
  const page = activePage();
  const fired = firedOf(page.id);
  const { settings, frameRate } = state.show;
  const next = nextOf(page, pos);

  for (const cue of page.cues) {
    const r = rows.get(cue.id);
    if (!r) continue;
    const isNext = cue.id === next?.cue.id;
    // 実際に実行される時刻（ページのオフセット込み）
    const at = cue.triggerFrame === null ? null : cue.triggerFrame + page.offsetFrames;
    const passed = !isNext && (fired.has(cue.id) || (at !== null && at < pos));
    r.row.classList.toggle('is-next', isNext);
    r.row.classList.toggle('is-passed', passed);
    if (isNext && at !== null) {
      const remaining = framesToSeconds(at - pos, frameRate);
      setAttr(r.row, 'data-stage', stageFor(remaining, cueThresholds(cue.standbySec, settings)));
      const progress = Math.max(0, Math.min(1, 1 - remaining / settings.standbySec));
      r.bar.style.width = `${progress * 100}%`;
    } else if (r.bar.style.width !== '') {
      r.bar.style.width = '';
    }
  }

  const nextId = next?.cue.id ?? null;
  if (nextId !== lastNextId) {
    lastNextId = nextId;
    if (nextId && settings.autoScroll && !editing) {
      rows.get(nextId)?.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}
