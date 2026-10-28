import { $ } from './dom';

/** スマホやタブレットで開いた時に、PC での利用を想定している旨を伝える */
export function initPhoneNotice(): void {
  // 画面幅は 1280px に固定しているので幅では見分けられない。マウスがなくタッチで操作する端末を対象にする
  if (!matchMedia('(hover: none) and (pointer: coarse)').matches) return;
  $<HTMLDialogElement>('phone-dialog').showModal();
}
