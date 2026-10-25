/**
 * Refuse a VALUE import from the bare `@camstack/types` in bundled code.
 *
 * The bare entry is one pre-bundled module carrying every capability schema
 * the hub knows (~2.7 MB unminified), and Metro does not tree-shake — not
 * even with Expo's experimental tree shaking. One value import from it puts
 * ~1.2 MB into the web bundle. `@camstack/types/client` (D721 in
 * camstack-server) exports exactly the values a client reads, and the tiny
 * `@camstack/types/enums` carries `EventCategory` / `EventSourceType`.
 *
 * Until 2026-10 Metro silently aliased the bare entry to `/client`. That hid
 * which entry the code really used and turned a name missing from `/client`
 * into `undefined` at runtime. The alias is gone: the code names its entry,
 * tsc checks the names against `client.d.ts`, and this guard keeps the bare
 * entry for TYPES only (erased at compile time).
 *
 * Specs and `src/testing` are exempt: they never reach a bundle, and some
 * assert against server schemas `/client` deliberately leaves out.
 *
 * A value missing from `/client` is NOT a reason to import the root: add it to
 * `packages/types/src/client.ts` in camstack-server and publish.
 *
 * ESLint enforces the same rule (`eslint.config.js`); this guard runs in
 * `ts-check`, so CI fails even where lint is skipped.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const SCANNED = ['src', 'app', 'embed/src']
const BARE = '@camstack/types'
/** Entries a VALUE may come from. */
const VALUE_ENTRIES = new Set(['@camstack/types/client', '@camstack/types/enums'])

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

function isTestFile(rel) {
  return /(^|\/)__tests__\//.test(rel) || /\.(spec|test)\.tsx?$/.test(rel) || rel.startsWith('src/testing/')
}

function isTypesSpecifier(spec) {
  return spec === BARE || spec.startsWith(`${BARE}/`)
}

/** Value names a static import/export declaration binds, or [] when it is type-only. */
function valueNames(st) {
  if (ts.isImportDeclaration(st)) {
    const clause = st.importClause
    if (clause === undefined) return ['(side-effect import)']
    if (clause.isTypeOnly) return []
    const names = []
    if (clause.name !== undefined) names.push('default')
    const bindings = clause.namedBindings
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.push('* as namespace')
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text)
    }
    return names
  }
  if (st.isTypeOnly) return []
  const clause = st.exportClause
  if (clause === undefined) return ['* (export star)']
  if (ts.isNamespaceExport(clause)) return ['* as namespace']
  return clause.elements.filter((el) => !el.isTypeOnly).map((el) => (el.propertyName ?? el.name).text)
}

const offenders = []

for (const file of SCANNED.flatMap((dir) => walk(path.join(ROOT, dir)))) {
  const rel = path.relative(ROOT, file)
  if (isTestFile(rel)) continue
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true)
  const at = (node) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`

  const visit = (node) => {
    // Static `import … from` / `export … from`.
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isTypesSpecifier(node.moduleSpecifier.text) &&
      !VALUE_ENTRIES.has(node.moduleSpecifier.text)
    ) {
      const names = valueNames(node)
      if (names.length > 0) offenders.push(`${at(node)}  ${names.join(', ')}  from '${node.moduleSpecifier.text}'`)
    }
    // `import('…')` / `require('…')` — always a runtime load.
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      isTypesSpecifier(node.arguments[0].text) &&
      !VALUE_ENTRIES.has(node.arguments[0].text)
    ) {
      offenders.push(`${at(node)}  runtime load of '${node.arguments[0].text}'`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

if (offenders.length > 0) {
  console.error(
    `${offenders.length} value import(s) from a non-client @camstack/types entry — import values from '@camstack/types/client' (or '/enums'); only \`import type\` may name the bare entry. A value missing from /client is added to packages/types/src/client.ts in camstack-server:\n  ${offenders.join('\n  ')}`,
  )
  process.exit(1)
}
console.log('@camstack/types ok — every bundled value comes from /client or /enums')
