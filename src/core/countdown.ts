import type { EngineCue } from './engine';
import { framesToSeconds, type FrameRate } from './timecode';

export type Stage = 'idle' | 'standby' | 'warn' | 'final';

export interface StageThresholds {
  standbySec: number;
  warnSec: number;
  finalSec: number;
}

/** これから来る Cue を Trigger Time の順に返す（同じ時刻ならリストの順） */
function upcoming<T extends EngineCue>(cues: readonly T[], fired: ReadonlySet<string>, pos: number): T[] {
  return cues
    .filter((c) => c.enabled && c.triggerFrame !== null && c.triggerFrame >= pos && !fired.has(c.id))
    .sort((a, b) => (a.triggerFrame as number) - (b.triggerFrame as number));
}

export function nextCue<T extends EngineCue>(
  cues: readonly T[],
  fired: ReadonlySet<string>,
  pos: number,
): T | null {
  return upcoming(cues, fired, pos)[0] ?? null;
}

export function stageFor(remainingSec: number, t: StageThresholds): Stage {
  if (remainingSec <= t.finalSec) return 'final';
  if (remainingSec <= t.warnSec) return 'warn';
  if (remainingSec <= t.standbySec) return 'standby';
  return 'idle';
}

/** Cue ごとの設定を反映した、色が変わる秒数 */
export function cueThresholds(cueStandbySec: number | null, settings: StageThresholds): StageThresholds {
  const standbySec = cueStandbySec ?? settings.standbySec;
  const warnSec = Math.min(settings.warnSec, standbySec);
  return { standbySec, warnSec, finalSec: Math.min(settings.finalSec, warnSec) };
}

/** whole: 整数（端数は切り上げ、0 になった瞬間が GO） / tenths: 1 分未満は 10 分の 1 秒まで */
export type CountdownStyle = 'whole' | 'tenths';

export function formatCountdown(seconds: number, style: CountdownStyle = 'tenths'): string {
  const s = Math.max(0, seconds);
  if (style === 'tenths' && s < 60) return (Math.floor(s * 10) / 10).toFixed(1);
  // 計算の誤差で 3.0000001 が 4 にならないよう、わずかに引いてから切り上げる
  const whole = style === 'whole' ? Math.ceil(s - 1e-9) : Math.floor(s);
  if (whole < 60) return String(whole);
  const ss = String(whole % 60).padStart(2, '0');
  const m = Math.floor(whole / 60);
  if (m < 60) return `${m}:${ss}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${ss}`;
}

export interface LaneMarker {
  id: string;
  /** 0 = レーンの入口、1 = GO ライン */
  progress: number;
}

/** 窓の中にいる Cue を GO に近い順に返す */
export function laneMarkers(
  cues: readonly EngineCue[],
  fired: ReadonlySet<string>,
  pos: number,
  rate: FrameRate,
  windowSec: number,
): LaneMarker[] {
  const markers: LaneMarker[] = [];
  for (const c of upcoming(cues, fired, pos)) {
    const remaining = framesToSeconds((c.triggerFrame as number) - pos, rate);
    if (remaining > windowSec) break;
    markers.push({ id: c.id, progress: 1 - remaining / windowSec });
  }
  return markers;
}
