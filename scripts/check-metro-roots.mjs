/**
 * Fails when the app imports (relatively) from a top-level directory of ours
 * that Metro's `.js`→TS rewrite does not cover (`scripts/lib/metro-js-specifier.js`)
 * and that itself uses `.js` relative specifiers. vitest, tsc and Vite resolve
 * those; only the real Metro bundle does not — `shared/` broke `build:web` that way.
 */
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const { TS_SOURCE_ROOTS } = createRequire(import.meta.url)('./lib/metro-js-specifier.js')
const ROOT = process.cwd()
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}
const covered = (f) => TS_SOURCE_ROOTS.some((r) => f.startsWith(join(ROOT, r) + '/'))
const exists = (p) => statSync(p, { throwIfNoEntry: false })?.isFile()
const resolveTs = (from, spec) => {
  const base = join(from, '..', spec.replace(/\.js$/, ''))
  return ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((e) => base + e).find(exists)
}
// Follow relative imports from the app's own files into any root Metro's rewrite
// does NOT cover, and flag a `.js` relative specifier met there.
const seen = new Set()
const bad = []
const visit = (file, viaCovered) => {
  if (seen.has(file)) return
  seen.add(file)
  for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']*)'/g)) {
    const spec = m[1]
    const target = resolveTs(file, spec)
    if (!target) continue
    if (!covered(file) && !file.startsWith(join(ROOT, 'app') + '/') && spec.endsWith('.js')) bad.push(`${file.slice(ROOT.length + 1)} -> ${spec}`)
    visit(target)
  }
}
for (const f of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'app'))]) if (!/__tests__|\/testing\//.test(f)) visit(f)
if (bad.length) { console.error(`metro roots: .js specifiers outside the covered roots (${TS_SOURCE_ROOTS.join(', ')}) that Metro will not rewrite:\n  ${bad.join('\n  ')}`); process.exit(1) }
console.log(`metro roots ok — ${TS_SOURCE_ROOTS.join(', ')} covered`)
