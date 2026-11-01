// @ts-check
import { constants } from 'node:fs';
import { chmod, copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';

export async function ensureEnvFile(directory) {
 const path = resolve(directory, '.env');
 try {
  await copyFile(resolve(directory, '.env.example'), path, constants.COPYFILE_EXCL);
  await chmod(path, 0o600);
 } catch (error) { if (error.code !== 'EEXIST') throw error; }
 return path;
}

function encode(value) {
 if (/[\r\n\0]/.test(value)) throw Error('환경 변수 값에 줄바꿈을 사용할 수 없습니다.');
 for (const quote of ["'", '`', '"', '']) {
  const encoded = `${quote}${value}${quote}`;
  if ((!quote || !value.includes(quote)) && parseEnv(`VALUE=${encoded}`).VALUE === value) return encoded;
 }
 throw Error('입력값을 .env 형식으로 저장할 수 없습니다.');
}

export async function saveEnvValues(directory, values) {
 const entries = Object.entries(values);
 if (!entries.length) return;
 if (entries.some(([key]) => !/^[A-Z_][A-Z0-9_]*$/.test(key))) throw Error('잘못된 환경 변수 이름입니다.');
 const replacements = new Map(entries.map(([key, value]) => [key, encode(value)]));
 const path = await ensureEnvFile(directory);
 const text = await readFile(path, 'utf8');
 const assignment = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/gm;
 const found = new Set();
 let result = '', cursor = 0, match;
 while ((match = assignment.exec(text))) {
  const start = assignment.lastIndex, quote = text[start];
  const quoted = ["'", '"', '`'].includes(quote);
  const close = quoted ? text.indexOf(quote, start + 1) : start;
  if (close < 0) throw Error('기존 .env의 따옴표를 확인하세요.');
  const nextLine = text.indexOf('\n', close);
  const end = nextLine < 0 ? text.length : nextLine;
  assignment.lastIndex = nextLine < 0 ? text.length : nextLine + 1;
  const key = match[1];
  if (!replacements.has(key)) continue;
  const commentStart = quoted ? close + 1 : text.indexOf('#', start);
  const suffix = commentStart >= start && commentStart < end ? text.slice(commentStart, end) : '';
  result += text.slice(cursor, start) + replacements.get(key) + (suffix ? ` ${suffix.trimStart()}` : '');
  cursor = end;
  found.add(key);
 }
 result += text.slice(cursor);
 for (const [key, value] of replacements) if (!found.has(key)) {
  if (result && !result.endsWith('\n')) result += '\n';
  result += `${key}=${value}\n`;
 }
 const temporary = `${path}.${randomUUID()}.tmp`;
 await writeFile(temporary, result, { flag: 'wx', mode: 0o600 });
 try { await rename(temporary, path); }
 finally { await rm(temporary, { force: true }); }
}
