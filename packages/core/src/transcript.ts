import { randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export interface TranscriptEvent {
  schema_version: 'transcript.v1'; run_id: string; sequence: number; elapsed_ms: number;
  source: 'real_core'; operation: string; event: string; data: Record<string, unknown>;
  content?: unknown;
}
export interface TranscriptRun {
  emit(event: string, data?: Record<string, unknown>, content?: unknown): void;
  close(): void;
}
export interface TranscriptSink { start(operation: string): TranscriptRun }

// Local debug traces only. Content is explicitly enabled and must be reviewed before publication.
export class FileTranscriptSink implements TranscriptSink {
  private readonly directory: string;
  private readonly content: boolean;
  private readonly clock: () => number;
  constructor(directory: string, content = false, clock: () => number = Date.now) {
    this.directory = directory; this.content = content; this.clock = clock;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('TRANSCRIPT_DIRECTORY_NOT_PRIVATE');
  }
  start(operation: string): TranscriptRun {
    const started = this.clock();
    for (const name of readdirSync(this.directory)) {
      if (!/^transcript-[0-9a-f-]{36}\.jsonl$/.test(name)) continue;
      const path = join(this.directory, name), stat = lstatSync(path);
      if (stat.isFile() && !stat.isSymbolicLink() && started - stat.mtimeMs >= 86_400_000) unlinkSync(path);
    }
    const id = randomUUID();
    const fd = openSync(join(this.directory, `transcript-${id}.jsonl`), 'wx', 0o600);
    let sequence = 0, closed = false;
    return {
      emit: (event, data = {}, content) => {
        if (closed) throw new Error('TRANSCRIPT_CLOSED');
        const record: TranscriptEvent = { schema_version: 'transcript.v1', run_id: id, sequence: sequence++,
          elapsed_ms: Math.max(0, this.clock() - started), source: 'real_core', operation, event, data,
          ...(this.content && content !== undefined ? { content } : {}) };
        try {
          const bytes = Buffer.from(JSON.stringify(record) + '\n');
          let offset = 0;
          while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
        } catch { throw new Error('TRANSCRIPT_WRITE_FAILED'); }
      },
      close: () => { if (!closed) { closed = true; closeSync(fd); } },
    };
  }
}
