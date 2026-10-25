import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  clipsStatusMessageKey,
  resolveClipsStatus,
  type ClipsStatusInput,
  clipsNoteTopPx,
  CLIPS_NOTE_MIN_TOP_PX,
} from '../clips-status.js'

/** Everything healthy, in clips mode, with rows on screen. */
function input(patch: Partial<ClipsStatusInput> = {}): ClipsStatusInput {
  return { active: true, connected: true, loading: false, failed: false, clipCount: 3, ...patch }
}

describe('resolveClipsStatus', () => {
  it('says nothing while clips mode is off', () => {
    expect(resolveClipsStatus(input({ active: false, clipCount: 0, failed: true }))).toBe('hidden')
  })

  it('says nothing while there are clips to look at', () => {
    // A placeholder drawn over real cards is noise, and the previous window's
    // rows are deliberately kept while a wider one loads.
    expect(resolveClipsStatus(input({ loading: true }))).toBe('hidden')
    expect(resolveClipsStatus(input({ failed: true }))).toBe('hidden')
  })

  // The whole point of the four states: before this, a failed read, an absent
  // cap, a deadline expiry, a dropped socket, a non-admin session (`listClips`
  // is auth: 'admin') and a genuinely quiet camera were ONE blank picture.
  it('tells an unread day apart from an empty one', () => {
    expect(resolveClipsStatus(input({ clipCount: 0, failed: true }))).toBe('failed')
    expect(resolveClipsStatus(input({ clipCount: 0 }))).toBe('empty')
  })

  it('tells a load in flight apart from an empty one', () => {
    expect(resolveClipsStatus(input({ clipCount: 0, loading: true }))).toBe('loading')
  })

  it('leaves a dropped socket to the root hub-status overlay, blaming nothing here', () => {
    expect(resolveClipsStatus(input({ clipCount: 0, connected: false }))).toBe('hidden')
    // The socket is the CAUSE — a failure or a load reported over a dead
    // connection is that same cause with a second name.
    expect(
      resolveClipsStatus(input({ clipCount: 0, connected: false, failed: true, loading: true })),
    ).toBe('hidden')
  })

  it('does not claim the camera is quiet when its SOURCE could not answer', () => {
    // The distinction this resolver was one short of. `listSources` measures a
    // state per source (D561) and four of the five mean "this list cannot be
    // read as complete": 618 answers `index-empty` with 177 GB free, 640
    // answered `no-storage` with no card fitted, a standalone battery camera
    // answers `sleeping`, a child that threw answers `unreachable`. Every one
    // of them used to render as "no clips for this camera" — which is the exact
    // sentence this whole line of work exists to stop showing.
    expect(resolveClipsStatus(input({ clipCount: 0, sourceState: 'index-empty' }))).toBe('silent')
    expect(resolveClipsStatus(input({ clipCount: 0, sourceState: 'sleeping' }))).toBe('silent')
    expect(resolveClipsStatus(input({ clipCount: 0, sourceState: 'no-storage' }))).toBe('silent')
    expect(resolveClipsStatus(input({ clipCount: 0, sourceState: 'unreachable' }))).toBe('silent')
  })

  it('a source that ANSWERED and holds nothing is empty, not silent', () => {
    // `ok` is the one state that means the list may be read as complete. A
    // quiet camera must still be able to say it was quiet.
    expect(resolveClipsStatus(input({ clipCount: 0, sourceState: 'ok' }))).toBe('empty')
  })

  it('an UNKNOWN state is not an answer either', () => {
    // D561 defect 1: `ok` is never a default, and a build that cannot read the
    // word has established nothing. Folding `unknown` into `empty` would put
    // the lie back one layer up.
    expect(resolveClipsStatus(input({ clipCount: 0, sourceState: 'unknown' }))).toBe('silent')
  })

  it('says nothing about sources it has not heard from', () => {
    // Not-yet-known must never look like not-installed (D315). Before
    // `listSources` lands the state is null, and the body says what it always
    // said.
    expect(resolveClipsStatus(input({ clipCount: 0, sourceState: null }))).toBe('empty')
  })

  it('names a stored pick this camera no longer has, ahead of everything else', () => {
    // The operator chose a source, and the camera stopped offering it. Showing
    // CamStack's clips under his own choice of "Camera storage" without a word
    // is the silent substitution D549 rejected at the catalog layer.
    expect(
      resolveClipsStatus(input({ clipCount: 0, chosenMissing: true, sourceState: 'ok' })),
    ).toBe('source-missing')
  })

  it('a dropped socket still beats both of them', () => {
    // The socket is the CAUSE. A source that "could not answer" over a dead
    // connection is that same cause under a second name.
    expect(
      resolveClipsStatus(
        input({ clipCount: 0, connected: false, sourceState: 'unreachable', chosenMissing: true }),
      ),
    ).toBe('hidden')
  })

  it('prefers the failure to the retry it is already running', () => {
    // React Query reports `isError` AND `isFetching` while a retry is in
    // flight; "loading" there would erase the failure the operator must see.
    expect(resolveClipsStatus(input({ clipCount: 0, failed: true, loading: true }))).toBe('failed')
  })
})

