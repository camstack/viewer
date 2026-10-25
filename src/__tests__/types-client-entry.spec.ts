/**
 * Every value this app imports from `@camstack/types/client` exists in that
 * entry at RUNTIME, and no bundled file takes a value from the bare root.
 *
 * The code names `@camstack/types/client` explicitly (D721 in camstack-server):
 * the bare entry is one pre-bundled module carrying every capability schema,
 * and Metro does not tree-shake it. tsc already refuses a name `client.d.ts`
 * does not declare; this checks the module itself, so a declaration that
 * drifted from the built `client.mjs` is a red suite, not an `undefined` on
 * first evaluation. Specs are scanned too — vitest resolves `/client` the same
 * way, and a missing name there would be the same silent `undefined`.
 *
 * The bare-root ban itself lives in `scripts/check-types-client-imports.mjs`
 * (run by `ts-check`) and in `eslint.config.js`; the second test here repeats
 * it so `test:v2` alone also goes red.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SCANNED = ['src', 'app', join('embed', 'src')]
const CLIENT = '@camstack/types/client'
const BARE = '@camstack/types'
/**
 * Values `@camstack/sdk` imports at runtime. The published SDK still names the
 * BARE entry (`dist/index.js`), so these must exist in `/client` for the SDK to
 * switch to it.
 */
const SDK_RUNTIME_IMPORTS = ['SystemMirror', 'createSystemProxy']

interface ScannedFile {
  readonly rel: string
  readonly source: ts.SourceFile
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function isTestFile(rel: string): boolean {
  return /(^|\/)__tests__\//.test(rel) || /\.(spec|test)\.tsx?$/.test(rel) || rel.startsWith('src/testing/')
}

/** Value names a static import/export of `specifier` binds (type-only ones are erased). */
function valueNamesFrom(file: ScannedFile, specifier: string): string[] {
  const names: string[] = []
  for (const st of file.source.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === specifier) {
      const clause = st.importClause
      if (clause === undefined || clause.isTypeOnly) continue
      if (clause.name !== undefined) names.push('default')
      const bindings = clause.namedBindings
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.push('*')
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text)
      }
    }
    if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier !== undefined &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === specifier &&
      !st.isTypeOnly
    ) {
      const clause = st.exportClause
      if (clause === undefined || ts.isNamespaceExport(clause)) names.push('*')
      else for (const el of clause.elements) if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text)
    }
  }
  return names
}

const files: ScannedFile[] = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir))).map((full) => ({
  rel: relative(ROOT, full),
  source: ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true),
}))

const imported = [...new Set([...files.flatMap((f) => valueNamesFrom(f, CLIENT)), ...SDK_RUNTIME_IMPORTS])].sort()
const exported = Object.keys(createRequire(join(ROOT, 'package.json'))(CLIENT) as Record<string, unknown>)

describe('@camstack/types/client', () => {
  it('finds the imports it checks', () => {
    expect(imported.length).toBeGreaterThan(20)
    // A namespace or default import cannot be checked name by name.
    expect(imported).not.toContain('*')
    expect(imported).not.toContain('default')
  })

  it('exports every value the app imports from it', () => {
    const missing = imported.filter((name) => !exported.includes(name))
    expect(missing, 'add these to packages/types/src/client.ts in camstack-server and publish @camstack/types').toEqual(
      [],
    )
  })

  it('is the only place bundled code takes a value from (never the bare root)', () => {
    const offenders = files
      .filter((f) => !isTestFile(f.rel))
      .flatMap((f) => valueNamesFrom(f, BARE).map((name) => `${f.rel}: ${name}`))
    expect(offenders).toEqual([])
  })
})
