/**
 * The operator rule, pinned as a table: on a TABLET held in LANDSCAPE the
 * timeline is ALWAYS the right-hand rail, side by side with the stream.
 *
 * ## The defect this table exists to keep out
 *
 * "Spesso cambia la visualizzazione dei componenti. A volte la timeline va
 * sotto, orizzontale" — reported from a tablet in landscape, intermittently.
 *
 * The shape was derived from `Math.min(windowWidth, windowHeight) >= 768`. In
 * LANDSCAPE the shortest side IS the window height, and the window height is
 * the one dimension that shrinks at runtime while the device never moves:
 *
 *   - the soft keyboard on Android (`adjustResize`) — the camera switcher's
 *     search field, the export name, the date picker all open one,
 *   - browser chrome / the URL bar when the hub's web viewer is the surface,
 *   - Stage Manager and split-view resizes.
 *
 * An iPad 11" in landscape is 1194×834: SIXTY-SIX points of headroom over the
 * 768 floor. One keyboard and the same, motionless, landscape tablet stopped
 * being a tablet — the rail collapsed and the timeline went back under the
 * picture. That is the oscillation, and it is why the tablet question is now
 * asked of a dimension the keyboard cannot touch (`screenMinSide`, the shortest
 * side of the DEVICE screen) while only the orientation is read off the window.
 *
 * Each row below is a real surface. The keyboard rows are the regression.
 */
import { describe, it, expect } from 'vitest'
import {
  isUnexpectedPortraitStack,
  resolveDetailLayoutMode,
  type DetailLayoutMode,
} from '../detail-layout.js'

interface LayoutCase {
  readonly name: string
  readonly width: number
  readonly height: number
  /** Shortest side of the device screen; `undefined` on web (no device). */
  readonly screenMinSide?: number
  readonly isWeb: boolean
  readonly fullscreen?: boolean
  readonly expected: DetailLayoutMode
}

const CASES: readonly LayoutCase[] = [
  // ── Tablets in landscape: the rail, always ────────────────────────────────
  {
    name: 'iPad 10.9" landscape',
    width: 1180,
    height: 820,
    screenMinSide: 820,
    isWeb: false,
    expected: 'wide',
  },
  {
    name: 'iPad 11" landscape',
    width: 1194,
    height: 834,
    screenMinSide: 834,
    isWeb: false,
    expected: 'wide',
  },
  {
    name: 'iPad landscape with the KEYBOARD open (height shrunk to 420)',
    width: 1180,
    height: 420,
    screenMinSide: 820,
    isWeb: false,
    expected: 'wide',
  },
  {
    name: 'Android tablet landscape with the keyboard open (1600×520)',
    width: 1600,
    height: 520,
    screenMinSide: 1000,
    isWeb: false,
    expected: 'wide',
  },
  {
    name: 'iPad landscape, Stage Manager window that is still landscape',
    width: 1024,
    height: 700,
    screenMinSide: 820,
    isWeb: false,
    expected: 'wide',
  },
  {
    name: 'mid-rotation frame on a tablet: a square window does NOT knock it out of the rail',
    width: 1000,
    height: 1000,
    screenMinSide: 820,
    isWeb: false,
    expected: 'wide',
  },

  // ── Tablets that are not landscape: unchanged ─────────────────────────────
  {
    name: 'iPad portrait keeps the stack (timeline under the stream)',
    width: 820,
    height: 1180,
    screenMinSide: 820,
    isWeb: false,
    expected: 'stack',
  },
  {
    name: 'iPad landscape, HALF split view — the window itself is portrait',
    width: 507,
    height: 1024,
    screenMinSide: 820,
    isWeb: false,
    expected: 'stack',
  },
  {
    name: 'explicit fullscreen still wins on a landscape tablet',
    width: 1180,
    height: 820,
    screenMinSide: 820,
    isWeb: false,
    fullscreen: true,
    expected: 'fill',
  },

  // ── Phones: unchanged (2026-08-08 operator revert) ────────────────────────
  {
    name: 'iPhone landscape fills the window — the drawer, never the rail',
    width: 932,
    height: 430,
    screenMinSide: 430,
    isWeb: false,
    expected: 'fill',
  },
  {
    name: 'iPhone portrait keeps the stack',
    width: 430,
    height: 932,
    screenMinSide: 430,
    isWeb: false,
    expected: 'stack',
  },
  {
    name: 'iPad mini landscape stays on the phone path (short side 744 < 768)',
    width: 1133,
    height: 744,
    screenMinSide: 744,
    isWeb: false,
    expected: 'fill',
  },

  // ── Web: the window IS the device, so nothing changes ─────────────────────
  {
    name: 'wide desktop browser',
    width: 1440,
    height: 900,
    isWeb: true,
    expected: 'wide',
  },
  {
    name: 'tablet-sized web window in landscape',
    width: 1180,
    height: 820,
    isWeb: true,
    expected: 'wide',
  },
  {
    name: 'narrow landscape browser window keeps the fill path',
    width: 999,
    height: 700,
    isWeb: true,
    expected: 'fill',
  },
  {
    name: 'phone-sized browser window keeps the stack',
    width: 420,
    height: 800,
    isWeb: true,
    expected: 'stack',
  },
]