describe('clipsStatusMessageKey', () => {
  it('leaves the FAILURE to the one fault notice', () => {
    // The theater has exactly one grammar for "this did not load" — a band
    // under the playback bar, with the retry on it. A second red sentence in
    // the body is the duplication `timeline-faults` was created to remove.
    expect(clipsStatusMessageKey('failed')).toBeNull()
    expect(clipsStatusMessageKey('hidden')).toBeNull()
  })

  it('harvests the strings the parked ribbon was holding hostage', () => {
    expect(clipsStatusMessageKey('loading')).toBe('v2.clips.loading')
    expect(clipsStatusMessageKey('empty')).toBe('v2.clips.empty')
    expect(clipsStatusMessageKey('silent')).toBe('v2.clips.sourceSilent')
    expect(clipsStatusMessageKey('source-missing')).toBe('v2.clips.sourceMissing')
  })

  it('every key it can return exists in BOTH locales', () => {
    for (const locale of ['en', 'it'] as const) {
      const raw = readFileSync(join(process.cwd(), 'locales', `${locale}.json`), 'utf8')
      const json: unknown = JSON.parse(raw)
      for (const kind of ['loading', 'empty', 'silent', 'source-missing'] as const) {
        const key = clipsStatusMessageKey(kind)
        expect(key, kind).not.toBeNull()
        const value = (key as string)
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], json)
        expect(typeof value, `${locale}.${key as string}`).toBe('string')
      }
      // No `faultClips` line any more: clips mode has no read of its own —
      // its cards are derived from the event clusters and the recording
      // availability, so a failure is reported as `events` / `recordings`.
      const v2 = (json as { v2: Record<string, Record<string, unknown>> }).v2
      expect(v2.timeline.faultClips, `${locale}.v2.timeline.faultClips`).toBeUndefined()
    }
  })
})

// ─── where the note stands ────────────────────────────────────────────

describe('clipsNoteTopPx', () => {
  it('puts the note on the row the FIRST CARD would start on', () => {
    // Not centred in the body: a sentence floating in the middle of an empty
    // box describes nothing about the list it stands in for. The cards begin
    // at the top spacer, which is the readhead's own offset.
    expect(clipsNoteTopPx(64)).toBe(64)
  })

  it('never hugs the top edge before the body has been measured', () => {
    // `viewportHeight === 0` at first paint, so the indicator offset is 0 for
    // one frame — which is exactly the frame the loading note is on screen.
    expect(clipsNoteTopPx(0)).toBe(CLIPS_NOTE_MIN_TOP_PX)
    expect(clipsNoteTopPx(Number.NaN)).toBe(CLIPS_NOTE_MIN_TOP_PX)
  })

  it('rounds to a whole pixel', () => {
    expect(clipsNoteTopPx(64.4)).toBe(64)
  })
})

