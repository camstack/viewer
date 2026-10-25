import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source guards for the app's ONE read of `videoclips`.
 *
 * `use-clips.ts` was deleted in 2026 because it fed a surface that clustered
 * the hub's event log while the timeline clustered `listTracks` — two answers
 * to "what happened on this camera", and the operator saw both. Reading the cap
 * again is safe only under the rule the operator set on 2026-09-20: ONE source
 * per camera, chosen by him, and the two derivations never on screen together.
 * These assertions are what hold that rule up (D569).
 */
const SRC = join(process.cwd(), 'src')
const HOOK = join(SRC, 'data', 'use-camera-clips.ts')
const DELETED_HOOK = join(SRC, 'data', 'use-clips.ts')

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the clip read is ONE hook over ONE provider', () => {
  it('the deleted server-list hook stays deleted', () => {
    // `use-clips.ts` fed `TimelineClipsPanel`. Its replacement is not a rename:
    // it reads ONE provider the operator named, and it is the only read.
    expect(existsSync(DELETED_HOOK)).toBe(false)
  })

  it('never asks listClips without naming the provider', () => {
    // An absent `provider` is documented as "the device's bound provider" — and
    // measured on the live hub 2026-09-20, with 592 bound to both `recorder`
    // and `provider-reolink`, it answered with the REOLINK rows. Absence is not
    // a choice, so the choice is always sent.
    const src = code(HOOK)
    expect(src).toContain('listClips')
    expect(src).toContain('provider: ')
  })

  it('sends the ADDON the source row named, never a source id', () => {
    // `listClips` takes an addon id (D557 § 4). The row carries it, so nothing
    // in this app maps `native:reolink:*` to `provider-reolink` itself.
    const src = code(HOOK)
    expect(src).toContain('choice.addonId')
    expect(src).not.toContain("'provider-reolink'")
    expect(src).not.toContain('native:reolink')
  })

  it('does not ask the cap at all while CamStack is the source', () => {
    // The derived list is the CamStack answer and stays the CamStack answer.
    // Routing our own recordings through `listClips` is the second clusterer
    // whose deletion this app already paid for.
    expect(code(HOOK)).toContain("choice.derivation === 'cap'")
  })

  it('fails loudly rather than painting an unreadable window as an empty one', () => {
    // `capQuery` without `rethrow` records a SUCCESS with an empty array for
    // every failure — "an unreadable day is painted as an empty one", in
    // `cap-query.ts`'s own words. This read fills a screen.
    expect(code(HOOK)).toContain('rethrow: true')
  })

  it('bounds itself by the BULK deadline, not the badge one', () => {
    // A camera-day of clips is a page of history, not a status probe. 107
    // answered 546 rows for one day.
    expect(code(HOOK)).toContain('BULK_QUERY_DEADLINE_MS')
  })

  it('never mints a playback URL while merely listing', () => {
    // `getClipPlayback` puts an entry in a 10-file / 200 MB per-device LRU. One
    // per card evicts the first card on the eleventh. The address is resolved
    // on the TAP, in `use-clip-playback.ts`, and nowhere else.
    expect(code(HOOK)).not.toContain('getClipPlayback')
  })
})

describe('the two clip derivations are exclusive', () => {
  it('the timeline asks the hook for a derivation, never for a merge', () => {
    // The whole safety property of reading the cap again: the native list and
    // the derived list are never both laid onto the axis. A `[...derived,
    // ...native]` anywhere here is the defect coming back.
    const theater = code(join(SRC, 'components', 'camera', 'theater', 'TheaterTimeline.tsx'))
    expect(theater).toContain("clips.choice.derivation === 'cap'")
    expect(theater).not.toContain('...derivedClips, ...')
    expect(theater).not.toContain('.concat(nativeClips')
  })

  it('the derived branch is still the untouched one', () => {
    const theater = code(join(SRC, 'components', 'camera', 'theater', 'TheaterTimeline.tsx'))
    expect(theater).toContain('deriveClipsFromClusters')
    expect(theater).toContain('clusters: eventClusters')
    expect(theater).toContain('recording: activity.recording')
  })
})
