import { CoreError } from './index.ts';
export interface CSVCell { row: number; column: string; start: number; end: number; value: string }
// Offsets are UTF-16 indices in text; callers convert to UTF-8 byte offsets when binding evidence.
export function csvCells(text: string): CSVCell[] {
  const invalid = (): never => { throw new CoreError('INVALID_CORE_INPUT'); };
  if (!text.length) invalid();
  const result: CSVCell[] = []; let i = 0, row = 0, headers: string[] = [];
  while (i < text.length) {
    const cells: { start: number; end: number; value: string }[] = [];
    while (true) {
      const start = i; let value = '';
      if (text[i] === '"') {
        i++; let closed = false;
        while (i < text.length) {
          if (text[i] === '"') { if (text[i + 1] === '"') { value += '"'; i += 2; } else { i++; closed = true; break; } }
          else value += text[i++];
        }
        if (!closed) invalid();
      } else {
        while (i < text.length && ![',', '\r', '\n'].includes(text[i]!)) { if (text[i] === '"') invalid(); value += text[i++]; }
      }
      if (i < text.length && ![',', '\r', '\n'].includes(text[i]!)) invalid();
      cells.push({ start, end: i, value }); if (cells.length > 100) invalid();
      if (text[i] !== ',') break; i++;
    }
    row++;
    if (row === 1) {
      headers = cells.map(c => c.value);
      if (headers.some(h => !h || h.length > 8192) || new Set(headers).size !== headers.length) invalid();
    } else {
      if (cells.length !== headers.length) invalid();
      cells.forEach((c, index) => result.push({ ...c, row, column: headers[index]! }));
      if (result.length > 100) invalid();
    }
    if (text[i] === '\r') { i++; if (text[i] === '\n') i++; } else if (text[i] === '\n') i++;
    if (row > 101) invalid();
  }
  return result;
}
