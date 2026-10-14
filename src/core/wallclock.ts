import { nominalFps, timecodeToFrames, type FrameRate } from './timecode';

/** その秒の最初のフレーム。ドロップフレームで ;00 が存在しない秒は ;02 から始まる */
function secondStart(seconds: number, rate: FrameRate): number {
  const [hh, mm, ss] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return timecodeToFrames(hh, mm, ss, 0, rate) ?? timecodeToFrames(hh, mm, ss, 2, rate) ?? 0;
}

/**
 * 時計の時刻を、同じ時・分・秒が表示されるタイムコードのフレーム位置（小数を含む）にする。
 * 1 秒未満の時間は、その秒のフレームの中を一定の速さで進む。
 */
export function timeOfDayFrames(hh: number, mm: number, ss: number, ms: number, rate: FrameRate): number {
  const seconds = hh * 3600 + mm * 60 + ss;
  const start = secondStart(seconds, rate);
  // 1 日の最後の秒には次の秒がないので、通常の 1 秒分の長さを使う
  const end = seconds + 1 < 86400 ? secondStart(seconds + 1, rate) : start + nominalFps(rate);
  return start + (ms / 1000) * (end - start);
}
