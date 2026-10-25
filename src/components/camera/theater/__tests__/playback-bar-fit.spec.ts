import { describe, it, expect } from 'vitest'
import {
  playbackBarFit,
  playbackBarTiers,
  playbackBarSideWidths,
  acceptMeasuredWidth,
  estimateWidestBar,
  NARROWEST_BAR_WIDTH,
  NARROWEST_TIER,
  type PlaybackBarFit,
  type PlaybackBarHost,
} from '../playback-bar-fit.js'
import { REFERENCE_WIDTH, scaleForWidth, type ToolbarDensity } from '../timeline-scale-tokens.js'

/**
 * The playback bar must never paint one control over another, at any width,
 * at any toolbar density.
 *
 * Operator, 2026-10-06, web, timeline on the right (380pt rail, `medium`
 * density — the default): the record dot sat on top of +10s next to the
 * speed chip. Measured in a browser, the bar overlapped at EVERY width at
 * `medium` and `large`: the estimate scaled by width only (density is ×1.2 /
 * ×1.45 on top), and priced the two equal-weight side groups as their sum
 * instead of twice the wider one.
 */

const DENSITIES: readonly ToolbarDensity[] = ['small', 'medium', 'large']

/** The theater: wraps, records, steps. */
function theater(width: number, density: ToolbarDensity): PlaybackBarHost {
  return { scale: scaleForWidth(width, density), canWrap: true, trailingIcon: true, canStep: true }
}

/** The on-demand overlay: fixed chrome height, no record, no step, `small`. */
function overlay(width: number): PlaybackBarHost {
  return { scale: scaleForWidth(width), canWrap: false, trailingIcon: false, canStep: false }
}

/** A fixed-height host that does carry everything — the worst single-row case. */
function fixedFull(width: number, density: ToolbarDensity): PlaybackBarHost {
  return { scale: scaleForWidth(width, density), canWrap: false, trailingIcon: true, canStep: true }
}

const FULL = playbackBarTiers(true)[0]
const FULL_BETWEEN = playbackBarTiers(true)[1]

/**
 * What the bar measured of itself on the web build at the 420pt rail, `medium`
 * (2026-10-07): LIVE + padlock 70, Go-to-live 69, the "1×" speed chip 59.
 */
const RAIL_420_MEASURED = { leading: 70, rate: 59 }

function measuredTheater(width: number, density: ToolbarDensity): PlaybackBarHost {
  return { ...theater(width, density), measured: RAIL_420_MEASURED }
}

/** A host that draws NO armed shape — prices the idle row alone. */
function idleOnly(host: PlaybackBarHost): PlaybackBarHost {
  return { ...host, trailingIcon: false }
}

describe('the operator case, 2026-10-07: the 420pt rail wrapped a bar that fits on one row', () => {
  /**
   * Web, timeline on the right, `medium` (the default): the rail is 420pt
   * (the screenshot's ~840 px at a 2× display). The controls take 411pt; the
   * symmetric row asked 442 because it charged LIVE for the width of record +
   * speed, so the bar wrapped with a third of its row empty.
   */
  it('is ONE row — the transport centred in the space between the sides', () => {
    const fit = playbackBarFit(420, measuredTheater(420, 'medium'))
    expect(fit.wrap).toBe(false)
    expect(fit).toEqual(FULL_BETWEEN)
    expect(fit).toMatchObject({ allowJog: true, allowStep: true, secondary: 'inline', reserveSlots: true })
  })

  it('symmetric centring is what does not fit there — the fallback is exercised, not skipped', () => {
    const host = measuredTheater(420, 'medium')
    expect(estimateWidestBar(FULL, 420, host)).toBeGreaterThan(420)
    expect(estimateWidestBar(FULL_BETWEEN, 420, host)).toBeLessThanOrEqual(420)
  })

  it('one row in BOTH shapes the bar switches between: idle, and a capture or selection armed', () => {
    const host = measuredTheater(420, 'medium')
    // The idle row alone (record + speed at the end, every transport slot)…
    expect(estimateWidestBar(FULL_BETWEEN, 420, idleOnly(host))).toBeLessThanOrEqual(420)
    // …and the worst case including Discard + Accept, which is what decides.
    expect(estimateWidestBar(FULL_BETWEEN, 420, host)).toBeLessThanOrEqual(420)
  })

  it('the first paint — nothing measured yet — is already one row, so it never jumps', () => {
    expect(playbackBarFit(420, theater(420, 'medium')).wrap).toBe(false)
  })

  it('840pt (the screenshot read as points): one row centred on the bar, idle and armed', () => {
    for (const host of [theater(840, 'medium'), measuredTheater(840, 'medium')]) {
      expect(playbackBarFit(840, host)).toEqual(FULL)
      expect(playbackBarFit(840, idleOnly(host))).toEqual(FULL)
    }
  })

  it('a row whose sides are held at the priced width still fits (the play button does not move)', () => {
    const host = measuredTheater(420, 'medium')
    const sides = playbackBarSideWidths(FULL_BETWEEN, host)
    // 10 + 5 a side of padding and group gap, the reserved transport (212).
    expect(20 + 10 + 212 + sides.leading + sides.trailing).toBeLessThanOrEqual(420)
    expect(sides).toEqual({ leading: 70, trailing: 36 + 5 + 59 })
  })
})

