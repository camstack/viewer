import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  WHATS_NEW,
  shouldShowWhatsNew,
  whatsNewFor,
  whatsNewHistory,
  whatsNewLines,
} from '../whats-new.js'

/**
 * The guard the operator asked for: every shipped version carries its notes.
 * This spec checks the version ALREADY in package.json (CI, after the bump).
 * The ship scripts do not run the suite; they run the same rule for the NEXT
 * version through `scripts/lib/check-whats-new.js` before they bump anything
 * — so the entry must be written before `update:patch`, not after.
 */
describe("what's new is filled in for every version", () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }

  it('has an entry for the version in package.json', () => {
    expect(whatsNewFor(pkg.version), `add a WHATS_NEW entry for ${pkg.version}`).not.toBeNull()
  })

  it('keeps every note to ONE LINE — a budget that may only shrink', () => {
    // An operator reads these once, on a phone. A note that needs a
    // subordinate clause is a commit message wearing a release note's
    // clothes — measured 2026-09-22 at 250-406 characters each, three
    // sentences apiece, arguing the design. A comment saying "short lines"
    // had been at the top of the file the whole time and did not hold.
    //
    // The 264 long notes ALREADY SHIPPED are not rewritten: operators have
    // read them, and editing history to satisfy a guard teaches nothing.
    // Instead the count may only go DOWN — the same ratchet
    // `check-date-locale.mjs` uses. Add a long note and this fails; shorten
    // an old one and you must lower the budget with it.
    const LIMIT = 140
    const BUDGET = 264
    const over: string[] = []
    for (const entry of WHATS_NEW) {
      for (const [locale, lines] of Object.entries(entry.notes)) {
        for (const line of lines) {
          if (line.length > LIMIT) over.push(`${entry.version} ${locale}: ${line.slice(0, 50)}…`)
        }
      }
    }
    expect(over.length, `long notes:\n${over.slice(0, 5).join('\n')}`).toBeLessThanOrEqual(BUDGET)
  })

  it('the NEWEST version carries no long note', () => {
    // The budget alone would let a new long note in as an old one is
    // shortened. The version being shipped is held to the rule outright.
    const newest = WHATS_NEW[0]
    expect(newest).toBeDefined()
    for (const [locale, lines] of Object.entries(newest?.notes ?? {})) {
      for (const line of lines) {
        expect(line.length, `${newest?.version} ${locale}: ${line}`).toBeLessThanOrEqual(140)
      }
    }
  })

  it('is newest first, every entry with both languages', () => {
    const versions = WHATS_NEW.map((e) => e.version)
    const sorted = [...versions].sort((a, b) => compare(b, a))
    expect(versions).toEqual(sorted)
    for (const e of WHATS_NEW) {
      expect(e.notes.en.length, e.version).toBeGreaterThan(0)
      expect(e.notes.it.length, e.version).toBeGreaterThan(0)
    }
  })

  it('shows once per version, and only when there are notes', () => {
    const v = WHATS_NEW[0]!.version
    expect(shouldShowWhatsNew(null, v)).toBe(true)
    expect(shouldShowWhatsNew(v, v)).toBe(false)
    expect(shouldShowWhatsNew(null, '0.0.1')).toBe(false)
    expect(shouldShowWhatsNew(null, undefined)).toBe(false)
  })

  it('picks the language, falling back to English', () => {
    const e = WHATS_NEW[0]!
    expect(whatsNewLines(e, 'it-IT')).toBe(e.notes.it)
    expect(whatsNewLines(e, 'de')).toBe(e.notes.en)
  })
})

function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

describe('whatsNewHistory', () => {
  it('separates the running version from everything before it', () => {
    const newest = WHATS_NEW[0]!
    const history = whatsNewHistory(newest.version)
    expect(history.latest).toBe(newest)
    expect(history.past).not.toContain(newest)
    expect(history.past).toHaveLength(WHATS_NEW.length - 1)
    // Newest first, as authored — the panel reads top-down without sorting.
    expect(history.past[0]).toBe(WHATS_NEW[1])
  })

  it('keeps the history reachable on a version with no entry', () => {
    // A dev client, or a build older than this file. An empty panel would say
    // "nothing ever changed", which is the opposite of true.
    const history = whatsNewHistory('0.0.0-dev')
    expect(history.latest).toBeNull()
    expect(history.past).toHaveLength(WHATS_NEW.length)
  })

  it('treats an absent version the same way', () => {
    expect(whatsNewHistory(null).latest).toBeNull()
    expect(whatsNewHistory(null).past).toHaveLength(WHATS_NEW.length)
  })

  it('never loses an entry: latest plus past is the whole list', () => {
    for (const entry of [WHATS_NEW[0]!, WHATS_NEW[2]!]) {
      const h = whatsNewHistory(entry.version)
      expect((h.latest === null ? 0 : 1) + h.past.length).toBe(WHATS_NEW.length)
    }
  })
})
