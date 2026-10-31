import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../internal/labweb/static/state.js', import.meta.url), 'utf8');
const { Workspace } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const result = () => ({ document: { title: 'title', body: 'body' }, review: { pass: true, issues: [] } });
test('approval changes reject late generation and block stale downloads', () => {
  const state = new Workspace(), ticket = state.ticket();
  state.invalidate();
  assert.equal(state.apply(ticket, result()), false);
  assert.equal(state.downloadable(true), false);
  assert.equal(state.apply(state.ticket(), result()), true);
  assert.equal(state.downloadable(false), false);
  assert.equal(state.downloadable(true), true);
  state.invalidate();
  assert.equal(state.downloadable(true), false);
});
test('editing requires a fresh review of that exact revision', () => {
  const state = new Workspace(); state.apply(state.ticket(), result());
  const oldReview = state.ticket(); state.edit();
  assert.equal(state.downloadable(true), false);
  assert.equal(state.review(oldReview, { pass: true, issues: [] }), false);
  assert.equal(state.review(state.ticket(), { pass: false, issues: ['missing fact'] }), true);
  assert.equal(state.downloadable(true), false);
  assert.equal(state.review(state.ticket(), { pass: true, issues: [] }), true);
  assert.equal(state.downloadable(true), true);
});
