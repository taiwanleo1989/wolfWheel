// 網頁端的 JS 沒辦法在 Node 裡直接跑（要 DOM），至少確認語法沒壞——壞了整頁會白掉、什麼都不顯示。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function jsFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'vendor' ? [] : jsFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

for (const file of jsFiles('public')) {
  test(`語法正確：${file}`, () => {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }));
  });
}
