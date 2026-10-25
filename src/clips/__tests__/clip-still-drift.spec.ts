import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CLIP_STILL_RETRY_ATTEMPTS,
  CLIP_STILL_RETRY_BASE_MS,
  CLIP_STILL_RETRY_MAX_WAIT_MS,
  CLIP_STILL_RETRY_JITTER_FRACTION,
} from '../clip-still.js'

/**
 * The tripwire on a DELIBERATE duplicate (D573).
 *
 * One retry policy, two surfaces. The admin UI's copy is in
 * `@camstack/ui-library`, which this app can neither import (a DOM component
 * library against a React Native bundle) nor reach at a useful version (this
 * app resolves `@camstack/*` from the PUBLISHED packages, and the published
 * `@camstack/types` it holds predates D563's header constants entirely). So
 * the numbers are copied, and this spec is what keeps the two copies honest:
 * it reads the OTHER copy's source and compares.
 *
 * It runs wherever the server checkout is next door — which is the layout in
 * which either file is ever edited, since this repo is a submodule of it. In
 * the viewer's own standalone CI there is nothing to compare against, and the
 * spec says so out loud rather than passing quietly.
 */
const OTHER = join(
  process.cwd(),
  '..',
  'packages',
  'ui-library',
  'src',
  'composites',
  'clips',
  'clip-still-retry.ts',
)

/** Every constant that must agree, as `<their name> → <our value>`. */
const MUST_AGREE: Readonly<Record<string, number>> = {
  STILL_RETRY_ATTEMPTS: CLIP_STILL_RETRY_ATTEMPTS,
  STILL_RETRY_BASE_MS: CLIP_STILL_RETRY_BASE_MS,
  STILL_RETRY_MAX_WAIT_MS: CLIP_STILL_RETRY_MAX_WAIT_MS,
  JITTER_FRACTION: CLIP_STILL_RETRY_JITTER_FRACTION,
}

/** `const NAME = 4_000` → 4000. `null` when the name is not declared. */
function declaredNumber(source: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*([0-9_.]+)`).exec(source)
  if (match === null) return null
  const value = Number(match[1].replace(/_/g, ''))
  return Number.isFinite(value) ? value : null
}

describe('the admin UI’s ladder and this one are the same ladder', () => {
  const present = existsSync(OTHER)

  it.runIf(present)('declares every number this app copied, with the same value', () => {
    const source = readFileSync(OTHER, 'utf8')
    for (const [name, ours] of Object.entries(MUST_AGREE)) {
      const theirs = declaredNumber(source, name)
      // A rename must go RED here, not silently pass by finding nothing — the
      // whole point of a guard that greps is that an absent match is a
      // failure, never a pass.
      expect(theirs, `${name} is no longer declared in ${OTHER}`).not.toBeNull()
      expect(theirs, `${name} drifted: ui-library ${String(theirs)} vs viewer ${String(ours)}`).toBe(
        ours,
      )
    }
  })

  it.runIf(present)('still treats only `deferred` as “come back”', () => {
    const source = readFileSync(OTHER, 'utf8')
    // Both copies read the disposition and nothing else. If the other side
    // grew a code→disposition table, the contract has forked and the viewer
    // has to be told.
    expect(source).not.toMatch(/queue-full/)
  })

  it.runIf(!present)('says why it could not compare, rather than passing quietly', () => {
    // Standalone CI: `camstack-server` is not checked out beside this repo, so
    // there is no second copy to diff. Named, not skipped invisibly.
    expect(existsSync(OTHER)).toBe(false)
  })
})
