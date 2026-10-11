export type FrameRate = '24' | '25' | '29.97df' | '30';

export const FRAME_RATES: readonly FrameRate[] = ['24', '25', '29.97df', '30'];

export const FRAME_RATE_LABELS: Record<FrameRate, string> = {
  '24': '24',
  '25': '25',
  '29.97df': '29.97 DF',
  '30': '30',
};

/** タイムコードの FF が数える 1 秒あたりのコマ数 */
export function nominalFps(rate: FrameRate): number {
  return rate === '24' ? 24 : rate === '25' ? 25 : 30;
}

/** 実時間での 1 秒あたりのコマ数 */
export function realFps(rate: FrameRate): number {
  return rate === '29.97df' ? 30000 / 1001 : nominalFps(rate);
}

export function framesToSeconds(frames: number, rate: FrameRate): number {
  return frames / realFps(rate);
}

export function secondsToFrames(seconds: number, rate: FrameRate): number {
  return seconds * realFps(rate);
}

// ドロップフレーム: 毎分 2 コマ飛ばす、ただし 10 分ごとは飛ばさない
const DF_FRAMES_PER_MIN = 30 * 60 - 2;
const DF_FRAMES_PER_10MIN = 30 * 600 - 18;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** フレーム数を [時, 分, 秒, フレーム] に分ける */
export function framesToParts(frames: number, rate: FrameRate): [number, number, number, number] {
  let f = Math.max(0, Math.floor(frames));
  const fps = nominalFps(rate);
  if (rate === '29.97df') {
    const tenMins = Math.floor(f / DF_FRAMES_PER_10MIN);
    const rest = f % DF_FRAMES_PER_10MIN;
    f += 18 * tenMins;
    if (rest >= 2) f += 2 * Math.floor((rest - 2) / DF_FRAMES_PER_MIN);
  }
  return [Math.floor(f / (fps * 3600)), Math.floor(f / (fps * 60)) % 60, Math.floor(f / fps) % 60, f % fps];
}

export function formatTimecode(frames: number, rate: FrameRate): string {
  const [hh, mm, ss, ff] = framesToParts(frames, rate);
  const sep = rate === '29.97df' ? ';' : ':';
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}${sep}${pad2(ff)}`;
}

/**
 * "HH:MM:SS:FF"（区切りは : ; . のどれでも可）か、数字だけの右詰め入力
 * （"1000" -> 00:00:10:00）をフレーム数にする。解釈できなければ null。
 */
export function parseTimecode(text: string, rate: FrameRate): number | null {
  const s = text.trim();
  let parts: string[];
  if (/^\d{1,8}$/.test(s)) {
    const d = s.padStart(8, '0');
    parts = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6), d.slice(6, 8)];
  } else if (/^\d{1,2}([:;.]\d{1,2}){3}$/.test(s)) {
    parts = s.split(/[:;.]/);
  } else {
    return null;
  }
  const [hh, mm, ss, ff] = parts.map(Number) as [number, number, number, number];
  return timecodeToFrames(hh, mm, ss, ff, rate);
}

/** 時・分・秒・フレームの数値をフレーム数にする。存在しない時刻なら null。 */
export function timecodeToFrames(hh: number, mm: number, ss: number, ff: number, rate: FrameRate): number | null {
  const fps = nominalFps(rate);
  if (hh >= 24 || mm >= 60 || ss >= 60 || ff >= fps) return null;

  let frames = (hh * 3600 + mm * 60 + ss) * fps + ff;
  if (rate === '29.97df') {
    if (ss === 0 && ff < 2 && mm % 10 !== 0) return null;
    const totalMins = hh * 60 + mm;
    frames -= 2 * (totalMins - Math.floor(totalMins / 10));
  }
  return frames;
}

/**
 * フレームレートを切り替えた時に、表示されている HH:MM:SS:FF を保ったまま
 * 新しいレートでのフレーム数に直す。
 */
export function convertFrameRate(frames: number, from: FrameRate, to: FrameRate): number {
  if (from === to) return frames;
  const [hh, mm, ss, ff] = formatTimecode(frames, from).split(/[:;]/) as [string, string, string, string];
  const clamped = Math.min(Number(ff), nominalFps(to) - 1);
  const head = `${hh}:${mm}:${ss}:`;
  // ドロップフレームで存在しない :00 と :01 は直後の :02 に寄せる
  return parseTimecode(head + pad2(clamped), to) ?? parseTimecode(head + '02', to) ?? 0;
}

/** 符号付きのオフセット（"-00:00:10:00" など）をフレーム数にする。空欄は 0、読めなければ null。 */
export function parseOffset(text: string, rate: FrameRate): number | null {
  const s = text.trim();
  if (s === '') return 0;
  const negative = s.startsWith('-');
  const frames = parseTimecode(/^[+-]/.test(s) ? s.slice(1) : s, rate);
  if (frames === null) return null;
  return negative ? -frames : frames;
}

export function formatOffset(frames: number, rate: FrameRate): string {
  return (frames < 0 ? '-' : '+') + formatTimecode(Math.abs(frames), rate);
}