describe('the operator case, 2026-10-06: 380pt rail, timeline on the right', () => {
  it('at medium density the bar no longer claims one row that overlaps — it wraps', () => {
    const fit = playbackBarFit(380, theater(380, 'medium'))
    expect(fit.wrap).toBe(true)
    // Nothing is dropped and nothing is hidden: wrapping is the first remedy.
    expect(fit).toMatchObject({ allowJog: true, allowStep: true, secondary: 'inline' })
    // The single row it used to draw does NOT fit — the defect, priced.
    expect(estimateWidestBar(FULL, 380, theater(380, 'medium'))).toBeGreaterThan(380)
  })

  it('at small density it is one full row, as it was', () => {
    expect(playbackBarFit(380, theater(380, 'small'))).toEqual(FULL)
  })

  it('a phone in portrait (390pt, small) keeps the single full row', () => {
    expect(playbackBarFit(REFERENCE_WIDTH, theater(REFERENCE_WIDTH, 'small'))).toEqual(FULL)
  })
})

describe('the ladder runs in the operator’s order', () => {
  it('centred → centred between the sides → wrap → compressed gaps → overflow → shed transport', () => {
    const wrapLadder = playbackBarTiers(true)
    expect(wrapLadder.map((t) => t.wrap)).toEqual([false, false, true, true, false, false, false, false])
    expect(wrapLadder.slice(0, 2).map((t) => t.centring)).toEqual(['bar', 'between'])
    const fixed = playbackBarTiers(false)
    // Never a wrap where the host cannot grow.
    expect(fixed.some((t) => t.wrap)).toBe(false)
    expect(fixed.map((t) => [t.centring, t.gaps, t.secondary, t.allowStep, t.allowJog])).toEqual([
      ['bar', 'normal', 'inline', true, true],
      ['between', 'normal', 'inline', true, true],
      ['bar', 'tight', 'inline', true, true],
      ['bar', 'tight', 'overflow', true, true],
      ['bar', 'tight', 'overflow', false, true],
      ['bar', 'tight', 'overflow', false, false],
    ])
  })

  it('a fixed-height host moves record + speed into the overflow before shedding any transport', () => {
    // 260pt at medium density: too narrow for one inline row.
    const fit = playbackBarFit(260, fixedFull(260, 'medium'))
    expect(fit.wrap).toBe(false)
    expect(fit.secondary).toBe('overflow')
    expect(fit.allowJog).toBe(true)
  })

  it('the overlay at its narrowest panel keeps the whole bar (it has no record control)', () => {
    expect(playbackBarFit(222, overlay(222))).toEqual(FULL)
  })
})

