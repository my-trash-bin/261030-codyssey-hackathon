import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 화면 스타일이 토큰을 통해서만 값을 쓰는지 확인한다.
 * 새 값을 직접 적으면 실패하므로, 색/간격이 다시 파편화되는 것을 막는다.
 */

const STYLE_FILES = ['style.css', 'flow.css', 'app-shell.css', 'disclosure.css', 'design-system.css'];
const dir = new URL('../../public/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, dir), 'utf8');

function definedTokens(): Set<string> {
  const names = new Set<string>();
  for (const file of ['tokens.css', ...STYLE_FILES]) {
    for (const match of read(file).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) names.add(match[1]!);
  }
  return names;
}

function usedTokens(): Map<string, string> {
  const used = new Map<string, string>();
  for (const file of ['tokens.css', ...STYLE_FILES]) {
    for (const match of read(file).matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (!used.has(match[1]!)) used.set(match[1]!, file);
    }
  }
  return used;
}

test('every var(--token) used by the stylesheets is defined', () => {
  const defined = definedTokens();
  const missing = [...usedTokens()].filter(([name]) => !defined.has(name));
  assert.deepEqual(missing, [], `정의되지 않은 토큰: ${missing.map(([name, file]) => `${name} (${file})`).join(', ')}`);
});

test('colors live only in the token file', () => {
  const offenders: string[] = [];
  for (const file of STYLE_FILES) {
    for (const match of read(file).matchAll(/#[0-9a-fA-F]{3,8}\b/g)) offenders.push(`${file}: ${match[0]}`);
  }
  assert.deepEqual(offenders, [], `토큰 밖의 색 값: ${offenders.join(', ')}`);
});

test('spacing and font sizes in stylesheets come from tokens', () => {
  const offenders: string[] = [];
  for (const file of STYLE_FILES) {
    for (const line of read(file).split('\n')) {
      if (line.trimStart().startsWith('@media')) continue;
      const match = /^\s*(padding|margin|gap|row-gap|column-gap|font-size|line-height|letter-spacing|border-radius|outline-offset):\s*(.+);$/.exec(line);
      if (!match) continue;
      const value = match[2]!.trim();
      // 0, auto, normal 같은 값은 눈금이 필요 없다. 숫자나 색을 직접 적은 경우만 잡는다.
      if (/^(0|auto|normal|none|inherit|transparent|0 auto)$/.test(value)) continue;
      if (/var\(--/.test(value)) continue;
      offenders.push(`${file}: ${match[1]}: ${value}`);
    }
  }
  assert.deepEqual(offenders, [], `토큰을 쓰지 않은 값: ${offenders.join(' | ')}`);
});
