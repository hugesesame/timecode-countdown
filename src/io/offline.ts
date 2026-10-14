/**
 * 公開版を、回線のない場所でも開き直せるようにする（public/sw.js）。
 * 開発サーバーでは使わない。ファイルを直接開いた時は登録に失敗するので、何もしない。
 */
export function initOffline(onReady: () => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // ページの保存が済むまで、sw.js は有効にならない
  void navigator.serviceWorker.ready.then(onReady);
}
