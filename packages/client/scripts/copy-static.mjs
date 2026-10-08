// ビルド後に index.html と style.css を dist にコピーする（依存パッケージなし）
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
for (const file of ['index.html', 'style.css']) {
  copyFileSync(join(root, file), join(dist, file));
}
console.log('copied static files to dist/');
