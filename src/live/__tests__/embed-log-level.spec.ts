import { describe, it, expect } from 'vitest'
import { embedLogLevel, embedInfoScopes } from '../embed-log-level.js'
import { shouldShip } from '../../lib/logger.js'

/**
 * The two halves of "an embed diagnostic reaches the hub":
 *  1. the native bridge forwards it at `info` (`embedLogLevel`), and
 *  2. `embed:<scope>` is in the logger's ALWAYS_SHIP_SCOPES.
 *
 * Either half alone ships NOTHING when debug mode is off, which is how the
 * operator files reports. This suite asserts the join, so a scope promoted in
 * one place and forgotten in the other fails here instead of silently
 * producing a diagnostic that never leaves the device.
 */
describe('embed diagnostics actually leave the device', () => {
  it('promotes the adaptive-tier decision line to info', () => {
    expect(embedLogLevel('adaptive')).toBe('info')
  })

  it('leaves ordinary embed chatter at debug', () => {
    expect(embedLogLevel('scrub')).toBe('debug')
    expect(embedLogLevel('live:retry')).toBe('debug')
    expect(embedLogLevel('')).toBe('debug')
  })

  it('ships every promoted scope with debug mode OFF', () => {
    for (const scope of embedInfoScopes()) {
      expect(
        shouldShip(embedLogLevel(scope), `embed:${scope}`, false),
        `embed:${scope} is forwarded at info but is not in ALWAYS_SHIP_SCOPES, so it never leaves the device`,
      ).toBe(true)
    }
  })

  it('names the adaptive scope explicitly — the line the operator asked for', () => {
    expect(embedInfoScopes()).toContain('adaptive')
    expect(shouldShip('info', 'embed:adaptive', false)).toBe(true)
  })

  it('does NOT ship a scope that was never promoted', () => {
    // Guards the assertion above from passing vacuously: `shouldShip` must be
    // capable of returning false for an unlisted embed scope at info.
    expect(shouldShip('info', 'embed:scrub', false)).toBe(false)
  })
})