describe('the tier it picks actually fits — every width, every density', () => {
  const rank = (f: PlaybackBarFit, ladder: readonly PlaybackBarFit[]): number =>
    ladder.length - ladder.indexOf(f)

  for (const density of DENSITIES) {
    it(`theater, ${density}`, () => {
      for (let w = NARROWEST_BAR_WIDTH; w <= 900; w += 1) {
        const host = theater(w, density)
        const fit = playbackBarFit(w, host)
        expect(estimateWidestBar(fit, w, host), `${w}pt`).toBeLessThanOrEqual(w)
      }
    })

    it(`theater with WIDER-than-estimated measured chips, ${density}`, () => {
      // A measurement that comes back wider than the constant (a longer rate
      // label, a translated LIVE) is priced as it is — never the constant.
      for (let w = NARROWEST_BAR_WIDTH; w <= 900; w += 1) {
        const host: PlaybackBarHost = { ...theater(w, density), measured: { leading: 110, rate: 95 } }
        const fit = playbackBarFit(w, host)
        // Chips this wide cannot fit the floor at the narrowest widths; every
        // tier ABOVE the floor that is chosen must.
        if (fit === NARROWEST_TIER) continue
        expect(estimateWidestBar(fit, w, host), `${w}pt`).toBeLessThanOrEqual(w)
      }
    })

    it(`fixed host, ${density}, from the drawer/overlay widths up`, () => {
      // A fixed host at `large` density is the one place the floor can still
      // be wider than the room at very small widths; the hosts that exist at
      // those widths either wrap (the drawer) or are `small` (the overlay).
      const from = density === 'small' ? NARROWEST_BAR_WIDTH : 236
      for (let w = from; w <= 800; w += 1) {
        const host = fixedFull(w, density)
        const fit = playbackBarFit(w, host)
        if (fit === NARROWEST_TIER) continue
        expect(estimateWidestBar(fit, w, host), `${w}pt`).toBeLessThanOrEqual(w)
      }
    })

    it(`is monotone — a wider bar never carries less (${density})`, () => {
      const ladder = playbackBarTiers(true)
      for (let w = NARROWEST_BAR_WIDTH; w < 900; w += 1) {
        const a = playbackBarFit(w, theater(w, density))
        const b = playbackBarFit(w + 1, theater(w + 1, density))
        expect(rank(a, ladder) <= rank(b, ladder), String(w)).toBe(true)
      }
    })
  }

  it('the ladder bottoms out at the narrowest width', () => {
    const host = fixedFull(NARROWEST_BAR_WIDTH, 'small')
    expect(estimateWidestBar(NARROWEST_TIER, NARROWEST_BAR_WIDTH, host)).toBeLessThanOrEqual(
      NARROWEST_BAR_WIDTH,
    )
  })
})

describe('the estimator is anchored to the component', () => {
  /**
   * At scale 1 (the first-paint estimate, measured on the web build): LIVE 59,
   * jog/step 30, play 40, record 30, speed chip 52; 8pt row padding a side,
   * 4pt gaps. Centred on the BAR the sides are equal-weight, so the row pays
   * twice the wider side: 16 + 8 + (40 + 4·30 + 4·4) + 2·(30 + 4 + 52) = 372.
   * Centred BETWEEN the sides it pays each once: 16 + 8 + 176 + 59 + 86 = 345.
   */
  it('prices the full single row at 372pt unscaled, 345pt centred between the sides', () => {
    const host = theater(REFERENCE_WIDTH, 'small')
    expect(estimateWidestBar(FULL, REFERENCE_WIDTH, host)).toBe(372)
    expect(estimateWidestBar(FULL_BETWEEN, REFERENCE_WIDTH, host)).toBe(345)
  })

  it('scales with the DENSITY, token by token, rounded the way the tokens round', () => {
    const small = estimateWidestBar(FULL, REFERENCE_WIDTH, theater(REFERENCE_WIDTH, 'small'))
    const medium = estimateWidestBar(FULL, REFERENCE_WIDTH, theater(REFERENCE_WIDTH, 'medium'))
    // ×1.2: pad 10, gap 5, button 36, play 48, LIVE 71, speed 62 —
    // 20 + 10 + (48 + 4·36 + 4·5) + 2·(36 + 5 + 62) = 448.
    expect(medium).toBe(448)
    expect(medium).toBeGreaterThan(small)
  })

  it('a measured chip replaces the constant; a failed measurement does not', () => {
    const base = theater(REFERENCE_WIDTH, 'medium')
    const measured: PlaybackBarHost = { ...base, measured: { leading: 69, rate: 59 } }
    // Idle trailing 36 + 5 + 59 = 100 instead of 103.
    expect(estimateWidestBar(FULL, REFERENCE_WIDTH, measured)).toBe(448 - 2 * 3)
    for (const bad of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const failed: PlaybackBarHost = { ...base, measured: { leading: bad, rate: bad } }
      expect(estimateWidestBar(FULL, REFERENCE_WIDTH, failed), String(bad)).toBe(448)
    }
  })

  it('an unknown host is priced at the width-only scale with every control', () => {
    expect(estimateWidestBar(FULL, REFERENCE_WIDTH)).toBe(372)
  })

  it('takes a new measurement only when it is usable and moved by half a point', () => {
    expect(acceptMeasuredWidth(undefined, 59)).toBe(true)
    expect(acceptMeasuredWidth(59, 59.3)).toBe(false)
    expect(acceptMeasuredWidth(59, 61)).toBe(true)
    expect(acceptMeasuredWidth(59, 0)).toBe(false)
    expect(acceptMeasuredWidth(undefined, Number.NaN)).toBe(false)
  })

  it('answers a degenerate width with the narrowest tier, never a crash', () => {
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(playbackBarFit(width)).toEqual(NARROWEST_TIER)
    }
  })
})
