import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The `capQuery` rethrow FAMILY, guarded as a family.
 *
 * `capQuery` swallows every failure to `null` by default, which is right for a
 * badge ("we don't know" renders happily) and a lie for anything whose EMPTY
 * result is itself an assertion about the world. For those the swallow makes
 * React Query record a SUCCESS holding nothing: `isError` is false, the retry
 * never runs, the empty answer is CACHED, and the screen states as fact
 * something it never learned.
 *
 * The same defect has now been fixed four times in four different queries:
 *
 *   • 75bdb68 — `listTracks`: an unreadable day painted as a quiet camera.
 *   • 05da647 — `getAvailability` (theater): a failed coverage read painted as
 *     a camera with no footage.
 *   • here    — `getDaysWithRecordings`: a month that could not be read painted
 *     as a month with no recordings, in the date picker's dots.
 *   • gone    — `listRecentTracks` + `getAvailability` in `use-grid-timeline-
 *     events.ts`, the grid band's own copies, which additionally CAUGHT their
 *     own rejection at the call site. The band was deleted on 2026-09-02 (the
 *     grid page mounts the theater timeline now) and its two queries went with
 *     it, so the family shrank by the two members that had the defect WORST.
 *     The guards are removed rather than pointed at the survivors: a clause
 *     asserting a rethrow in a file that no longer exists is a leftover that
 *     reads as verification.
 *
 * A pure test cannot see a call site that stopped asking, so the guard is on
 * the SOURCE — the same reason `timeline-faults-wiring.spec.ts` is a source
 * guard. Removing a `rethrow` here turns this suite red.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const read = (...parts: readonly string[]): string => readFileSync(join(SRC, ...parts), 'utf8')

describe('a query whose EMPTY answer is a claim must reject when it fails', () => {
  it('the date-picker dots: getDaysWithRecordings rethrows', () => {
    const src = read('data', 'use-recording.ts')
    const at = src.indexOf("'getDaysWithRecordings'")
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at)).toContain('{ rethrow: true }')
  })

  it('auth.me rethrows — a swallowed null is cached forever as not-admin', () => {
    // staleTime Infinity + capQuery's default swallow is how every admin
    // flag disappeared: one void-input rejection became a SUCCESS holding
    // null, useIsAdmin read that as false, and nothing ever asked again.
    const src = read('data', 'use-me.ts')
    const at = src.indexOf("'me'")
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at)).toContain('{ rethrow: true }')
  })

  it('the status dot: getDeviceConfig rethrows, and no default invents a mode', () => {
    // A non-admin session drew every camera GREEN on 2026-09-21 while two of
    // them recorded continuously: the screen aggregate had failed, the
    // fallback was admin-gated (now `protected`), `capQuery` swallowed both to
    // `null`, and `null` was mapped to `'off'`. It healed on an app restart,
    // which is what proved it was a failed read (D590).
    const src = read('data', 'use-recording.ts')
    const at = src.indexOf("'getDeviceConfig'")
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at)).toContain('{ rethrow: true }')
    // …and the mode must be allowed to be unknown all the way out.
    expect(src).toContain('UseQueryResult<RecordingMode | null>')
  })

  it('the recording band: getAvailability rethrows on BOTH the single and batch paths', () => {
    // `recording: []` and "could not read the footage" draw the same empty
    // band. The file's own `mergeKnowledge` already rules that a camera whose
    // footage did not answer cannot be spoken for; before this the single path
    // swallowed and the comment saying otherwise was a leftover.
    //
    // Both calls live in `use-recording-provider-plan.ts` since the reads were
    // partitioned by source: ONE definition of "ask every camera at its own
    // source", shared by the coverage bar and the activity read. The rule is
    // asserted where the calls are, and `use-timeline-activity.ts` is checked
    // for not having grown a second, unguarded copy.
    const src = read('data', 'use-recording-provider-plan.ts')
    for (const method of ["'getAvailability'", "'getAvailabilityBatch'"]) {
      const at = src.indexOf(method)
      expect(at, method).toBeGreaterThan(-1)
      expect(src.slice(at, at + 400), method).toContain('{ rethrow: true }')
    }
    expect(read('data', 'use-timeline-activity.ts')).not.toContain("'getAvailability'")
  })

  it('no call site catches its own rejection back into a null', () => {
    // A local `.catch(() => null)` defeats the rethrow completely and looks
    // like defensive code. It is asserted on the reads the theater timeline
    // makes, which are the ones that survived the grid band's deletion.
    for (const file of ['use-recording.ts', 'use-timeline-activity.ts', 'use-device-tracks.ts']) {
      expect(read('data', file), file).not.toContain('.catch(')
    }
  })
})

describe('the failure reaches a surface that says something honest', () => {
  it('the calendar consults the status rule instead of the raw Set', () => {
    const theater = read('components', 'camera', 'theater', 'TheaterTimeline.tsx')
    expect(theater).toContain('resolveRecordingDaysStatus({')
    expect(theater).toContain('failed: recordingDaysQuery.isError')
    expect(theater).toContain('fetching: recordingDaysQuery.isFetching')
    expect(theater).toContain('daysStatus: recordingDaysStatus')
  })

  it('the panel suppresses the dots AND says why — one without the other is the bug', () => {
    const panel = read('components', 'camera', 'theater', 'TimelineDatePanel.tsx')
    // A dot is drawn only from a status that ANSWERED. `partial` joined
    // `ready` on 2026-09-02, when the month became the whole view's: those dots
    // came from cameras that did answer, and suppressing them to avoid
    // over-claiming about the ones that did not would hide real footage. The
    // incompleteness is said out loud instead, one line above the grid.
    expect(panel).toContain(
      "props.daysStatus === 'ready' || props.daysStatus === 'partial'",
    )
    expect(panel).toContain('markedDays={answered ? props.daysSet : null}')
    // …and the kit calendar dots a day only from a set it was GIVEN: `null`
    // (unanswered) dots nothing.
    expect(read('components', 'ui', 'MonthCalendar.tsx')).toContain(
      'const marked = markedDays !== null && markedDays.has(c.epoch)',
    )
    expect(panel).toContain("props.daysStatus === 'failed'")
    expect(panel).toContain("t('v2.theater.recordingDaysFailed')")
    expect(panel).toContain("props.daysStatus === 'partial'")
    expect(panel).toContain("t('v2.theater.recordingDaysPartial')")
    // The old boolean must be gone: two knobs for one fact is how a surface
    // ends up rendering the stale one.
    expect(panel).not.toContain('props.loading')
  })

  it('every new string exists in BOTH locales', () => {
    for (const locale of ['en', 'it'] as const) {
      const json: unknown = JSON.parse(readFileSync(join(ROOT, 'locales', `${locale}.json`), 'utf8'))
      const v2 = (json as { v2: Record<string, Record<string, unknown>> }).v2
      expect(typeof v2.theater.recordingDaysFailed, `${locale}.v2.theater.recordingDaysFailed`).toBe('string')
    }
  })
})
