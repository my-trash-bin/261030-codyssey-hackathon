// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "node_modules/@slop-lab/qg/dist/index.mjs");

/** @param {string} markdown @param {Record<string, string>} [files] */
function scan(markdown, files = {}) {
  const directory = mkdtempSync(join(tmpdir(), "safehandoff-qg-"));
  try {
    const git = spawnSync("git", ["init", "--quiet", directory], { encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
    copyFileSync(join(root, ".qg.yaml"), join(directory, ".qg.yaml"));
    copyFileSync(join(root, ".gitattributes"), join(directory, ".gitattributes"));
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    writeFileSync(join(directory, "README.md"), markdown);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
    const result = spawnSync(process.execPath, [
      cli, "check", "--full", "--rules-only", "--format", "json",
    ], { cwd: directory, encoding: "utf8", timeout: 15000 });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return { status: result.status, diagnostics: JSON.parse(result.stdout).diagnostics };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("Korean and English documentation with approved notation passes", () => {
  const result = scan("# 한국어 문서\n\nSafeHandoff · 분석 → 작성 · 범위 §1 · 1280×720\n");
  assert.equal(result.status, 0, JSON.stringify(result.diagnostics));
});

test("unapproved scripts remain rejected by the recommended character rule", () => {
  const result = scan("# 한국어 문서\n\nЖ\n");
  assert.equal(result.status, 1);
  assert.ok(result.diagnostics.some((item) => item.ruleId === "markdown/allowed-characters"));
});

test("the recommended reference rule rejects missing local documents", () => {
  const result = scan("# 한국어 문서\n\n[없는 문서](missing.md)\n");
  assert.equal(result.status, 1);
  assert.ok(result.diagnostics.some((item) => item.ruleId === "docs/valid-reference"));
});

test("Node preset requires explicit JavaScript type checking", () => {
  const result = scan("# Test\n", { "unsafe.mjs": "const value = 1;\n" });
  assert.equal(result.status, 1);
  assert.ok(result.diagnostics.some((item) => item.ruleId === "js/require-ts-check"));
});
test("package names must use the workspace namespace", () => {
  const result = scan("# Test\n", { "package.json": JSON.stringify({ name: "unrelated-package", private: true }) });
  assert.equal(result.status, 1);
  assert.ok(result.diagnostics.some((item) => item.ruleId === "package/allowed-name"));
});
