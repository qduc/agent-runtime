import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
// TypeScript 7 has no JavaScript compiler API; the parser comes from TypeScript 6 (devDependency alias).
import ts from 'typescript-api';
import { expect, it } from 'vitest';

// Core has no runtime dependencies: its source may import only Node built-ins and
// its own files, and only through literal specifiers the export map can account for.
const packageRoot = path.resolve('packages/core/src');
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(file);
    return entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file) ? [file] : [];
  });
}

it('keeps core imports within the package and Node built-ins', () => {
  const violations: string[] = [];
  for (const file of sources(packageRoot)) {
    const relative = path.relative(packageRoot, file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const check = (specifier: string): void => {
      if (specifier.startsWith('.')) {
        const target = path.resolve(path.dirname(file), specifier);
        if (target !== packageRoot && !target.startsWith(packageRoot + path.sep))
          violations.push(`${relative}: ${specifier}`);
      } else if (!builtins.has(specifier.replace(/^node:/, ''))) violations.push(`${relative}: ${specifier}`);
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text);
        else violations.push(`${relative}: nonliteral import`);
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        if (ts.isStringLiteral(expression)) check(expression.text);
        else violations.push(`${relative}: nonliteral require`);
      }
      if (ts.isIdentifier(node) && node.text === 'createRequire') violations.push(`${relative}: createRequire`);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) check(argument.text);
        else violations.push(`${relative}: nonliteral dynamic import`);
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
        check(node.argument.literal.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
});
