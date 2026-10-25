/**
 * Refuse `Animated` / `Easing` imported from 'react-native'.
 *
 * Every motion in the app runs on Reanimated and takes its springs and
 * durations from `src/theme/motion.ts`. React Native's own `Animated` is a
 * second engine with its own numbers: a press that springs one way here and
 * another there, and values the other engine cannot read. Detection lives in
 * `scripts/lib/rn-animated-imports.mjs`, pinned by its spec (which also plants
 * an offender in a scratch tree and expects this script to go red).
 *
 * The web embed (`embed/`) is plain web and keeps its CSS animations — only
 * `src/` and `app/` are scanned.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { findRnAnimatedImports } from './lib/rn-animated-imports.mjs'

const ROOT = process.cwd()

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
  for (const { line, name } of findRnAnimatedImports(fs.readFileSync(file, 'utf-8'))) {
    offenders.push(`${path.relative(ROOT, file)}:${line} (${name})`)
  }
}

if (offenders.length > 0) {
  console.error(
    `${offenders.length} import(s) of React Native's animation API — use react-native-reanimated and the presets in src/theme/motion.ts:\n  ${offenders.join('\n  ')}`,
  )
  process.exit(1)
}
console.log('motion ok — no Animated/Easing from react-native')
