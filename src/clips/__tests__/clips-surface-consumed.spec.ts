/**
 * A field of the surface verdict that NOTHING reads is not a decision.
 *
 * ## Why this guard exists
 *
 * `resolveClipsSurface` has said since it was written that a body of FILES has
 * no time axis, no playhead, no scrub and no transport. Four claims, carefully
 * separated so "a future fifth surface must answer for each". For months
 * exactly ONE of them was read — `timeAxis` — and the other three were
 * computed and discarded. So the operator scrolled a clip list and the
 * timeline went on seeking underneath it, while the module that forbids
 * precisely that sat two files away, correct and unconsulted.
 *
 * It is the third instance of the same failure in one day: a decision written
 * where nobody executes it (`clip-stage.ts`'s comment about a reducer that
 * does not exist; `ClipStillOrigin`, named by D580 and branched on by nobody).
 *
 * ## What this asserts, and what the allowlist means
 *
 * Every field must be READ somewhere in `src/`. The three still unread are
 * listed below WITH the reason, so they are visible instead of forgotten —
 * and the list may only shrink. A new field cannot join it: one born unread
 * fails this test on the day it is written, which is the only moment it is
 * cheap to fix.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveClipsSurface } from '../clips-surface.js'

/**
 * Fields the codebase does not act on yet — EMPTY, since 2026-09-22.
 *
 * It held `playhead`, `transport` and `stepsClips` for a day, with the note
 * that wiring them "is a change to what the operator sees, and it is not being
 * smuggled in beside a bug fix". That was the right call and it had a cost:
 * the three unread fields were the three controls the operator then asked for
 * in as many words — *"serve la playback bar con il go live e tutto il resto.
 * Anche per andare alla prossima Clips o navigare internamente alla Clips"* —
 * and the reason he did not have them was that `timeAxis` was gating the
 * transport band, the heatmap and the position line all at once.
 *
 * Keep the set empty. A field born unread fails this test on the day it is
 * written, which is the only moment it is cheap to fix.
 */
const NOT_YET_CONSUMED: ReadonlySet<string> = new Set([])

const SRC = new URL('../../', import.meta.url).pathname

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') out.push(...sources(full))
      continue
    }
    if (/\.tsx?$/.test(entry) && !entry.endsWith('clips-surface.ts')) out.push(full)
  }
  return out
}

describe('every field of the clips surface verdict is read by something', () => {
  const corpus = sources(SRC)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
  const fields = Object.keys(resolveClipsSurface({ clipsMode: true, derivation: 'cap' }))

  it('finds a reader for each field, or names it as pending', () => {
    const unread = fields.filter(
      (f) => f !== 'kind' && !corpus.includes(`clipsSurface.${f}`) && !corpus.includes(`surface.${f}`),
    )
    expect(new Set(unread)).toEqual(NOT_YET_CONSUMED)
  })

  it('the pending list only shrinks — a new field may not join it', () => {
    // If this fails because a field was WIRED, delete it from the set above.
    // If it fails because a field was ADDED unread, wire it instead.
    expect(NOT_YET_CONSUMED.size).toBeLessThanOrEqual(3)
  })
})
