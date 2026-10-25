import { describe, it, expect } from 'vitest'
import {
  HAPTIC_EVENT_KINDS,
  HAPTIC_MIN_INTERVAL_MS,
  HAPTICS_DEFAULTS,
  canFireHaptic,
  detectionEventKind,
  hapticKindForEvent,
  isForegroundActive,
  isHapticEventEnabled,
  resolveHaptic,
  type HapticsConfig,
} from '../event-haptics.js'

/** A fully-armed config (master on + every kind on) for gating tests.
 *  `uiFeedback` is the PRESS-feedback authority and is deliberately irrelevant
 *  to every assertion in this file — event gating must never consult it. */
const ALL_ON: HapticsConfig = { enabled: true, motion: true, detection: true, person: true, uiFeedback: true }

describe('hapticKindForEvent', () => {
  it('maps motion → a light selection tick', () => {
    expect(hapticKindForEvent('motion')).toBe('selection')
  })
  it('maps a plain object detection → a light impact', () => {
    expect(hapticKindForEvent('detection')).toBe('impact-light')
  })
  it('maps a recognized person → a notification buzz', () => {
    expect(hapticKindForEvent('person')).toBe('notification')
  })
  it('covers every configurable event kind', () => {
    for (const kind of HAPTIC_EVENT_KINDS) {
      expect(hapticKindForEvent(kind)).toBeTruthy()
    }
  })
})

describe('isHapticEventEnabled — config gating', () => {
  it('blocks everything when the master switch is off', () => {
    const off: HapticsConfig = { ...ALL_ON, enabled: false }
    for (const kind of HAPTIC_EVENT_KINDS) {
      expect(isHapticEventEnabled(off, kind)).toBe(false)
    }
  })

  it('honors each per-kind toggle independently when master is on', () => {
    expect(isHapticEventEnabled({ enabled: true, motion: true, detection: false, person: false, uiFeedback: true }, 'motion')).toBe(true)
    expect(isHapticEventEnabled({ enabled: true, motion: false, detection: true, person: false, uiFeedback: true }, 'motion')).toBe(false)
    expect(isHapticEventEnabled({ enabled: true, motion: false, detection: true, person: false, uiFeedback: true }, 'detection')).toBe(true)
    expect(isHapticEventEnabled({ enabled: true, motion: false, detection: false, person: true, uiFeedback: true }, 'person')).toBe(true)
    expect(isHapticEventEnabled({ enabled: true, motion: false, detection: false, person: false, uiFeedback: true }, 'person')).toBe(false)
  })

  it('defaults ship master-off but every kind pre-armed', () => {
    expect(HAPTICS_DEFAULTS.enabled).toBe(false)
    expect(HAPTICS_DEFAULTS.motion).toBe(true)
    expect(HAPTICS_DEFAULTS.detection).toBe(true)
    expect(HAPTICS_DEFAULTS.person).toBe(true)
  })
})

describe('canFireHaptic — rate limiter', () => {
  it('always allows the first haptic (never fired yet)', () => {
    expect(canFireHaptic(0, 10_000)).toBe(true)
    expect(canFireHaptic(-1, 10_000)).toBe(true)
  })

  it('blocks a second haptic inside the min interval', () => {
    const last = 10_000
    expect(canFireHaptic(last, last + HAPTIC_MIN_INTERVAL_MS - 1)).toBe(false)
  })

  it('allows again exactly at the interval boundary', () => {
    const last = 10_000
    expect(canFireHaptic(last, last + HAPTIC_MIN_INTERVAL_MS)).toBe(true)
  })

  it('allows after the interval elapses', () => {
    expect(canFireHaptic(10_000, 20_000)).toBe(true)
  })

  it('respects a custom interval', () => {
    expect(canFireHaptic(1_000, 1_500, 1_000)).toBe(false)
    expect(canFireHaptic(1_000, 2_000, 1_000)).toBe(true)
  })
})

describe('isForegroundActive', () => {
  it('permits firing only in the active AppState', () => {
    expect(isForegroundActive('active')).toBe(true)
    expect(isForegroundActive('background')).toBe(false)
    expect(isForegroundActive('inactive')).toBe(false)
    expect(isForegroundActive('unknown')).toBe(false)
  })
})

describe('detectionEventKind', () => {
  it('is person when a recognized identity name is present', () => {
    expect(detectionEventKind(['car'], true)).toBe('person')
  })
  it('is person when any box is the person class (case-insensitive)', () => {
    expect(detectionEventKind(['Person'], false)).toBe('person')
    expect(detectionEventKind(['dog', 'person'], false)).toBe('person')
  })
  it('is a generic detection otherwise', () => {
    expect(detectionEventKind(['car', 'truck'], false)).toBe('detection')
    expect(detectionEventKind([], false)).toBe('detection')
  })
})

describe('resolveHaptic — the single decision', () => {
  it('returns the mapped kind when enabled and not rate-limited', () => {
    expect(resolveHaptic(ALL_ON, 'motion', 0, 10_000)).toBe('selection')
    expect(resolveHaptic(ALL_ON, 'detection', 0, 10_000)).toBe('impact-light')
    expect(resolveHaptic(ALL_ON, 'person', 0, 10_000)).toBe('notification')
  })

  it('returns null when the config gates the kind off', () => {
    const noMotion: HapticsConfig = { ...ALL_ON, motion: false }
    expect(resolveHaptic(noMotion, 'motion', 0, 10_000)).toBeNull()
  })

  it('returns null when the master switch is off', () => {
    const off: HapticsConfig = { ...ALL_ON, enabled: false }
    expect(resolveHaptic(off, 'person', 0, 10_000)).toBeNull()
  })

  it('returns null when rate-limited by a recent haptic', () => {
    expect(resolveHaptic(ALL_ON, 'motion', 9_500, 10_000)).toBeNull()
  })

  it('coalesces a burst: only the first of three rapid events fires', () => {
    const t0 = 10_000
    // First fires.
    const first = resolveHaptic(ALL_ON, 'detection', 0, t0)
    expect(first).toBe('impact-light')
    // Two more inside the 2s window are suppressed (caller keeps lastFiredAt = t0).
    expect(resolveHaptic(ALL_ON, 'detection', t0, t0 + 500)).toBeNull()
    expect(resolveHaptic(ALL_ON, 'person', t0, t0 + 1_900)).toBeNull()
    // After the window, the next one fires again.
    expect(resolveHaptic(ALL_ON, 'person', t0, t0 + HAPTIC_MIN_INTERVAL_MS)).toBe('notification')
  })
})