describe('a failure the SOURCE has already named is not a fault', () => {
  /**
   * The live report: *"homekit clips sembrano in errore su tutte le camere"*.
   *
   * On 592, 587, 618 and 640 the HomeKit source answers `index-empty` with
   * *"HomeKit recording is switched on for this camera but the advertisement
   * was WITHHELD (no-recordable-stream): no-enabled-stream: the camera has no
   * enabled RTSP profile — HomeKit has never recorded it, so there is nothing
   * to keep"*. That is a settled fact about the camera, not a request that
   * went wrong, and it is already on the wire: `listSources` carries the very
   * same `availability` the list call refuses with.
   *
   * The source refuses BY NAME on purpose (eight tests pin that, and they are
   * right — an empty array has nowhere to carry a reason). The defect was on
   * this side: `failed` was consulted before the source's state, so a named
   * refusal became a red fault band with a RETRY button — over a camera
   * HomeKit will never record, where retrying cannot help. And `silent`, the
   * arm written for exactly this, was unreachable: it needed `failed` to be
   * false, and `failed` is true precisely when the source refused.
   *
   * D62's rule, one layer up: disabled must never look like broken.
   */
  const named = {
    active: true,
    connected: true,
    loading: false,
    failed: true,
    clipCount: 0,
  } as const

  it('is SILENT, not failed, when the source named a state', () => {
    expect(resolveClipsStatus({ ...named, sourceState: 'index-empty' })).toBe('silent')
  })

  it.each(['index-empty', 'unreachable', 'sleeping', 'no-storage'] as const)(
    'is silent for %s — every named state, not a chosen few',
    (state) => {
      expect(resolveClipsStatus({ ...named, sourceState: state })).toBe('silent')
    },
  )

  it('is still FAILED when the source said ok and the query broke anyway', () => {
    // A transport fault with a healthy source is the case the fault band and
    // its retry exist for. Swallowing it into `silent` would be this defect
    // with the polarity reversed.
    expect(resolveClipsStatus({ ...named, sourceState: 'ok' })).toBe('failed')
  })

  it('is still FAILED when no source state is known yet', () => {
    expect(resolveClipsStatus({ ...named, sourceState: null })).toBe('failed')
    expect(resolveClipsStatus(named)).toBe('failed')
  })

  it('reports a missing PICK before a quiet source, as it always did', () => {
    // An operator looking at a source the camera no longer has must be told
    // that, not told why some other source is quiet.
    expect(
      resolveClipsStatus({ ...named, sourceState: 'index-empty', chosenMissing: true }),
    ).toBe('source-missing')
  })

  it('a dead socket silences the body before everything (the root overlay says why)', () => {
    expect(
      resolveClipsStatus({ ...named, connected: false, sourceState: 'index-empty' }),
    ).toBe('hidden')
  })

  it('says nothing at all while there are rows on screen', () => {
    expect(
      resolveClipsStatus({ ...named, clipCount: 12, sourceState: 'index-empty' }),
    ).toBe('hidden')
  })
})

/**
 * "Still looking" is not "nothing here".
 *
 * The operator opened a camera on a quiet day and read *"Nessuna clip per
 * questa telecamera"*, then found 21 clips by dragging the list one day back.
 * `empty` is a CLAIM about the camera; a surface that is still widening its
 * own window has not finished asking, and the two must not share a sentence
 * (D315: absent is not unknown).
 */
describe('resolveClipsStatus — a walk that has not finished', () => {
  const quiet = {
    active: true,
    connected: true,
    loading: false,
    failed: false,
    clipCount: 0,
    sourceState: 'ok' as const,
  }

  it('says SEARCHING while the window is still widening', () => {
    expect(resolveClipsStatus({ ...quiet, searching: true })).toBe('searching')
  })

  it('claims empty only once the walk has given up', () => {
    expect(resolveClipsStatus({ ...quiet, searching: false })).toBe('empty')
    expect(resolveClipsStatus(quiet)).toBe('empty')
  })

  it('never outranks a real answer — rows, a failure or a silent source win', () => {
    // The order matters: a searching flag must not hide a source that has
    // already explained itself, nor a transport fault with a retry.
    expect(resolveClipsStatus({ ...quiet, clipCount: 3, searching: true })).toBe('hidden')
    expect(resolveClipsStatus({ ...quiet, failed: true, searching: true })).toBe('failed')
    expect(resolveClipsStatus({ ...quiet, sourceState: 'sleeping', searching: true })).toBe('silent')
    expect(resolveClipsStatus({ ...quiet, connected: false, searching: true })).toBe('hidden')
  })

  it('is omitted-safe — a caller that says nothing keeps the old behaviour', () => {
    expect(resolveClipsStatus(quiet)).toBe('empty')
  })
})

describe('clipsStatusMessageKey — an exhausted walk names the span it searched', () => {
  it('says "in the loaded range" when no walk happened', () => {
    expect(clipsStatusMessageKey('empty')).toBe('v2.clips.empty')
    expect(clipsStatusMessageKey('empty', { days: 1 })).toBe('v2.clips.empty')
  })

  it('names the days once the walk covered more than one', () => {
    expect(clipsStatusMessageKey('empty', { days: 14 })).toBe('v2.clips.emptySearched')
  })

  it('has a message for the search itself', () => {
    expect(clipsStatusMessageKey('searching')).toBe('v2.clips.searching')
  })
})
