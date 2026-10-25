/**
 * Reading `videoclips.getPlaybackOptions` — the parse, and the four things a
 * read can BE.
 *
 * The parse is whole-or-nothing on purpose: a payload this build cannot read
 * becomes `null`, which the caller renders as the old freedom rather than as
 * an invented restriction. And the classifier is the place where "the hub has
 * no such method" (a real answer) is kept apart from "the read failed" and
 * "nothing has answered yet" — the collapse D315 exists to forbid.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLIP_BROKER_PACED_RATES } from '@camstack/types/client'
import { CLIP_PLAYBACK_OPTIONS } from '@camstack/types'

import {
  CLIP_LEGACY_RATE_LADDER,
  normaliseClipRates,
  parseClipPlaybackOptions,
} from '../clip-playback-options.js'
import { classifyClipPlaybackOptions } from '../use-clip-playback-options.js'

describe('the legacy ladder is the HUB’s, not a copy', () => {
  it('is CLIP_BROKER_PACED_RATES itself', () => {
    // A local copy of six numbers is the second authority D62 forbids: the day
    // the hub's ladder moves, the copy offers a rate nothing can deliver.
    expect([...CLIP_LEGACY_RATE_LADDER]).toEqual([...CLIP_BROKER_PACED_RATES])
  })
})

describe('normaliseClipRates', () => {
  it('sorts and de-duplicates — order is a fact about the set', () => {
    expect(normaliseClipRates([4, 1, 0.5, 1])).toEqual([0.5, 1, 4])
  })

  it('drops 0, negatives and non-numbers — 0 is pause, a separate control', () => {
    expect(normaliseClipRates([0, -2, 1, '2', null, Number.NaN, 2])).toEqual([1, 2])
  })

  it('REFUSES a ladder with no 1×', () => {
    // A camera that cannot be played at normal speed is not a restriction this
    // app can draw; the caller falls back to the freedom it always had.
    expect(normaliseClipRates([0.5, 2])).toBeNull()
    expect(normaliseClipRates([])).toBeNull()
    expect(normaliseClipRates('nope')).toBeNull()
  })
})

describe('parseClipPlaybackOptions', () => {
  it('reads each of the hub’s three envelopes verbatim', () => {
    for (const envelope of Object.values(CLIP_PLAYBACK_OPTIONS)) {
      expect(parseClipPlaybackOptions(JSON.parse(JSON.stringify(envelope)))).toEqual({
        transport: envelope.transport,
        seek: envelope.seek,
        stepBack: envelope.stepBack,
        scrub: envelope.scrub,
        rates: [...envelope.rates],
      })
    }
  })

  it('refuses a payload missing ANY verb — there is no partial declaration', () => {
    const whole = {
      transport: 'stream',
      seek: 'forward',
      stepBack: false,
      scrub: false,
      rates: [0.25, 0.5, 1],
    }
    expect(parseClipPlaybackOptions(whole)).not.toBeNull()
    for (const key of Object.keys(whole)) {
      const partial: Record<string, unknown> = { ...whole }
      delete partial[key]
      expect(parseClipPlaybackOptions(partial), key).toBeNull()
    }
  })

  it('refuses a word it cannot act on rather than passing it through', () => {
    const base = { transport: 'file', seek: 'free', stepBack: true, scrub: true, rates: [1] }
    expect(parseClipPlaybackOptions({ ...base, seek: 'rewind' })).toBeNull()
    expect(parseClipPlaybackOptions({ ...base, transport: 'carrier-pigeon' })).toBeNull()
    expect(parseClipPlaybackOptions({ ...base, stepBack: 'yes' })).toBeNull()
    expect(parseClipPlaybackOptions(null)).toBeNull()
    expect(parseClipPlaybackOptions([])).toBeNull()
  })
})

describe('classifyClipPlaybackOptions — pending is not absent', () => {
  const options = CLIP_PLAYBACK_OPTIONS.realtimeStream

  it('an unanswered query is `pending`, never `absent`', () => {
    expect(
      classifyClipPlaybackOptions({ asked: true, status: 'pending', options: undefined }),
    ).toBe('pending')
  })

  it('a FAILED read is `unknown` — not an answer, so not an absence either', () => {
    expect(classifyClipPlaybackOptions({ asked: true, status: 'error', options: undefined })).toBe(
      'unknown',
    )
  })

  it('a settled null is `absent` — the hub is older than this app', () => {
    // `getPlaybackOptions` is an optionalMethod, and capQuery answers null for
    // a procedure that is not there. That is a real answer.
    expect(classifyClipPlaybackOptions({ asked: true, status: 'success', options: null })).toBe(
      'absent',
    )
  })

  it('a settled envelope is `present`', () => {
    expect(classifyClipPlaybackOptions({ asked: true, status: 'success', options })).toBe('present')
  })

  it('keeps a FAILED read out of `absent`, which is the whole point of the rethrow', () => {
    // `capQuery`'s default swallows a failure to null, which here would read
    // as "this hub is too old to have the method". The hook passes
    // `rethrow: true` precisely so the two stay apart — asserted at the source
    // because nothing else in this repo can observe a react-query status
    // transition without standing up a live connection.
    const hook = readFileSync(
      join(process.cwd(), 'src', 'clips', 'use-clip-playback-options.ts'),
      'utf8',
    )
    expect(hook).toContain('{ rethrow: true }')
  })

  it('a question nobody asked is `absent`, never `pending`', () => {
    // No clip, no provider: nothing is in flight, so nothing will answer, and
    // a surface left pending forever would never draw a rate menu at all.
    expect(classifyClipPlaybackOptions({ asked: false, status: 'pending', options: undefined })).toBe(
      'absent',
    )
  })
})
