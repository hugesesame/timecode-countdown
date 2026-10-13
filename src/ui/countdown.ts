import { activePage, firedOf, nextOf, state, timedCues } from '../app';
import { cueThresholds, formatCountdown, laneMarkers, stageFor } from '../core/countdown';
import { framesToSeconds } from '../core/timecode';
import { el, replay, setAttr, setText } from './dom';

export interface CountdownEls {
  /** 色の段階（data-stage）と GO の点滅を付ける枠 */
  root: HTMLElement;
  number: HTMLElement;
  name: HTMLElement;
  info?: HTMLElement;
  time: HTMLElement;
  lane: HTMLElement;
  ticks: HTMLElement;
  track: HTMLElement;
}

export interface CountdownView {
  /** 設定が変わった時だけ作り直す部分: レーンの目盛り */
  renderStatic(): void;
  /** 毎フレーム呼ぶ */
  update(pos: number): void;
  /** GO の合図を出す */
  go(): void;
}

/** 前面のページのカウントダウンとレーンを、渡された要素に描く。メインの画面と表示ウィンドウで共通 */
export function createCountdownView(els: CountdownEls): CountdownView {
  const markerEls = new Map<string, HTMLElement>();

  function renderStatic(): void {
    const { standbySec, warnSec, finalSec } = state.show.settings;
    const at = (sec: number): number => (1 - Math.min(sec, standbySec) / standbySec) * 100;
    els.lane.style.setProperty('--warn-pos', `${at(warnSec)}%`);
    els.lane.style.setProperty('--final-pos', `${at(finalSec)}%`);

    els.ticks.replaceChildren();
    const labelled = new Set([standbySec, warnSec, finalSec]);
    for (let sec = Math.floor(standbySec); sec >= 1; sec--) {
      const tick = el('div', labelled.has(sec) ? 'lane__tick lane__tick--major' : 'lane__tick');
      tick.style.left = `${at(sec)}%`;
      if (labelled.has(sec)) tick.append(el('span', '', String(sec)));
      els.ticks.append(tick);
    }
  }

  function update(pos: number): void {
    const { frameRate, settings } = state.show;
    const page = activePage();

    const next = nextOf(page, pos);
    if (next) {
      const remaining = framesToSeconds(next.at - pos, frameRate);
      setAttr(els.root, 'data-stage', stageFor(remaining, cueThresholds(next.cue.standbySec, settings)));
      setText(els.number, next.cue.number || '—');
      setText(els.name, next.cue.name);
      if (els.info) setText(els.info, next.cue.info);
      setText(els.time, formatCountdown(remaining, state.io.countdownStyle));
    } else {
      setAttr(els.root, 'data-stage', 'none');
      setText(els.number, '—');
      setText(els.name, '');
      if (els.info) setText(els.info, '');
      setText(els.time, '--');
    }

    const markers = laneMarkers(timedCues(page), firedOf(page.id), pos, frameRate, settings.standbySec);
    const alive = new Set<string>();
    for (const m of markers) {
      alive.add(m.id);
      let node = markerEls.get(m.id);
      if (!node) {
        node = el('div', 'lane__marker');
        node.append(el('span', 'lane__chip'));
        markerEls.set(m.id, node);
        els.track.append(node);
      }
      const cue = page.cues.find((c) => c.id === m.id);
      setText(node.firstElementChild as HTMLElement, cue?.number || '•');
      node.style.left = `${m.progress * 100}%`;
      const thresholds = cueThresholds(cue?.standbySec ?? null, settings);
      setAttr(node, 'data-stage', stageFor((1 - m.progress) * settings.standbySec, thresholds));
    }
    for (const [id, node] of markerEls) {
      if (alive.has(id)) continue;
      node.remove();
      markerEls.delete(id);
    }
  }

  function go(): void {
    replay(els.root, 'is-go');
    replay(els.lane, 'is-go');
  }

  return { renderStatic, update, go };
}
