import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every failure in the theater reaches the operator's eyes, in ONE grammar.
 *
 * `resolveTimelineFaults` is pure and tested, but a pure function cannot see a
 * caller that stopped calling it — and both defects this replaces were exactly
 * that shape:
 *
 *  • 2026-08-14: `listTracks` recorded a SUCCESS with no rows, so an unreadable
 *    day was painted as a quiet camera. Every unit test passed.
 *  • `useRecordingAvailability` did the same thing and still does not have an
 *    `isError` unless the call site asks capQuery to rethrow. A failed coverage
 *    read draws the exact picture of a camera with no footage.
 *
 * So the chain is guarded end to end:
 *
 *   capQuery({ rethrow }) → the hook REJECTS → isError
 *     → resolveTimelineFaults → TimelineView.faults → TimelineFaultNotice
 *
 * SOURCE guards for the reason `tracks-fault-wiring.spec.ts` was one: this suite
 * runs in `node` with no react renderer, so the component cannot be mounted and
 * a `.spec.tsx` would be silently never collected.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const read = (...parts: readonly string[]): string => readFileSync(join(SRC, ...parts), 'utf8')

describe('a load that failed says so', () => {
  it('the TRACK fetch rejects instead of reporting an empty day', () => {
    const src = read('data', 'use-device-tracks.ts')
    expect(src).toContain('rethrow: true')
    expect(src).toContain('deadlineMs: BULK_QUERY_DEADLINE_MS')
  })

  it('the COVERAGE fetch rejects instead of reporting a day with no footage', () => {
    // Without this there is no `isError`, the recordings row of the notice can
    // never light, and every guard below is decoration.
    const src = read('data', 'use-recording.ts')
    expect(src).toContain('{ rethrow: true }')
  })

  it('the theater feeds all THREE signals into the one rule', () => {
    const src = read('components', 'camera', 'theater', 'TheaterTimeline.tsx')
    expect(src).toContain('resolveTimelineFaults(')
    expect(src).toContain('failed: coverageQuery.isError')
    expect(src).toContain('fetching: coverageQuery.isFetching')
    // The `events` signal is the track feed's. A feed whose failure never
    // arrived here would paint an unreadable day as an empty one, which is the
    // defect this whole notice exists for.
    expect(src).toContain('failed: tracksQuery.isError')
    expect(src).toContain('fetching: tracksQuery.isFetching')
    expect(src).toContain('failed: streamFailed')
    // Real refetches, not a state reset that changes nothing.
    expect(src).toContain('void refetchCoverage()')
    expect(src).toContain('void refetchTracks()')
    // And the binding has to actually reach the view.
    expect(src).toContain('faults={{ faults, onRetry: retryFault, onDismiss: dismissFault }}')
  })

  it('the view renders ONE notice, docked under the playback bar', () => {
    const src = read('components', 'camera', 'theater', 'TimelineView.tsx')
    expect(src).toContain('<TimelineFaultNotice')
    expect(src).toContain('faults={faults.faults}')
    expect(src).toContain('onDismiss={faults.onDismiss}')
    // Order in the column is the requirement, not an accident: the notice must
    // sit between the bar and the heatmap.
    const bar = src.indexOf('<TimelinePlaybackBar')
    const notice = src.indexOf('<TimelineFaultNotice')
    const heatmap = src.indexOf('<HeatmapBar')
    expect(bar).toBeGreaterThan(-1)
    expect(notice).toBeGreaterThan(bar)
    expect(heatmap).toBeGreaterThan(notice)
  })

  it('the old second grammar is gone — no floating red-bordered card', () => {
    // A leftover that describes the right design reads as verification. The
    // operator's complaint WAS this card's border.
    const view = read('components', 'camera', 'theater', 'TimelineView.tsx')
    expect(view).not.toContain('TimelineTracksFaultNotice')
    const bar = read('components', 'camera', 'theater', 'TimelinePlaybackBar.tsx')
    expect(bar).not.toContain('styles.fault')
  })

  it('the notice renders NOTHING when nothing failed', () => {
    // The one property that keeps this notice worth reading. A quiet camera
    // showing a warning is how an operator learns to ignore warnings.
    const src = read('components', 'camera', 'theater', 'TimelineFaultNotice.tsx')
    expect(src).toContain('if (faults.length === 0) return null')
  })

  it('every string exists in BOTH locales — an untranslated key renders as its path', () => {
    for (const locale of ['en', 'it'] as const) {
      const json: unknown = JSON.parse(readFileSync(join(ROOT, 'locales', `${locale}.json`), 'utf8'))
      const v2 = (json as { v2: Record<string, Record<string, unknown>> }).v2
      for (const key of [
        'faultStream',
        'faultRecordings',
        'faultEvents',
        'faultDismiss',
        'loadRetry',
        'loadRetrying',
      ]) {
        expect(typeof v2.timeline[key], `${locale}.v2.timeline.${key}`).toBe('string')
      }
      for (const key of ['scrubForward', 'scrubBackward']) {
        expect(typeof v2.streamBar[key], `${locale}.v2.streamBar.${key}`).toBe('string')
      }
    }
  })
})

describe('the scrub direction reaches the play button', () => {
  it('the screen reads it from the machine it already owns', () => {
    const src = read('screens', 'CameraDetailScreen.tsx')
    expect(src).toContain('scrubDirection={selectScrubDirection(playback.state)}')
  })

  it('the timeline forwards it into the playback binding', () => {
    const src = read('components', 'camera', 'theater', 'TheaterTimeline.tsx')
    expect(src).toContain('scrubDirection: props.scrubDirection')
  })

  it('the bar swaps the glyph and the label, and stops being pressable', () => {
    const src = read('components', 'camera', 'theater', 'TimelinePlaybackBar.tsx')
    expect(src).toContain("scrubDirection === 'forward' ? (")
    expect(src).toContain('<FastForward')
    expect(src).toContain('<Rewind')
    // The a11y label follows the glyph — an arrow announced as "Pause" is worse
    // than no arrow.
    expect(src).toContain("t('v2.streamBar.scrubForward')")
    expect(src).toContain("t('v2.streamBar.scrubBackward')")
    expect(src).toContain('disabled={scrubbing}')
  })

  it('the direction is derived from the retarget, not from a second reading', () => {
    // A parallel signal fed from the scroll offset can disagree with the target
    // the indicator, the cursor and the `scrubTo` emit all read.
    const src = read('recording', 'playback-machine.ts')
    expect(src).toContain('resolveScrubDirection(')
    expect(src).toContain('state.seekTarget ?? state.playhead')
    const scrub = read('components', 'camera', 'theater', 'use-timeline-scrub.ts')
    expect(scrub).not.toContain('resolveScrubDirection')
  })
})
