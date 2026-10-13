import { activePage, engineStep, nextOf, onChange, onFire, state } from '../app';
import { BeatWatcher } from '../core/countdown';
import { framesToSeconds } from '../core/timecode';
import { createCountdownView, type CountdownView } from './countdown';
import { $, el, replay, setAttr, toast } from './dom';

/**
 * セカンドスクリーン用の表示ウィンドウ。カウントダウンとレーンだけを大きく出す。
 * 中身はメインの画面から直接描くので、2 つの画面の数字はずれない。メインの画面を閉じると、表示も閉じる。
 */

interface Display {
  win: Window;
  view: CountdownView;
  time: HTMLElement;
  beat: HTMLElement;
  beats: BeatWatcher;
}

let display: Display | null = null;

function build(win: Window): Display {
  const doc = win.document;
  // 何も書かずに開いたウィンドウは古い描画モードになるので、文書を書き直す
  doc.open();
  doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TC-CD Display</title></head><body></body></html>');
  doc.close();
  for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    doc.head.append(style.cloneNode(true));
  }
  doc.body.className = 'is-display';

  const root = el('div', 'cd dsp');
  const number = el('span', 'cd__number');
  const name = el('span', 'dsp__name');
  const cue = el('div', 'dsp__cue');
  cue.append(el('span', 'lbl', 'NEXT'), number, name);
  const info = el('div', 'dsp__info');
  const time = el('div', 'dsp__time', '--');
  const lane = el('div', 'lane');
  const ticks = el('div', 'lane__ticks');
  const track = el('div', 'lane__track');
  lane.append(el('div', 'lane__zones'), ticks, track, el('div', 'lane__go'));
  const fullscreen = el('button', 'btn btn--icon dsp__fs');
  fullscreen.title = 'Fullscreen (F or double-click)';
  fullscreen.innerHTML = $('fullscreen').innerHTML;
  const beat = el('div', 'dsp__beat');
  root.append(cue, info, time, lane, fullscreen, beat);
  doc.body.append(root);

  const toggleFullscreen = (): void => {
    if (doc.fullscreenElement) void doc.exitFullscreen();
    else void doc.documentElement.requestFullscreen();
  };
  fullscreen.addEventListener('click', () => {
    toggleFullscreen();
    // フォーカスが残ると、スペースキーがこのボタンを押してしまう
    fullscreen.blur();
  });
  doc.addEventListener('fullscreenchange', () => {
    fullscreen.classList.toggle('is-on', doc.fullscreenElement !== null);
  });
  doc.addEventListener('dblclick', (e) => {
    if (!fullscreen.contains(e.target as Node)) toggleFullscreen();
  });
  doc.addEventListener('keydown', (e) => {
    if ((e.key === 'f' || e.key === 'F') && !e.repeat && !e.metaKey && !e.ctrlKey) toggleFullscreen();
  });

  const view = createCountdownView({ root, number, name, info, time, lane, ticks, track });
  view.renderStatic();
  return { win, view, time, beat, beats: new BeatWatcher() };
}

function closed(): void {
  display = null;
  $('display-toggle').classList.remove('is-on');
}

/** 表示ウィンドウ自身の描画のタイミングで動かす。メインの画面が隠れていても止まらない */
function tick(): void {
  const mine = display;
  if (!mine) return;
  if (mine.win.closed) {
    closed();
    return;
  }
  const pos = engineStep(performance.now());
  mine.view.update(pos);
  // クリック音と同じ 3、2、1 秒前に、枠を光らせる
  const next = nextOf(activePage(), pos);
  const remaining = next ? framesToSeconds(next.at - pos, state.show.frameRate) : 0;
  if (mine.beats.step(next?.cue.id ?? null, remaining) !== null) replay(mine.beat, 'is-on');
  // 1 時間を越える表示は桁が多いので、文字を小さくして収める
  setAttr(mine.time, 'data-long', String((mine.time.textContent ?? '').length > 5));
  mine.win.requestAnimationFrame(tick);
}

function open(): void {
  const win = window.open('', 'tc-cd-display', 'popup,width=1280,height=720');
  if (!win) {
    toast('Display window was blocked. Allow pop-ups for this page', true);
    return;
  }
  display = build(win);
  win.addEventListener('pagehide', () => {
    if (display?.win === win) closed();
  });
  $('display-toggle').classList.add('is-on');
  win.requestAnimationFrame(tick);
}

export function initDisplay(): void {
  $('display-toggle').addEventListener('click', () => {
    if (display) display.win.close();
    else open();
  });
  onChange(() => display?.view.renderStatic());
  onFire((e) => {
    if (e.pageId === state.activePageId) display?.view.go();
  });
  // メインの画面を閉じたり読み込み直したりすると描けなくなるので、一緒に閉じる
  window.addEventListener('pagehide', () => display?.win.close());
}
