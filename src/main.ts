import './style.css';
import {
  activePage,
  captureTime,
  engineStep,
  manualGo,
  moveCue,
  moveSelection,
  selectCue,
  state,
  undo,
} from './app';
import { initClick } from './io/click';
import { initMidi } from './io/midi';
import { editSelected, initCueList, updateCueList } from './ui/cuelist';
import { initHeader, updateHeader } from './ui/header';
import { $ } from './ui/dom';
import { initSide, updateSide } from './ui/side';

initHeader();
initCueList();
initSide();
initMidi();
initClick();

function frame(): void {
  const now = performance.now();
  const pos = engineStep(now);
  updateHeader(now, pos);
  updateCueList(pos);
  updateSide(pos);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// タブが裏に回ると描画は止まるので、Cue の実行だけは別のタイマーで続ける
setInterval(() => {
  if (document.hidden) engineStep(performance.now());
}, 250);

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}
$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').classList.toggle('is-on', document.fullscreenElement !== null);
});

function moveSelectedCue(delta: number): void {
  const cues = activePage().cues;
  const index = cues.findIndex((c) => c.id === state.selectedCueId);
  if (index >= 0 && state.selectedCueId) moveCue(state.selectedCueId, index + delta);
}

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  // ダイアログが開いている間は、Go などのショートカットを効かせない
  if (document.querySelector('dialog[open]')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (!e.repeat) manualGo();
      break;
    case 'ArrowDown':
    case 'ArrowUp': {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      if (e.altKey) moveSelectedCue(delta);
      else moveSelection(delta);
      break;
    }
    case 'Enter':
      e.preventDefault();
      editSelected();
      break;
    case 'c':
    case 'C':
      if (!e.repeat) captureTime();
      break;
    case 'f':
    case 'F':
      if (!e.repeat) toggleFullscreen();
      break;
    case 'Escape':
      selectCue(null);
      break;
  }
});

// クリックしたボタンにフォーカスが残ると、スペースキーがそのボタンを押してしまう
document.addEventListener('click', (e) => {
  (e.target as HTMLElement).closest('button')?.blur();
});
