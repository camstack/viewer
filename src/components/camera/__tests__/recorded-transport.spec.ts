import { describe, it, expect } from 'vitest'
import { CLIP_BROKER_PACED_RATES } from '@camstack/types/client'
import * as transport from '../recorded-transport.js'
import {
  formatRateLabel,
  playbackRateMenuOrder,
  shouldShowStepControls,
} from '../recorded-transport.js'
import { CLIP_LEGACY_RATE_LADDER } from '../../../clips/clip-playback-options.js'

/**
 * The hub's own `clampPlaybackRate`, derived the way the hub derives it: from
 * the ENDS of the ladder, never from a literal (D621). Spelling a `4` here is
 * what made this file a second authority — and a false one the day the broker
 * gained 8× over media it holds.
 */
function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return Math.min(
    Math.max(...CLIP_BROKER_PACED_RATES),
    Math.max(Math.min(...CLIP_BROKER_PACED_RATES), rate),
  )
}

describe('the rate ladder belongs to the HUB, not to this file', () => {
  // This app used to own a `PLAYBACK_RATE_OPTIONS` constant of six numbers and
  // offer every one of them on every camera — including cameras whose clips
  // arrive at 1.01× realtime and can never be paced above 1× (D612). The set
  // now comes off the wire, and its OUTER BOUND came off with it (D621): a
  // `MAX_PLAYBACK_RATE = 4` lived here, documented as "the mirror of the hub
  // `clampPlaybackRate`", read by nothing but its own test, and wrong from the
  // moment the broker's ladder reached 8.
  it('the fallback ladder is the hub’s own CLIP_BROKER_PACED_RATES', () => {
    expect([...CLIP_LEGACY_RATE_LADDER]).toEqual([...CLIP_BROKER_PACED_RATES])
  })

  it('includes 1× (normal speed)', () => {
    expect(CLIP_LEGACY_RATE_LADDER).toContain(1)
  })

  it('every rate the hub paces survives the hub’s own clamp unchanged', () => {
    // Ladder-agnostic on purpose: this asserted `<= 4` against a six-element
    // literal, so bumping `@camstack/types` turned it red on a commit that had
    // nothing to do with playback.
    for (const rate of CLIP_BROKER_PACED_RATES) {
      expect(clampPlaybackRate(rate), `${rate}`).toBe(rate)
    }
  })

  it('is ascending, positive and free of 0 — 0 is pause, a separate control', () => {
    const ladder = [...CLIP_BROKER_PACED_RATES]
    expect(ladder.length).toBeGreaterThan(0)
    expect([...ladder].sort((a, b) => a - b)).toEqual(ladder)
    expect(new Set(ladder).size).toBe(ladder.length)
    for (const rate of ladder) expect(rate).toBeGreaterThan(0)
  })

  it('holds no second bound of its own — the mirror is gone, not moved', () => {
    // A guard rather than a paragraph: the defect was not the number 4, it was
    // that this file answered a question the hub owns. Re-introducing any
    // local ceiling brings the disagreement back, and nothing RENDERS it — it
    // was read by its own test and by nothing else for the whole time it was
    // false — so nothing else would notice.
    //
    // Asserted over the module's EXPORTS rather than its source text: the
    // docblock names the three it dropped, and a grep for the names cannot
    // tell an explanation from a resurrection.
    expect(Object.keys(transport).sort()).toEqual([
      'formatRateLabel',
      'playbackRateMenuOrder',
      'shouldShowStepControls',
    ])
  })
})

describe('recorded-transport — the ORDER a menu lists the rates in', () => {
  // > "i playback rates dovrebbero avere in basso i piu' lenti, i piu' alti in
  // > alto" — the operator, 2026-09-23.
  //
  // The docked bar's menu opens UPWARD, so its FIRST row is the one furthest
  // from the chip (and from the thumb). Listing it ascending put 0.25× at the
  // top of the screen and 4× against the chip — the reverse of what he reads.
  const LADDER: readonly number[] = [0.25, 0.5, 1, 1.5, 2, 4]

  it('lists an UPWARD menu fastest-first, so the slow end sits against the chip', () => {
    expect([...playbackRateMenuOrder('up', LADDER)]).toEqual([4, 2, 1.5, 1, 0.5, 0.25])
  })

  it('leaves a DOWNWARD menu ascending — the order inverts with the geometry', () => {
    expect([...playbackRateMenuOrder('down', LADDER)]).toEqual([...LADDER])
  })

  it('keeps working over a ladder that VARIES per camera', () => {
    // The whole point of D612's viewer half: the rate set is no longer one
    // constant, and the operator's ordering rule has to survive that.
    expect([...playbackRateMenuOrder('up', [0.25, 0.5, 1])]).toEqual([1, 0.5, 0.25])
    expect([...playbackRateMenuOrder('up', [0.25, 1, 8])]).toEqual([8, 1, 0.25])
    expect([...playbackRateMenuOrder('up', [1])]).toEqual([1])
    expect([...playbackRateMenuOrder('up', [])]).toEqual([])
  })

  it('is a re-ORDERING and nothing else: same rates, same count, both ways', () => {
    for (const direction of ['up', 'down'] as const) {
      const order = playbackRateMenuOrder(direction, LADDER)
      expect(order.length).toBe(LADDER.length)
      expect([...order].sort((a, b) => a - b)).toEqual([...LADDER])
    }
  })

  it('never mutates what it was handed — the DATA stays ascending for every other reader', () => {
    // The camera's ladder is read low-to-high by `clipRateChoices`, by the
    // clamp mirror above and by the label test below. A menu order built by
    // reversing it IN PLACE would silently re-order all of them — and now that
    // the array comes from a react-query cache, it would re-order it for every
    // other consumer of that cache entry too.
    const ladder = [...LADDER]
    playbackRateMenuOrder('up', ladder)
    playbackRateMenuOrder('up', ladder)
    expect(ladder).toEqual([0.25, 0.5, 1, 1.5, 2, 4])
  })
})

describe('recorded-transport — rate labels', () => {
  it('renders each rate as an "N×" label', () => {
    expect(formatRateLabel(1)).toBe('1×')
    expect(formatRateLabel(0.25)).toBe('0.25×')
    expect(formatRateLabel(1.5)).toBe('1.5×')
    expect(formatRateLabel(4)).toBe('4×')
    expect(formatRateLabel(8)).toBe('8×')
  })

  it('labels WHATEVER ladder the hub declares, one distinct label per rate', () => {
    // This used to compare against a six-element literal of the ladder's
    // labels, so it went red on the commit that bumped `@camstack/types` —
    // a file with nothing to do with the bump. What it actually has to prove
    // is that the formatter covers the ladder: every rate gets a label, the
    // labels are distinct, and each one reads back as the rate it names.
    const labels = CLIP_BROKER_PACED_RATES.map(formatRateLabel)
    expect(new Set(labels).size).toBe(CLIP_BROKER_PACED_RATES.length)
    labels.forEach((label, i) => {
      expect(label.endsWith('×'), label).toBe(true)
      expect(Number(label.slice(0, -1)), label).toBe(CLIP_BROKER_PACED_RATES[i])
    })
  })
})

describe('recorded-transport — frame-step visibility', () => {
  it('shows the frame-step controls ONLY while paused', () => {
    expect(shouldShowStepControls(true)).toBe(true)
  })

  it('hides the frame-step controls while playing', () => {
    expect(shouldShowStepControls(false)).toBe(false)
  })
})
