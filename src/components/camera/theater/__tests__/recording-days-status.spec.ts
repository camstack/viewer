import { describe, it, expect } from 'vitest'
import {
  resolveRecordingDaysStatus,
  type RecordingDaysSignal,
} from '../recording-days-status.js'

const signal = (patch: Partial<RecordingDaysSignal>): RecordingDaysSignal => ({
  connected: true,
  failed: false,
  fetching: false,
  ...patch,
})

describe('resolveRecordingDaysStatus', () => {
  it('a month that answered is ready — an un-dotted day is genuinely un-dotted', () => {
    expect(resolveRecordingDaysStatus(signal({}))).toBe('ready')
  })

  it('an attempt in flight is loading, not an empty month', () => {
    expect(resolveRecordingDaysStatus(signal({ fetching: true }))).toBe('loading')
  })

  it('a spent attempt is FAILED — the whole point: no dot must not read as no footage', () => {
    expect(resolveRecordingDaysStatus(signal({ failed: true }))).toBe('failed')
  })

  it('a failure with a retry in flight still reads as loading', () => {
    // React Query retries once. Flashing "could not read this month" for the
    // 300 ms before the retry lands is noise, and noise is what teaches an
    // operator to ignore the report that matters.
    expect(resolveRecordingDaysStatus(signal({ failed: true, fetching: true }))).toBe('loading')
  })

  it('a dropped socket raises nothing — the connection banner owns that cause', () => {
    expect(resolveRecordingDaysStatus(signal({ connected: false, failed: true }))).toBe('ready')
    expect(resolveRecordingDaysStatus(signal({ connected: false, fetching: true }))).toBe('ready')
  })

  /**
   * The multi-camera month. The call SUCCEEDED — `failed` is false and there is
   * nothing to retry — but some cameras answered `unreadable`, so the dots are
   * the union of the ones that did. A day with no dot is now "no footage on the
   * cameras that answered", which is not the claim `ready` makes.
   */
  it('a month some cameras could not answer is PARTIAL, not ready', () => {
    expect(resolveRecordingDaysStatus(signal({ unknownCameras: 2 }))).toBe('partial')
  })

  it('zero unreadable cameras is the ordinary ready month', () => {
    expect(resolveRecordingDaysStatus(signal({ unknownCameras: 0 }))).toBe('ready')
  })

  it('a retry in flight still beats partial — the answer may yet complete', () => {
    expect(resolveRecordingDaysStatus(signal({ unknownCameras: 2, fetching: true }))).toBe('loading')
  })

  it('an outright failure beats partial — nothing answered at all', () => {
    expect(resolveRecordingDaysStatus(signal({ unknownCameras: 2, failed: true }))).toBe('failed')
  })

  it('a dropped socket still raises nothing, partial included', () => {
    expect(
      resolveRecordingDaysStatus(signal({ connected: false, unknownCameras: 3 })),
    ).toBe('ready')
  })
})