describe('camera-detail shape — the tablet-landscape matrix', () => {
  for (const c of CASES) {
    it(`${c.name} → ${c.expected}`, () => {
      expect(
        resolveDetailLayoutMode({
          width: c.width,
          height: c.height,
          screenMinSide: c.screenMinSide,
          isWeb: c.isWeb,
          fullscreen: c.fullscreen ?? false,
        }),
      ).toBe(c.expected)
    })
  }
})

describe('a landscape tablet never leaves the rail while the window is resized', () => {
  /** One physical iPad, motionless in landscape, through a whole keyboard
   *  session: focus a field, the keyboard animates up in steps, then down. Every
   *  frame must resolve to the SAME shape — that is what "deterministic, no
   *  oscillation" means for the operator. */
  it('holds `wide` across every height the keyboard animation passes through', () => {
    const heights = [820, 760, 700, 640, 560, 480, 420, 400, 420, 560, 700, 820]
    const modes = heights.map((height) =>
      resolveDetailLayoutMode({
        width: 1180,
        height,
        screenMinSide: 820,
        isWeb: false,
        fullscreen: false,
      }),
    )
    expect(new Set(modes)).toEqual(new Set(['wide']))
  })

  it('a phone in landscape is equally stable across its own keyboard session', () => {
    const heights = [430, 380, 300, 240, 300, 430]
    const modes = heights.map((height) =>
      resolveDetailLayoutMode({
        width: 932,
        height,
        screenMinSide: 430,
        isWeb: false,
        fullscreen: false,
      }),
    )
    expect(new Set(modes)).toEqual(new Set(['fill']))
  })
})

describe('degenerate measurements', () => {
  /** `useWindowDimensions` never reports these; the guard exists so a bad input
   *  degrades to the portrait stack instead of sizing a 380pt rail against
   *  nothing. */
  it('a zero or NaN dimension resolves to the stack, on any device', () => {
    expect(
      resolveDetailLayoutMode({
        width: 1180,
        height: 0,
        screenMinSide: 820,
        isWeb: false,
        fullscreen: false,
      }),
    ).toBe('stack')
    expect(
      resolveDetailLayoutMode({
        width: Number.NaN,
        height: 820,
        screenMinSide: 820,
        isWeb: false,
        fullscreen: false,
      }),
    ).toBe('stack')
  })
})

/**
 * The report predicate. Three rounds of "la timeline va sotto in landscape"
 * have arrived as prose because the only geometry line this screen writes is
 * `debug` and debug mode was off. This is what decides whether the NEXT report
 * is evidence.
 */
describe('a tablet on the portrait stack is reported, and only then', () => {
  const tablet = { screenMinSide: 820, isWeb: false, fullscreen: false }

  it('fires for the reported state: a tablet whose window is not landscape', () => {
    const input = { ...tablet, width: 820, height: 1180 }
    expect(isUnexpectedPortraitStack(input, resolveDetailLayoutMode(input))).toBe(true)
  })

  it('fires for a HALF-WIDTH split view on a landscape iPad — the case prose cannot distinguish', () => {
    const input = { ...tablet, width: 507, height: 1024 }
    expect(isUnexpectedPortraitStack(input, resolveDetailLayoutMode(input))).toBe(true)
  })

  it('stays silent when the tablet is side by side, which is the whole point', () => {
    const input = { ...tablet, width: 1194, height: 834 }
    expect(resolveDetailLayoutMode(input)).toBe('wide')
    expect(isUnexpectedPortraitStack(input, resolveDetailLayoutMode(input))).toBe(false)
  })

  it('stays silent on a phone, whose portrait stack is the design', () => {
    const input = { screenMinSide: 430, isWeb: false, fullscreen: false, width: 430, height: 932 }
    expect(resolveDetailLayoutMode(input)).toBe('stack')
    expect(isUnexpectedPortraitStack(input, resolveDetailLayoutMode(input))).toBe(false)
  })
})
