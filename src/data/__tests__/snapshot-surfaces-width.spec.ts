/**
 * Every snapshot surface must ask for a WIDTH.
 *
 * A guard rather than seven render tests, because the failure this prevents is
 * not "this component regressed" — it is "somebody added an eighth surface and
 * did not know the rule". Measured on the live hub before this was enforced:
 * five of six surfaces omitted `?w=` and were served the frame as captured, at
 * **758 KB average per camera and 11.4 MB for one 16-camera grid paint**, into
 * tiles 50–390 pt wide. The same paint at `?w=320` is 136 KB.
 *
 * `useSnapshot(deviceId, enabled, targetWidth?)` — the third argument is the
 * width. If a surface genuinely needs the frame as captured it must be listed in
 * {@link INTENTIONAL_FULL_FRAME} with a reason, so the omission is a decision
 * somebody wrote down rather than one nobody noticed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Surfaces allowed to omit the width, with the reason. Empty on purpose: every
 * surface currently asks for one, including the full-bleed ones (which take the
 * 960 top rung — still ~5% of a 4 K capture).
 */
const INTENTIONAL_FULL_FRAME: ReadonlyMap<string, string> = new Map()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

interface CallSite {
  readonly file: string
  readonly relFile: string
  readonly line: number
  readonly text: string
}

/** Every `useSnapshot(` invocation in the app source (not the hook's own file). */
function findUseSnapshotCallSites(): CallSite[] {
  const sites: CallSite[] = []
  for (const file of walk(SRC_ROOT)) {
    // The hook's own definition and re-exports are not call sites.
    if (file.endsWith(path.join('data', 'use-snapshot.ts'))) continue
    const source = readFileSync(file, 'utf8')
    if (!source.includes('useSnapshot(')) continue
    const lines = source.split('\n')
    lines.forEach((line, idx) => {
      if (!/\buseSnapshot\(/.test(line)) return
      // Skip comment lines — a prose mention is not a call.
      const trimmed = line.trim()
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) return
      sites.push({
        file,
        relFile: path.relative(SRC_ROOT, file),
        line: idx + 1,
        // The call can wrap; join enough following lines to see all arguments.
        text: lines.slice(idx, idx + 4).join(' '),
      })
    })
  }
  return sites
}

/** The argument list of the `useSnapshot(...)` call starting in `text`. */
function argumentsOf(text: string): string {
  const start = text.indexOf('useSnapshot(')
  if (start === -1) return ''
  let depth = 0
  let out = ''
  for (let i = start + 'useSnapshot'.length; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(') {
      depth += 1
      if (depth === 1) continue
    }
    if (ch === ')') {
      depth -= 1
      if (depth === 0) break
    }
    out += ch
  }
  return out
}

/** Split a top-level argument list on commas that are not nested. */
function topLevelArgs(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of args) {
    if ('([{'.includes(ch)) depth += 1
    if (')]}'.includes(ch)) depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim().length > 0) parts.push(current.trim())
  return parts
}

describe('snapshot surfaces', () => {
  const sites = findUseSnapshotCallSites()

  it('finds the snapshot surfaces at all (the scan itself must not silently pass)', () => {
    // Without this, a broken scan would report "0 violations" and look green.
    expect(sites.length).toBeGreaterThanOrEqual(7)
  })

  it.each(sites.map((s) => [`${s.relFile}:${String(s.line)}`, s] as const))(
    '%s requests a target width',
    (_label, site) => {
      const args = topLevelArgs(argumentsOf(site.text))
      const reason = INTENTIONAL_FULL_FRAME.get(site.relFile)
      if (reason !== undefined) {
        expect(args.length).toBeLessThan(3)
        return
      }
      expect(
        args.length,
        `${site.relFile}:${String(site.line)} calls useSnapshot without a target width. ` +
          'Without it the server returns the frame AS CAPTURED (~758 KB, 3840x2160). ' +
          'Pass a width, or add the file to INTENTIONAL_FULL_FRAME with a reason.',
      ).toBeGreaterThanOrEqual(3)
      expect(args[2]?.length ?? 0).toBeGreaterThan(0)
    },
  )
})
