import { createHash } from 'node:crypto';
import type { Draft, FactPack } from '@safehandoff/core-interface';
import { deny } from './workflow-session.ts';
export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export interface PublicFile { path: string; media_type: string; bytes: string; size: number; sha256: string }
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 32768 && Buffer.from(v).toString('utf8') === v;
const escaped = (v: string) => v.replace(/[\\`*_{}\[\]()#+.!<>|&]/g, c => c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '\\' + c);
export function validateDocument(draft: Draft, pack: FactPack): void {
  if (!draft || draft.schema_version !== 'draft.v1' || Object.keys(draft).sort().join(',') !== 'blocks,schema_version' ||
    !Array.isArray(draft.blocks) || !draft.blocks.length || draft.blocks.length > 60) deny(400, 'INVALID_DRAFT');
  const facts = new Set(pack.facts.map(f => f.id)), used = new Set<string>(), blocks = new Set<string>();
  const refs = (ids: unknown) => {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !facts.has(id))) deny(400, 'INVALID_DRAFT');
    ids.forEach(id => used.add(id));
  };
  for (const b of draft.blocks) {
    if (!b || typeof b !== 'object' || !['heading', 'paragraph', 'list', 'table_ref'].includes(b.type)) deny(400, 'INVALID_DRAFT');
    const allowed = ['type', 'block_id', 'fact_ids', ...(b.type === 'heading' ? ['text', 'level', 'fact_ids'] : b.type === 'paragraph' ? ['text', 'fact_ids'] : b.type === 'list' ? ['items'] : ['table_id'])];
    if (Object.keys(b).some(k => !allowed.includes(k))) deny(400, 'INVALID_DRAFT');
    if (b.fact_ids !== undefined) refs(b.fact_ids);
    if (b.block_id !== undefined) { if (!text(b.block_id) || !b.block_id || blocks.has(b.block_id)) deny(400, 'INVALID_DRAFT'); blocks.add(b.block_id); }
    if (b.type === 'heading' || b.type === 'paragraph') {
      if (!text(b.text) || !b.text.trim() || (b.type === 'heading' && (!Number.isInteger(b.level) || b.level! < 1 || b.level! > 6))) deny(400, 'INVALID_DRAFT');
      if (b.fact_ids !== undefined) refs(b.fact_ids);
      if (b.type === 'paragraph' && !b.fact_ids?.length) deny(400, 'INVALID_DRAFT');
    } else if (b.type === 'list') {
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) deny(400, 'INVALID_DRAFT');
      for (const item of b.items) {
        if (!item || Object.keys(item).sort().join(',') !== 'fact_ids,text' || !text(item.text) || !item.text.trim() || !item.fact_ids?.length) deny(400, 'INVALID_DRAFT'); refs(item.fact_ids);
      }
    } else {
      const table = pack.tables.find(t => t.id === b.table_id); if (!table) deny(400, 'INVALID_DRAFT'); used.add(table.id);
    }
  }
  if (pack.required_fact_ids.some(id => !used.has(id))) deny(400, 'MISSING_REQUIRED_FACT');
  if (pack.asset_slots.length || pack.excerpt_slots.length || pack.public_tool_results.length) deny(422, 'UNSUPPORTED_PUBLIC_SLOT');
}
function file(path: string, media_type: string, value: string): PublicFile {
  const bytes = Buffer.from(value); return { path, media_type, bytes: bytes.toString('base64'), size: bytes.length, sha256: digest(bytes) };
}
function csvCell(value: string): string {
  const numeric = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
  const protectedValue = /^[\s]*[=+\-@]/.test(value) && !numeric ? "'" + value : value;
  return '"' + protectedValue.replaceAll('"', '""') + '"';
}
export function renderFiles(draft: Draft, pack: FactPack): { files: PublicFile[]; document_hash: string; artifact_set_hash: string } {
  validateDocument(draft, pack);
  const tables = new Map(pack.tables.map((t, i) => [t.id, { table: t, path: `observations-${String(i + 1).padStart(3, '0')}.csv` }]));
  const markdown = draft.blocks.map(b => {
    if (b.type === 'heading') return '#'.repeat(b.level!) + ' ' + escaped(b.text!);
    if (b.type === 'paragraph') return escaped(b.text!);
    if (b.type === 'list') return b.items!.map(i => '- ' + escaped(i.text)).join('\n');
    const entry = tables.get(b.table_id!)!; return `[표 ${[...tables.keys()].indexOf(b.table_id!) + 1}](${entry.path})`;
  }).join('\n\n') + '\n';
  const files = [file('support-request.md', 'text/markdown; charset=utf-8', markdown)];
  const referenced = new Set(draft.blocks.filter(b => b.type === 'table_ref').map(b => b.table_id));
  for (const [id, entry] of tables) if (referenced.has(id)) files.push(file(entry.path, 'text/csv; charset=utf-8',
    [entry.table.columns, ...entry.table.rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'));
  files.sort((a, b) => a.path < b.path ? -1 : 1);
  const metadata = (f: PublicFile) => ({ path: f.path, size: f.size, sha256: f.sha256 });
  files.push(file('manifest.json', 'application/json', JSON.stringify({ files: files.map(metadata) }) + '\n'));
  files.sort((a, b) => a.path < b.path ? -1 : 1);
  if (files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024) deny(413, 'EXPORT_TOO_LARGE');
  return { files, document_hash: digest(JSON.stringify(draft)), artifact_set_hash: digest(JSON.stringify(files.map(metadata))) };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function archive(files: PublicFile[]): Buffer {
  if (!Array.isArray(files) || !files.length || files.length > 102) deny(400, 'INVALID_EXPORT_FILES');
  const local: Buffer[] = [], central: Buffer[] = [], names = new Set<string>(); let offset = 0;
  for (const f of [...files].sort((a, b) => a.path < b.path ? -1 : 1)) {
    if (!f || Object.keys(f).sort().join(',') !== 'bytes,media_type,path,sha256,size') deny(400, 'INVALID_EXPORT_FILES');
    if (!/^(?:support-request\.md|manifest\.json|observations-\d{3}\.csv)$/.test(f.path) || names.has(f.path)) deny(400, 'INVALID_EXPORT_FILES');
    names.add(f.path); const bytes = Buffer.from(f.bytes, 'base64'), name = Buffer.from(f.path);
    if (bytes.toString('base64') !== f.bytes || bytes.length !== f.size || digest(bytes) !== f.sha256) deny(400, 'INVALID_EXPORT_FILES');
    const crc = crc32(bytes), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(bytes.length, 18); h.writeUInt32LE(bytes.length, 22); h.writeUInt16LE(name.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(bytes.length, 20); c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    local.push(h, name, bytes); central.push(c, name); offset += h.length + name.length + bytes.length;
    if (offset > 20 * 1024 * 1024) deny(413, 'EXPORT_TOO_LARGE');
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const bytes = Buffer.concat([...local, directory, end]);
  if (bytes.length > 20 * 1024 * 1024) deny(413, 'EXPORT_TOO_LARGE');
  return bytes;
}
