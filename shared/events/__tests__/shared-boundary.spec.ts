/**
 * `shared/events/` is imported by BOTH the Expo app (Hermes / react-native-web)
 * and the hub-hosted embed (a browser bundle). It stays shareable only while it
 * reaches for neither side: nothing from `src/`, nothing from the embed, no DOM
 * global, no `react-dom`, no `react-native`. This is the guard for that.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

const sources = readdirSync(DIR)
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => ({
    name,
    // Prose about a forbidden thing in a docblock is legal; code is not.
    code: readFileSync(join(DIR, name), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, ''),
  }))

describe('shared/events boundary', () => {
  it('finds the modules it is guarding', () => {
    expect(sources.length).toBeGreaterThan(8)
  })

  it('imports nothing from src/ or the embed', () => {
    const offenders = sources.flatMap(({ name, code }) =>
      [...code.matchAll(/from\s+'([^']+)'/g)]
        .map((m) => m[1] ?? '')
        .filter((spec) => spec.startsWith('.') && !spec.startsWith('./') && spec !== '../embed-path.js')
        .map((spec) => `${name} -> ${spec}`),
    )
    expect(offenders).toEqual([])
  })

  it('names no DOM global and no platform package', () => {
    const offenders = sources.flatMap(({ name, code }) =>
      [/\b(document|localStorage|sessionStorage)\./, /\bwindow\.(addEventListener|matchMedia|location|devicePixelRatio|innerWidth|innerHeight|navigator|document|requestAnimationFrame)\b/, /from\s+'(react-dom|react-native)[^']*'/]
        .filter((re) => re.test(code))
        .map((re) => `${name} matches ${String(re)}`),
    )
    expect(offenders).toEqual([])
  })
})
