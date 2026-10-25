import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The in-app mini-player is DELETED, not disabled (operator decision).
 *
 * It shipped twice as a shrunk-in-place copy of the live session and both times
 * left the rest of the app un-tappable underneath (`transparentModal` eating
 * touches, then a frozen blurred tab screen). A disabled feature keeps every
 * one of those trade-offs in the tree — the presentation of the route, the
 * `box-none` chains, a second PiP concept in every gate — while proving
 * nothing. So this guard is the deletion: it fails on the FIRST symbol that
 * comes back.
 */

const ROOT = process.cwd()

/** Every source file under a directory, ignoring this spec itself. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sources(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (full.endsWith('no-in-app-pip.spec.ts')) continue
    out.push(full)
  }
  return out
}

const FORBIDDEN = [
  'inAppPip',
  'InAppPip',
  'in-app-pip',
  'PipRect',
  'defaultPipRect',
  'movePipRect',
  'resizePipRect',
  'clampPipRect',
  'pipWindow',
  'pipClose',
  'enterInAppPip',
  'exitInAppPip',
] as const

describe('the in-app PiP is gone from the app', () => {
  const files = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'app'))]

  it('scans a real tree (the guard itself must not go blind)', () => {
    expect(files.length).toBeGreaterThan(500)
  })

  for (const symbol of FORBIDDEN) {
    it(`no file mentions \`${symbol}\``, () => {
      const hits = files.filter((f) => readFileSync(f, 'utf8').includes(symbol))
      expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([])
    })
  }
})

describe('the strings it owned are gone from BOTH locales', () => {
  for (const locale of ['en', 'it']) {
    it(`${locale}.json has no orphan mini-player copy`, () => {
      const raw = readFileSync(join(ROOT, 'locales', `${locale}.json`), 'utf8')
      expect(raw).not.toContain('inAppPip')
      expect(raw).not.toContain('closePip')
      // The system PiP disc keeps its label — that one is still on screen.
      expect(raw).toContain('"pip"')
    })
  }
})

describe('one PiP, so one request', () => {
  const screen = readFileSync(join(ROOT, 'src/screens/CameraDetailScreen.tsx'), 'utf8')

  it('no kind parameter survives, and no single-member union of one', () => {
    expect(screen).not.toMatch(/'system'\s*\|\s*'in-app'/)
    expect(screen).not.toMatch(/requestPip\(\s*'/)
    expect(screen).not.toContain('pipAfterLiveRef')
  })
})
