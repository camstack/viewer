/**
 * Clips mode finds the newest clip on its own, and keeps what it found
 * (operator, 2026-11-17).
 *
 *  1. A camera with rare detections (the last one three days ago) opened in
 *     clips mode drew an empty list on Dominevo's own recordings: the empty-day
 *     walk only ran for a camera's own source (`nativeMode`). It now runs on
 *     both bodies and STOPS at the first answer that holds a clip, or at
 *     `MAX_AUTO_LOOKBACK_DAYS`.
 *  2. Scrolling back up (a seek or go-live onto a NEWER day) reset the loaded
 *     window to one day, so the list emptied and reloaded. In clips mode a
 *     forward move keeps the oldest loaded boundary: newer rows are added, the
 *     rows already there stay.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shiftLocalDay } from '../../../../lib/local-day.js'
import {
  autoWalkVerdict,
  nextLookbackDaysAfterDayChange,
  walkReadiness,
  type WalkReadinessInput,
} from '../lookback-walk.js'

const TODAY = new Date(2026, 10, 17).getTime()
const day = (n: number): number => shiftLocalDay(TODAY, -n)
const MAX = 14

const base = {
  clipsMode: true,
  clipCount: 0,
  lookbackDays: 1,
  maxDays: MAX,
  answered: true,
  failed: false,
  sourceOk: true,
} as const

describe('autoWalkVerdict — the empty-window walk', () => {
  it('steps one day further back when the answered window holds no clip', () => {
    expect(autoWalkVerdict(base)).toBe('step')
  })

  it('stops as soon as the window holds a clip', () => {
    expect(autoWalkVerdict({ ...base, clipCount: 1, lookbackDays: 4 })).toBe('found')
  })

  it('waits for THIS window to answer before stepping again', () => {
    expect(autoWalkVerdict({ ...base, answered: false })).toBe('wait')
    expect(autoWalkVerdict({ ...base, failed: true })).toBe('wait')
    expect(autoWalkVerdict({ ...base, sourceOk: false })).toBe('wait')
  })

  it('gives up at the bound, and says so', () => {
    expect(autoWalkVerdict({ ...base, lookbackDays: MAX })).toBe('exhausted')
  })

  it('does nothing outside clips mode', () => {
    expect(autoWalkVerdict({ ...base, clipsMode: false })).toBe('idle')
  })

  it('a camera whose last clip is 3 days back stops on day 4 of the walk', () => {
    const clipDays = new Set([3])
    let lookback = 1
    for (let i = 0; i < 30; i += 1) {
      const count = [...Array(lookback).keys()].filter((d) => clipDays.has(d)).length
      const v = autoWalkVerdict({ ...base, lookbackDays: lookback, clipCount: count })
      if (v !== 'step') {
        expect(v).toBe('found')
        break
      }
      lookback += 1
    }
    expect(lookback).toBe(4)
  })
})

describe('nextLookbackDaysAfterDayChange — scrolling back up keeps the list', () => {
  it('in clips mode, a move to a NEWER day keeps the oldest loaded boundary', () => {
    // Viewing the clip 3 days back, window = [day 3]. Scroll up to today.
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: day(3),
      previousLookbackDays: 1,
      nextDayFrom: TODAY,
      maxLookbackDays: 30,
      keepOnForward: true,
    })
    expect(shiftLocalDay(TODAY, 1 - days)).toBe(day(3))
  })

  it('keeps an extended window on go-live too', () => {
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: day(2),
      previousLookbackDays: 3,
      nextDayFrom: TODAY,
      maxLookbackDays: 30,
      keepOnForward: true,
    })
    expect(shiftLocalDay(TODAY, 1 - days)).toBe(day(4))
  })

  it('never past the cap', () => {
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: day(25),
      previousLookbackDays: 10,
      nextDayFrom: TODAY,
      maxLookbackDays: 30,
      keepOnForward: true,
    })
    expect(days).toBe(30)
  })

  it('the timeline (not clips) still starts a newer day over at one', () => {
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: day(3),
      previousLookbackDays: 1,
      nextDayFrom: TODAY,
      maxLookbackDays: 30,
    })
    expect(days).toBe(1)
  })
})

const ANSWERED = { answered: true, failed: false } as const
const PENDING = { answered: false, failed: false } as const
const FAILED = { answered: false, failed: true } as const

/** The walk's verdict for one render, the way the timeline composes it. */
function verdictFor(reads: Partial<WalkReadinessInput>): ReturnType<typeof autoWalkVerdict> {
  return autoWalkVerdict({
    clipsMode: true,
    clipCount: 0,
    lookbackDays: 1,
    maxDays: MAX,
    ...walkReadiness({
      sources: ANSWERED,
      nativeMode: false,
      files: PENDING,
      sourceOk: false,
      tracks: ANSWERED,
      footage: ANSWERED,
      ...reads,
    }),
  })
}

describe('walkReadiness — the source list comes first', () => {
  it('source list still pending: the recordings body waits, never steps', () => {
    // `resolveClipProvider` says `derived` until the list answers — a camera
    // with SD-card clips must not be walked as if it had none.
    expect(verdictFor({ sources: PENDING })).toBe('wait')
  })

  it('source list failed: no step', () => {
    expect(verdictFor({ sources: FAILED })).toBe('wait')
    expect(verdictFor({ sources: FAILED, nativeMode: true, files: ANSWERED, sourceOk: true })).toBe('wait')
  })

  it('recordings body: steps only once tracks AND footage of this window answered', () => {
    expect(verdictFor({})).toBe('step')
    expect(verdictFor({ tracks: PENDING })).toBe('wait')
    expect(verdictFor({ footage: PENDING })).toBe('wait')
    expect(verdictFor({ footage: FAILED })).toBe('wait')
  })

  it('a source\'s files: steps on the answered file list of an ok source', () => {
    const native = { nativeMode: true, files: ANSWERED, sourceOk: true, tracks: PENDING, footage: PENDING }
    expect(verdictFor(native)).toBe('step')
    expect(verdictFor({ ...native, files: PENDING })).toBe('wait')
    expect(verdictFor({ ...native, sourceOk: false })).toBe('wait')
  })
})

describe('the timeline wires both halves', () => {
  // TheaterTimeline is not mountable in jsdom (player, reanimated, hub reads),
  // so the composition is pinned at the two call sites; the behaviour of each
  // half is the specs above.
  const src = readFileSync(
    join(process.cwd(), 'src/components/camera/theater/TheaterTimeline.tsx'),
    'utf8',
  )

  it('the walk is judged through walkReadiness, with the source list first', () => {
    expect(src).toMatch(/\.\.\.walkReadiness\(\{\s*sources: \{ answered: clips\.sourcesAnswered, failed: clips\.sourcesFailed \}/)
  })

  it('a newer settled day keeps the loaded window in clips mode', () => {
    expect(src).toMatch(/keepOnForward: clipsMode/)
  })
})
