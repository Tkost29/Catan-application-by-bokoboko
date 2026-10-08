// 開発用: TypeScript を監視ビルドしながら dist を http://localhost:5173 で配信する（依存パッケージなし）
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync, watch, copyFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const port = Number(process.env.PORT ?? 5173);

spawnSync('node', [join(root, 'scripts/copy-static.mjs')], { stdio: 'inherit' });
for (const file of ['index.html', 'style.css']) {
  watch(join(root, file), () => copyFileSync(join(root, file), join(dist, file)));
}
const tsc = spawn('npx', ['tsc', '-p', join(root, 'tsconfig.build.json'), '--watch', '--preserveWatchOutput'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.on('exit', () => tsc.kill());

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!path.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(path).pipe(res);
}).listen(port, () => console.log(`\n  http://localhost:${port} で開けます\n`));
