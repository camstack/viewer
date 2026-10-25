import { describe, it, expect } from 'vitest'

import { HAPTICS_DEFAULTS, type HapticsConfig } from '../event-haptics.js'
import {
  UI_HAPTIC_INTENTS,
  hapticKindForIntent,
  isUiHapticEnabled,
  resolveUiHaptic,
  type UiHapticIntent,
} from '../haptics-policy.js'

function config(patch: Partial<HapticsConfig> = {}): HapticsConfig {
  return { ...HAPTICS_DEFAULTS, ...patch }
}

describe('haptics-policy — semantic intent → physical kind', () => {
  it('maps a plain tap to a LIGHT impact', () => {
    expect(hapticKindForIntent('tap')).toBe('impact-light')
  })

  it('maps an important action to a MEDIUM impact', () => {
    expect(hapticKindForIntent('action')).toBe('impact-medium')
  })

  it('maps a scrub detent to the SELECTION tick', () => {
    // The picker-wheel click on both platforms — crisper and cheaper than an
    // impact, which matters when dozens go past in one drag.
    expect(hapticKindForIntent('detent')).toBe('selection')
  })

  it('makes a detent LIGHTER than an ordinary tap', () => {
    // If a notch felt like a button press, a drag across a busy hour would read
    // as a burst of accidental presses.
    expect(hapticKindForIntent('detent')).not.toBe(hapticKindForIntent('tap'))
    expect(hapticKindForIntent('detent')).not.toBe(hapticKindForIntent('action'))
  })

  it('maps a positive outcome to a SUCCESS notification', () => {
    expect(hapticKindForIntent('success')).toBe('notification-success')
  })

  it('maps a failed outcome to an ERROR notification', () => {
    expect(hapticKindForIntent('error')).toBe('notification-error')
  })

  it('is total over every declared intent (no undefined fallthrough)', () => {
    for (const intent of UI_HAPTIC_INTENTS) {
      expect(typeof hapticKindForIntent(intent)).toBe('string')
    }
  })

  it('gives each intent a DISTINCT physical kind', () => {
    const kinds = UI_HAPTIC_INTENTS.map(hapticKindForIntent)
    expect(new Set(kinds).size).toBe(UI_HAPTIC_INTENTS.length)
  })
})

describe('haptics-policy — the single authority gate', () => {
  it('is ON out of the box: touch feedback is opt-OUT, not opt-in', () => {
    expect(HAPTICS_DEFAULTS.uiFeedback).toBe(true)
    expect(isUiHapticEnabled(config())).toBe(true)
  })

  it('is silenced by the user switch', () => {
    expect(isUiHapticEnabled(config({ uiFeedback: false }))).toBe(false)
  })

  it('is INDEPENDENT of the event-haptics master switch', () => {
    // `enabled` gates passive event pulses (default OFF). A user who never
    // wants motion buzzing must still get button feedback.
    expect(HAPTICS_DEFAULTS.enabled).toBe(false)
    expect(isUiHapticEnabled(config({ enabled: false, uiFeedback: true }))).toBe(true)
    expect(isUiHapticEnabled(config({ enabled: true, uiFeedback: false }))).toBe(false)
  })
})

describe('haptics-policy — resolveUiHaptic (the one decision)', () => {
  it('returns the mapped kind when enabled', () => {
    expect(resolveUiHaptic(config(), 'tap')).toBe('impact-light')
    expect(resolveUiHaptic(config(), 'action')).toBe('impact-medium')
  })

  it('returns null for EVERY intent when the switch is off — no exceptions', () => {
    const off = config({ uiFeedback: false })
    for (const intent of UI_HAPTIC_INTENTS) {
      expect(resolveUiHaptic(off, intent)).toBeNull()
    }
  })

  it('does NOT rate-limit: a press is user-driven and always deserves its answer', () => {
    // Unlike event haptics (coalesced by HAPTIC_MIN_INTERVAL_MS), a deliberate
    // press must never feel dead — PTZ nudges fire far faster than 2s apart.
    const c = config()
    const intent: UiHapticIntent = 'tap'
    expect(resolveUiHaptic(c, intent)).not.toBeNull()
    expect(resolveUiHaptic(c, intent)).not.toBeNull()
    expect(resolveUiHaptic(c, intent)).not.toBeNull()
  })
})
