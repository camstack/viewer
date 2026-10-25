/**
 * The service door `Alert.alert` came back through, held shut.
 *
 * `Alert.alert` is `static alert() {}` in react-native-web 0.21 — an empty
 * function body. Any call site that reaches it directly is silent on the
 * browser and the PWA: a confirmation never opens (so the write below it never
 * runs) and a one-button notice never says the download failed. That is not a
 * theoretical risk, it is what this repo shipped: 49 direct calls across 14
 * files, 19 of them gating a write, discovered only when the operator found
 * group assignment completely dead from a browser.
 *
 * A type check cannot see it — `Alert.alert(…)` is perfectly well typed on
 * every platform. Only a source guard can.
 *
 * ## The rule
 *
 * App code calls `useConfirm()` / `useNotice()` (`components/ui/confirm.tsx`).
 * `system-alert.ts` is the ONE module allowed to reach `Alert`, and only
 * `confirm.tsx` may import it — on the platforms where the system alert works
 * that is exactly what the operator gets.
 *
 * ## What this guard does NOT cover
 *
 * It reads text, so it cannot see a call assembled at runtime
 * (`RN['Alert'].alert`). Nothing in this repo does that, and the behavioural
 * gates in `confirm-surface.spec.ts` are what actually prove the surface
 * works; this guard only stops the old shape from being pasted back.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/**
 * The allowlist, in full.
 *
 * `src/components/ui/system-alert.ts` — the native adapter behind
 * `useConfirm` / `useNotice`. It is the reason the phone keeps its system
 * alert instead of a drawn dialog, and `confirm.tsx` never routes to it on the
 * web.
 */
const ALERT_ALLOWED: ReadonlySet<string> = new Set(['src/components/ui/system-alert.ts'])

/** Only the surface that owns the platform decision may import the adapter. */
const SYSTEM_ALERT_IMPORTERS: ReadonlySet<string> = new Set(['src/components/ui/confirm.tsx'])

/**
 * Directories the rule does not apply to.
 *
 * `__tests__` — a spec that spies on `Alert.alert` to assert the NATIVE branch
 *   is doing its job (`confirm-surface.spec.ts` does exactly that). A spec
 *   cannot ship a mute button to the operator.
 * `src/testing` — the harness; `native-stubs/react-native.tsx` re-exports
 *   react-native-web wholesale, `Alert` included.
 */
function isExempt(rel: string): boolean {
  return rel.includes('__tests__') || rel.startsWith('src/testing/')
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    out.push(relative(ROOT, full))
  }
  return out
}

const FILES: readonly string[] = [
  ...sourceFiles(join(ROOT, 'src')),
  ...sourceFiles(join(ROOT, 'app')),
  ...sourceFiles(join(ROOT, 'embed', 'src')),
].filter((rel) => !isExempt(rel))

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('no source outside the confirm surface calls the system alert', () => {
  it('scans a plausible amount of source — an empty walk would pass vacuously', () => {
    expect(FILES.length).toBeGreaterThan(200)
  })

  it('has no `Alert.alert(` outside the allowlist', () => {
    const offenders = FILES.filter(
      (rel) => !ALERT_ALLOWED.has(rel) && read(rel).includes('Alert.alert('),
    )
    expect(offenders).toEqual([])
  })

  it('imports `Alert` from react-native nowhere but the allowlist', () => {
    // Catches the half-migrated shape too: an import left behind is a call
    // waiting to be re-added, and `TriangleAlert` (an icon) must not trip it.
    const offenders = FILES.filter((rel) => {
      if (ALERT_ALLOWED.has(rel)) return false
      const src = read(rel)
      const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g)]
      return imports.some((m) =>
        (m[1] ?? '')
          .split(',')
          .map((name) => name.trim())
          .includes('Alert'),
      )
    })
    expect(offenders).toEqual([])
  })

  it('keeps the native adapter reachable only from the confirm surface', () => {
    const offenders = FILES.filter(
      (rel) => !SYSTEM_ALERT_IMPORTERS.has(rel) && read(rel).includes("from './system-alert.js'"),
    )
    expect(offenders).toEqual([])
  })
})

describe('the allowlist stays honest', () => {
  it('every allowlisted path exists — a stale entry silently widens the rule', () => {
    for (const rel of [...ALERT_ALLOWED, ...SYSTEM_ALERT_IMPORTERS]) {
      expect(() => read(rel)).not.toThrow()
    }
  })

  it('the allowlisted adapter really is the one the confirm surface uses', () => {
    const src = read('src/components/ui/confirm.tsx')
    expect(src).toContain("import { systemConfirm, systemNotice } from './system-alert.js'")
  })

  it('reaches the adapter only from the non-web branch, in both entry points', () => {
    // The ORDERED fragment, not just the two strings: a bare
    // `toContain("if (Platform.OS !== 'web')")` still passed when the confirm
    // branch was deliberately broken, because `notice` below it carries the
    // same line. What actually proves the routing is
    // `confirm-surface.spec.ts`, which presses the buttons; this holds the
    // shape so the two cannot drift apart silently.
    const src = read('src/components/ui/confirm.tsx')
    expect(src).toMatch(/if \(Platform\.OS !== 'web'\) \{\s*\n\s*return systemConfirm\(\{/)
    expect(src).toMatch(/if \(Platform\.OS !== 'web'\) \{\s*\n\s*systemNotice\(\{/)
  })
})
