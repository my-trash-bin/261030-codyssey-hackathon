// @ts-check
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
/** @type {Record<string, string[]>} */
const allowed = {
  'core-interface': [],
  core: ['core-interface'],
  'fake-core': ['core-interface'],
  server: ['core-interface'],
  'sandbox-runner': ['core-interface'],
  'model-adapter': ['core-interface'],
  app: ['core-interface', 'core', 'server', 'sandbox-runner', 'model-adapter'],
  'fake-app': ['core-interface', 'fake-core', 'server'],
  client: ['core-interface'],
};
/** @param {string} directory @returns {Promise<string[]>} */
async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(entries.map(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : Promise.resolve(path.endsWith('.ts') ? [path] : []);
  }));
  return lists.flat();
}
test('implementation dependencies obey the app/server/core boundaries', async () => {
  for (const [name, permitted] of Object.entries(allowed)) {
    const directory = resolve(root, 'packages', name);
    const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
    for (const dependency of declared) {
      if (dependency.startsWith('@safehandoff/')) {
        assert(permitted.includes(dependency.slice('@safehandoff/'.length)), `${name} must not depend on ${dependency}`);
      }
    }
    for (const file of await sourceFiles(resolve(directory, 'src'))) {
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      /** @param {ts.Node} node */
      function inspect(node) {
        /** @type {string | undefined} */
        let specifier;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          specifier = node.moduleSpecifier.text;
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          const argument = node.arguments[0];
          assert(argument && ts.isStringLiteral(argument), `computed module load is not allowed: ${file}`);
          specifier = argument.text;
        }
        if (specifier) {
          assert(name !== 'core-interface' || file.endsWith('.test.ts') || specifier.startsWith('./'), 'interface must not import implementations or Node APIs');
          if (specifier.startsWith('.')) {
            assert(!relative(directory, resolve(dirname(file), specifier)).startsWith('..'), `cross-package source import: ${file}`);
          } else if (specifier.startsWith('@safehandoff/')) {
            assert(permitted.includes(specifier.slice('@safehandoff/'.length)), `${name} cannot import ${specifier}`);
            assert(declared.has(specifier), `undeclared workspace dependency: ${specifier}`);
          }
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
    }
  }
});
