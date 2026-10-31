import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Document {
  id: string;
  text: string;
  createdAt: string;
}

export class DocumentStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  save(text: string): Document {
    const document = { id: randomUUID(), text, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO documents (id, text, created_at) VALUES (?, ?, ?)')
      .run(document.id, document.text, document.createdAt);
    return document;
  }

  list(): Document[] {
    return this.db.prepare('SELECT id, text, created_at AS createdAt FROM documents ORDER BY rowid DESC')
      .all() as unknown as Document[];
  }

  close(): void { this.db.close(); }
}
