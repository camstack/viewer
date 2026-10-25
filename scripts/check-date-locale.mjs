/**
 * Refuse a date formatted in the RUNTIME's locale instead of the app's.
 *
 * `new Date(x).toLocaleDateString(undefined, …)` does not mean "no
 * preference". It means the JavaScript runtime's locale — the device's on
 * native, the browser's on web — and the app's own language setting
 * (Settings → Lingua, which drives i18next) never reaches it.
 *
 * The operator, whose phone and app are both Italian, reported the calendar
 * was not. Both halves were wrong separately: the month and day titles took
 * the runtime locale, and the weekday row beside them was the literal array
 * ['L','M','M','G','V','S','D'] — so one calendar could show two languages,
 * neither of them necessarily the chosen one.
 *
 * The fix is `lib/date-locale.ts`: `useDateLocale()` in a component, or a
 * `locale` parameter threaded into a pure module.
 *
 * ## The allowlist only shrinks
 *
 * Eighteen call sites existed when this guard was written, in thirteen files
 * (the calendar's two are already gone).
 * The calendar was fixed the same day; the rest are listed below WITH their
 * count so they are visible rather than forgotten, and the numbers may only
 * go down. A new one fails this check on the day it is written, which is the
 * only moment it is cheap to fix.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname
const PATTERN = /toLocale(?:Date|Time)?String\(\s*undefined/g

/** path → how many runtime-locale calls it is still allowed to have. */
const ALLOWED = new Map([
  ['components/camera/theater/ClusterCard.tsx', 1],
  ['components/camera/theater/ExportFramePreview.tsx', 1],
  ['components/camera/theater/TimelineClusterPanel.tsx', 1],
  ['components/camera/theater/TimelineScroller.tsx', 1],
  ['components/events/track/TrackDetailView.tsx', 1],
  ['data/export-format.ts', 3],
  ['data/nc-artifact-format.ts', 3],
])

function files(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') out.push(...files(full))
      continue
    }
    if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const problems = []
const seen = new Map()

for (const file of files(SRC)) {
  const rel = file.slice(SRC.length)
  const hits = (readFileSync(file, 'utf8').match(PATTERN) ?? []).length
  if (hits > 0) seen.set(rel, hits)
  const budget = ALLOWED.get(rel) ?? 0
  if (hits > budget) {
    problems.push(
      `${rel}: ${hits} runtime-locale date call(s), allowed ${budget}. ` +
        `Use useDateLocale() (lib/date-locale.ts) or thread a locale in.`,
    )
  }
}

// The ratchet: a file that got BETTER must lower its budget, or the guard
// silently stops protecting the ground that was won.
for (const [rel, budget] of ALLOWED) {
  const hits = seen.get(rel) ?? 0
  if (hits < budget) {
    problems.push(
      `${rel}: now has ${hits} (allowed ${budget}) — lower its entry in ` +
        `scripts/check-date-locale.mjs, or remove it entirely at 0.`,
    )
  }
}

if (problems.length > 0) {
  console.error('date locale: a date must be formatted in the app’s language\n')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

const remaining = [...seen.values()].reduce((a, b) => a + b, 0)
console.log(`date locale ok — ${remaining} runtime-locale call(s) left, none new`)
