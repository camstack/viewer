import { describe, it, expect } from 'vitest'
import {
  STILL_MEDIA_PATH,
  buildStillMediaUrl,
  isStillPreviewFailed,
  stillEpochSec,
} from '../still-media-url.js'

describe('buildStillMediaUrl', () => {
  it('builds the recorder still path with device id and epoch seconds', () => {
    const url = buildStillMediaUrl('https://hub.local', 42, 1_700_000_000_000)
    expect(url).toBe(`https://hub.local${STILL_MEDIA_PATH}/42/1700000000`)
  })

  it('truncates sub-second precision to whole seconds', () => {
    const url = buildStillMediaUrl('https://hub.local', 7, 1_700_000_000_999)
    expect(url).toBe('https://hub.local/addon/recorder/still/7/1700000000')
  })

  it('trims trailing slashes on the server base', () => {
    const url = buildStillMediaUrl('https://hub.local///', 1, 5_000)
    expect(url).toBe('https://hub.local/addon/recorder/still/1/5')
  })

  it('snaps an exclusive-end bound off the uncovered millisecond (avoids 204)', () => {
    // Half-open export range [from, to). Requesting toMs exactly is the first
    // instant the still route does not cover → 204 on a closed segment end.
    const url = buildStillMediaUrl('https://hub.local', 7, 10_000, 'end')
    expect(url).toBe('https://hub.local/addon/recorder/still/7/9')
  })
})

describe('stillEpochSec', () => {
  it('floors a start bound (inclusive)', () => {
    expect(stillEpochSec(10_000, 'start')).toBe(10)
    expect(stillEpochSec(10_999, 'start')).toBe(10)
  })

  it('asks for the last covered second of an exclusive end bound', () => {
    expect(stillEpochSec(10_000, 'end')).toBe(9)
    expect(stillEpochSec(10_001, 'end')).toBe(10)
    expect(stillEpochSec(0, 'end')).toBe(0)
  })
})

describe('isStillPreviewFailed', () => {
  it('latches failure only for the instant that failed — a new atMs retries', () => {
    expect(isStillPreviewFailed(5_000, 5_000)).toBe(true)
    expect(isStillPreviewFailed(5_000, 6_000)).toBe(false)
    expect(isStillPreviewFailed(null, 5_000)).toBe(false)
  })
})
