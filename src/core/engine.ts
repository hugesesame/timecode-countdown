export interface EngineCue {
  id: string;
  triggerFrame: number | null;
  enabled: boolean;
}

export interface AdvanceOptions {
  /** これより大きく先に進んだら「飛んだ」と見なすフレーム数 */
  jumpFrames: number;
  /** 先に飛んだ時、飛び越えた Cue も実行するか */
  fireSkipped: boolean;
}

export interface AdvanceResult {
  /** 実行済み・通過済みの Cue の id */
  fired: Set<string>;
  /** 今回実行する Cue の id（Trigger Time の順） */
  toFire: string[];
}

/** 頭出しした時の状態: 位置より前の Cue は通過済み、位置以降は有効 */
export function locate(cues: readonly EngineCue[], pos: number): Set<string> {
  const fired = new Set<string>();
  for (const c of cues) {
    if (c.triggerFrame !== null && c.triggerFrame < pos) fired.add(c.id);
  }
  return fired;
}

/** タイムコードが prev から next に動いた時に、実行する Cue と新しい状態を返す */
export function advance(
  cues: readonly EngineCue[],
  fired: ReadonlySet<string>,
  prev: number,
  next: number,
  opts: AdvanceOptions,
): AdvanceResult {
  if (next < prev) return { fired: locate(cues, next), toFire: [] };

  const jumped = next - prev > opts.jumpFrames;
  // 連続して進んだ時は今回の区間だけ、飛び越えも実行する設定なら過去すべてが対象
  const from = jumped ? (opts.fireSkipped ? -Infinity : Infinity) : prev;

  const nextFired = new Set(fired);
  const hits: { id: string; at: number }[] = [];
  for (const c of cues) {
    const at = c.triggerFrame;
    if (at === null || at > next || nextFired.has(c.id)) continue;
    // 飛んだ先ちょうどの Cue は、そこから再生が始まった時に実行する
    if (jumped && !opts.fireSkipped && at === next) continue;
    nextFired.add(c.id);
    if (c.enabled && at >= from) hits.push({ id: c.id, at });
  }
  hits.sort((a, b) => a.at - b.at);
  return { fired: nextFired, toFire: hits.map((h) => h.id) };
}

/** ページのオフセットを足した、実際に Cue を実行する時刻の一覧にする */
export function withOffset(cues: readonly EngineCue[], offsetFrames: number): EngineCue[] {
  return cues.map((c) => ({
    id: c.id,
    triggerFrame: c.triggerFrame === null ? null : c.triggerFrame + offsetFrames,
    enabled: c.enabled,
  }));
}
