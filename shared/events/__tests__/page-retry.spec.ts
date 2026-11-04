import { describe, expect, it } from 'vitest'

import {
  PAGE_RETRY_ATTEMPTS,
  PAGE_RETRY_BASE_MS,
  PAGE_RETRY_CAP_MS,
  isTerminalPageError,
  pageRetryDelayMs,
} from '../page-retry.js'

const down = new Error('socket hang up')
const halfway = (): number => 0.5

function trpc(code: string, httpStatus?: number): Error {
  const data = httpStatus === undefined ? { code } : { code, httpStatus }
  return Object.assign(new Error(code), { data })
}

describe('page retry', () => {
  it('waits about 1s, then 2s, then 4s, and stops after four attempts', () => {
    expect(PAGE_RETRY_ATTEMPTS).toBe(4)
    expect(pageRetryDelayMs(0, down, halfway)).toBe(PAGE_RETRY_BASE_MS)
    expect(pageRetryDelayMs(1, down, halfway)).toBe(PAGE_RETRY_BASE_MS * 2)
    expect(pageRetryDelayMs(2, down, halfway)).toBe(PAGE_RETRY_CAP_MS)
    expect(pageRetryDelayMs(3, down, halfway)).toBeNull()
  })

  it('jitters around each step and never past the cap', () => {
    expect(pageRetryDelayMs(0, down, () => 0)).toBe(800)
    expect(pageRetryDelayMs(1, down, () => 1)).toBe(2_400)
    // The third step is the cap. Without the ceiling, full jitter is 4_800.
    expect(pageRetryDelayMs(2, down, () => 1)).toBe(PAGE_RETRY_CAP_MS)
  })

  it('does not retry an answer that cannot change', () => {
    expect(isTerminalPageError(trpc('UNAUTHORIZED', 401))).toBe(true)
    expect(isTerminalPageError(trpc('FORBIDDEN', 403))).toBe(true)
    expect(isTerminalPageError(trpc('NOT_FOUND', 404))).toBe(true)
    expect(isTerminalPageError({ shape: { data: { code: 'NOT_FOUND' } } })).toBe(true)
    expect(isTerminalPageError({ data: { httpStatus: 404 } })).toBe(true)
    expect(isTerminalPageError(new Error('NOT_FOUND: listRecentTracks'))).toBe(true)
    expect(pageRetryDelayMs(0, trpc('NOT_FOUND', 404), halfway)).toBeNull()
    expect(pageRetryDelayMs(0, trpc('UNAUTHORIZED'), halfway)).toBeNull()
    expect(pageRetryDelayMs(0, trpc('FORBIDDEN'), halfway)).toBeNull()
  })

  it('retries a blip: a timeout, a 5xx, a rate limit', () => {
    expect(isTerminalPageError(down)).toBe(false)
    expect(isTerminalPageError(trpc('TIMEOUT'))).toBe(false)
    expect(isTerminalPageError(trpc('INTERNAL_SERVER_ERROR', 500))).toBe(false)
    expect(isTerminalPageError({ data: { httpStatus: 429 } })).toBe(false)
    expect(pageRetryDelayMs(0, trpc('INTERNAL_SERVER_ERROR', 500), halfway)).toBe(PAGE_RETRY_BASE_MS)
  })
})
