// ビルド済みのシミュレーションを Node.js で実行する（npm run build -w @bokoboko/sim のあと）
// 使い方: npm run sim -w @bokoboko/sim -- grid --games 300 --out results/grid.jsonl
import { register } from 'node:module';

register('./resolve-hook.mjs', import.meta.url);
await import('../dist/packages/sim/src/cli.js');
