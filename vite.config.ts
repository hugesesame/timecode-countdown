import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// ビルド結果を dist/index.html の一枚にまとめる
export default defineConfig({
  plugins: [viteSingleFile()],
  base: './',
});
