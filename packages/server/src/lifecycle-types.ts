import type { DatabaseSync } from 'node:sqlite';
import type { StoredTask, TaskStore } from './task-store.ts';
export interface LifecycleHooks {
  transaction<T>(work: () => T): T;
  advance(task: StoredTask): StoredTask;
  now(): string;
}
export interface LifecycleContext { db: DatabaseSync; store: TaskStore; hooks: LifecycleHooks }
