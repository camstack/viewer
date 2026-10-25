/**
 * Refuse a `lucide-react-native` barrel import.
 *
 * The package root is a CJS re-export of 1,747 icon modules that Metro cannot
 * tree-shake, so importing four icons from it bundles all of them — measured at
 * 47% of the app's module count to render 156 icons. `src/lib/icons.ts`
 * re-exports the ones we use from the per-icon subpaths; everything imports
 * from there.
 *
 * This is a guard rather than a comment because the barrel import is the one
 * an editor autocompletes, and its cost is invisible until someone measures a
 * bundle.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.cwd()
const ALLOWED = path.join(ROOT, 'src/lib/icons.ts')

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const offenders = []
for (const file of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'app'))]) {
  if (path.resolve(file) === ALLOWED) continue
  const src = fs.readFileSync(file, 'utf-8')
  for (const [index, line] of src.split('\n').entries()) {
    // Only the BARE package root. `lucide-react-native/icons/<name>` is the
    // whole point and must stay legal.
    if (/from\s+['"]lucide-react-native['"]/.test(line)) {
      offenders.push(`${path.relative(ROOT, file)}:${index + 1}`)
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `${offenders.length} import(s) of the lucide-react-native BARREL — import from src/lib/icons.ts instead:\n  ${offenders.join('\n  ')}`,
  )
  process.exit(1)
}
console.log('icon imports ok — no barrel import')
