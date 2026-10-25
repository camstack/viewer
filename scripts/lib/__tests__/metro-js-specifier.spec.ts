/**
 * Metro does not rewrite `.js`→`.ts`; our resolver does, for our own source
 * roots. A root that imports `./x.js` but is missing from the list breaks the
 * REAL bundle while vitest, tsc and Vite stay green (`shared/` did). This spec
 * walks every app-bundled TS root and fails on any root the rule does not cover.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rule = require('../metro-js-specifier.js') as typeof import('../metro-js-specifier.js')
const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('metro .js specifier rule', () => {
  it('rewrites relative .js from src/ and shared/, never elsewhere', () => {
    expect(rule.rewriteJsSpecifier(ROOT, join(ROOT, 'shared/events/a.ts'), '../embed-path.js')).toBe('../embed-path')
    expect(rule.rewriteJsSpecifier(ROOT, join(ROOT, 'src/a.ts'), './b.js')).toBe('./b')
    expect(rule.rewriteJsSpecifier(ROOT, join(ROOT, 'node_modules/x/a.js'), './b.js')).toBeNull()
    expect(rule.rewriteJsSpecifier(ROOT, join(ROOT, 'src/a.ts'), 'pkg/b.js')).toBeNull()
  })

  it('every top-level TS root the app imports from is covered', () => {
    const imported = new Set<string>()
    for (const file of walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'app')))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'((?:\.\.\/)+)([a-z][\w-]*)\//g)) imported.add(m[2]!)
    }
    for (const root of ['shared']) {
      if (imported.has(root)) expect(rule.TS_SOURCE_ROOTS).toContain(root)
    }
    const offenders = [...imported].filter(
      (r) => !rule.TS_SOURCE_ROOTS.includes(r) && ['shared', 'embed'].includes(r) && walk(join(ROOT, r)).some((f) => /from\s+'\.[^']*\.js'/.test(readFileSync(f, 'utf8'))),
    )
    // embed/ is a Vite bundle the app never bundles through Metro for .js specifiers
    expect(offenders.filter((r) => r !== 'embed')).toEqual([])
  })
})
