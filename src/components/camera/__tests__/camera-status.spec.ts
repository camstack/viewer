import { describe, it, expect } from 'vitest'
import { cameraStatusKind, cameraStatusColor, DISABLED_DOT_COLOR, isAlive } from '../camera-status.js'
import type { ColorTokens } from '../../../theme/tokens.js'

const colors = {
  foregroundDisabled: '#grey',
  danger: '#red',
  info: '#blue',
  success: '#green',
} as unknown as ColorTokens

describe('cameraStatusKind — fixed priority', () => {
  it('disabled wins over everything (even online + recording)', () => {
    expect(cameraStatusKind({ disabled: true, online: true, recordingMode: 'continuous' })).toBe('disabled')
  })

  it('offline (not disabled) → offline, regardless of recording mode', () => {
    expect(cameraStatusKind({ disabled: false, online: false, recordingMode: 'continuous' })).toBe('offline')
  })

  it('online + continuous → recording-continuous (red)', () => {
    expect(cameraStatusKind({ disabled: false, online: true, recordingMode: 'continuous' })).toBe('recording-continuous')
  })

  it('online + events → recording-events (blue)', () => {
    expect(cameraStatusKind({ disabled: false, online: true, recordingMode: 'events' })).toBe('recording-events')
  })

  it('online + off → online (green)', () => {
    expect(cameraStatusKind({ disabled: false, online: true, recordingMode: 'off' })).toBe('online')
  })
})

describe('cameraStatusColor', () => {
  it('maps each kind to its token (disabled = black)', () => {
    expect(cameraStatusColor('disabled', colors)).toBe(DISABLED_DOT_COLOR)
    expect(cameraStatusColor('offline', colors)).toBe(colors.foregroundDisabled)
    expect(cameraStatusColor('recording-continuous', colors)).toBe(colors.danger)
    expect(cameraStatusColor('recording-events', colors)).toBe(colors.info)
    expect(cameraStatusColor('online', colors)).toBe(colors.success)
  })
})

/**
 * A recording mode that could not be READ is not `off`.
 *
 * ## What this pins, and what it cost
 *
 * The dot asks the screen aggregate first and falls back to this camera's own
 * recording query. On 2026-09-21 a non-admin user watched every camera report
 * GREEN — "online, not recording" — for cameras that were recording
 * continuously: the aggregate had failed transiently, the fallback answered
 * FORBIDDEN (the read was admin-gated, now fixed), `capQuery` collapsed both to
 * `null`, and `null` was mapped to `'off'`. After an app restart the aggregate
 * answered and the badges appeared, which is what proved it was a failed read
 * rather than a permission wall.
 *
 * A failed measurement may not be rendered as a value (D315, D393). `null`
 * reaches here as `null` and gets its own kind, so the dot can be honest
 * instead of confidently wrong.
 */
describe('cameraStatusKind — an unread recording mode', () => {
  it('is its own kind, not `online`', () => {
    expect(cameraStatusKind({ disabled: false, online: true, recordingMode: null })).toBe(
      'recording-unknown',
    )
  })

  it('stays distinct from a camera that genuinely is not recording', () => {
    const unknown = cameraStatusKind({ disabled: false, online: true, recordingMode: null })
    const off = cameraStatusKind({ disabled: false, online: true, recordingMode: 'off' })
    expect(unknown).not.toBe(off)
    expect(off).toBe('online')
  })

  it('never outranks disabled or offline — those are known facts about the camera', () => {
    expect(cameraStatusKind({ disabled: true, online: true, recordingMode: null })).toBe('disabled')
    expect(cameraStatusKind({ disabled: false, online: false, recordingMode: null })).toBe('offline')
  })

  it('does not pulse: an unknown state must not animate like a live recording', () => {
    expect(isAlive('recording-unknown')).toBe(false)
  })
})
