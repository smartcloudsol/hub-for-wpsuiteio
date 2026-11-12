import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../..');
const roots = ['gatey', 'common', 'ai-kit', 'flow', 'commerce', 'static-publisher', 'smartcloud-agent-ready-product-family/agent-composer'];
const ignored = new Set(['node_modules', 'build', 'dist', 'docs', '.git', 'vendor', 'coverage', '.artifacts']);
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--vendor-entry'), 'Usage: node test-export-surface.mjs [--vendor-entry path]');
const entry = args.length ? resolve(args[1]) : join(here, 'src/index.ts');
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const vendor = parse(entry, readFileSync(entry, 'utf8'));
const exports = new Set();
for (const node of vendor.statements) {
  if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const item of node.exportClause.elements) if (!item.isTypeOnly) exports.add(item.name.text);
  } else if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
    if (node.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) exports.add('default');
    if (node.name && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node))) exports.add(node.name.text);
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) exports.add(declaration.name.text);
  }
}
function walk(dir, visit) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) { if (!ignored.has(item.name) && !item.name.startsWith('.')) walk(join(dir, item.name), visit); }
    else if (item.isFile()) visit(join(dir, item.name));
  }
}
const configs = [];
for (const root of roots) walk(join(workspace, root), file => { if (file.endsWith('/webpack.config.cjs')) configs.push(file); });
let sourceCount = 0, importCount = 0;
const errors = [];
for (const config of configs.sort()) {
  const configText = readFileSync(config, 'utf8');
  const modules = new Set([...configText.matchAll(/['"]([^'"]+)['"]\s*:\s*['"]WpSuiteAmplify['"]/g)].map(match => match[1]));
  if (!modules.size) continue;
  const sourceRoot = join(dirname(config), 'src');
  try { readdirSync(sourceRoot); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  walk(sourceRoot, file => {
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(extname(file)) || file.endsWith('.d.ts')) return;
    sourceCount++;
    const original = readFileSync(file, 'utf8');
    const emitted = ts.transpileModule(original, { fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.Preserve } }).outputText;
    const tree = parse(file, emitted);
    const report = (name, module) => { importCount++; if (!exports.has(name)) errors.push(`${relative(workspace, file)}: ${module} imports missing value ${name}`); };
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !modules.has(node.moduleSpecifier.text) || !node.importClause) continue;
      const mod = node.moduleSpecifier.text, clause = node.importClause;
      if (clause.name) report('default', mod);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const item of clause.namedBindings.elements) report((item.propertyName ?? item.name).text, mod);
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const local = clause.namedBindings.name.text;
        const visit = child => {
          if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === local) report(child.name.text, mod);
          else if (ts.isElementAccessExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === local) {
            if (child.argumentExpression && ts.isStringLiteral(child.argumentExpression)) report(child.argumentExpression.text, mod);
            else errors.push(`${relative(workspace, file)}: ${mod} has dynamic namespace access that cannot be checked`);
          }
          ts.forEachChild(child, visit);
        };
        ts.forEachChild(tree, visit);
      }
    }
  });
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(`Checked ${sourceCount} source files and ${importCount} runtime imports against ${exports.size} vendor value exports in ${configs.filter(file => /['"]WpSuiteAmplify['"]/.test(readFileSync(file, 'utf8'))).length} mapped webpack configurations.`);
