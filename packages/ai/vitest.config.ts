import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 通しプレイのテストは数万手を回すので、既定の5秒では足りない
    testTimeout: 120_000,
  },
});
