/**
 * Which body a camera opens on, and — the half that is easy to lose — when it
 * must not decide at all.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { clipsModeDefaultFor } from '../clips-mode-default.js'

describe('clipsModeDefaultFor', () => {
  it('opens an event-recorded camera on its clips', () => {
    // The operator's sentence, directly: the continuous axis is mostly gaps
    // there, and every drag along it lands in one.
    expect(clipsModeDefaultFor('events')).toBe(true)
  })

  it('opens a continuously recorded camera on the timeline', () => {
    expect(clipsModeDefaultFor('continuous')).toBe(false)
  })

  it('opens a camera the hub does not record at all on its clips', () => {
    // More clearly than `events`: there is no continuous footage whatsoever.
    expect(clipsModeDefaultFor('off')).toBe(true)
  })

  it('decides NOTHING for a camera whose mode could not be read', () => {
    // `null` is an unreadable cap or an unanswered query, not "not events"
    // (D590, D315). Folding it into `false` would open an empty axis on the
    // strength of a question nobody answered.
    expect(clipsModeDefaultFor(null)).toBeNull()
  })

  it('never answers `false` for anything but a real `continuous`', () => {
    // A guard against the shape this keeps regressing into: a boolean-returning
    // helper where absence reads as the negative case.
    const answers = (['events', 'continuous', 'off', null] as const).map(clipsModeDefaultFor)
    expect(answers.filter((a) => a === false)).toHaveLength(1)
  })
})

/**
 * …and the timeline must actually RUN it.
 *
 * A rule nothing executes is the failure this area keeps producing. The pure
 * cases above stay green with the component unwired, which is exactly how a
 * previous helper here came to be computed and read for one field out of five.
 */
describe('TheaterTimeline applies the default', () => {
  const src = readFileSync(
    new URL('../TheaterTimeline.tsx', import.meta.url).pathname,
    'utf8',
  )

  it('asks the rule rather than re-deriving the condition', () => {
    expect(src).toContain('clipsModeDefaultFor(')
    expect(src).toContain('useRecordingMode(')
  })

  it('leaves the body alone until the mode is really known', () => {
    const at = src.indexOf('clipsModeDefaultFor(')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at - 200, at + 200)).toContain('=== null) return')
  })

  it('never overrides a body the operator has chosen', () => {
    // The toggle must claim the choice, or the default re-asserts itself the
    // next time the query settles and the control fights its owner.
    expect(src).toContain('clipsModeChosenRef.current = true')
    const toggle = src.indexOf('const toggleClips')
    expect(toggle).toBeGreaterThan(-1)
    expect(src.slice(toggle, toggle + 200)).toContain('clipsModeChosenRef.current = true')
  })

  it('re-asks when the camera changes', () => {
    // Camera B must not inherit the body the operator picked for camera A.
    expect(src).toContain('clipsModeChosenRef.current = false')
  })
})
