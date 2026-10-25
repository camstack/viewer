/**
 * A camera with neither a battery nor a link had no badge — and therefore no
 * way to open the status card, which is where the stream numbers now live.
 *
 * That hit exactly the cameras most likely to be under investigation: the
 * permanently-powered, wired ones, which report no charge and whose link the
 * hub does not describe. The fallback glyph exists for them and ONLY for them:
 * a third icon next to the other two would be a third tap to learn what those
 * cards already carry.
 */
import { describe, expect, it } from 'vitest'
import { streamBadgeVisible } from '../StreamBadge.js'

describe('streamBadgeVisible', () => {
  it('is shown when a camera reports neither battery nor link', () => {
    expect(streamBadgeVisible({ batteryVisible: false, linkVisible: false })).toBe(true)
  })

  it('is NOT shown beside a battery badge — that card already carries the stream', () => {
    expect(streamBadgeVisible({ batteryVisible: true, linkVisible: false })).toBe(false)
  })

  it('is NOT shown beside a link badge, for the same reason', () => {
    expect(streamBadgeVisible({ batteryVisible: false, linkVisible: true })).toBe(false)
  })

  it('is NOT shown when both are there', () => {
    expect(streamBadgeVisible({ batteryVisible: true, linkVisible: true })).toBe(false)
  })
})
