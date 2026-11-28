import { describe, it, expect } from 'vitest'
import { onDemandInsets } from '../ondemand-insets.js'
import { PHONE_BAR_HEIGHT, WIDE_BAR_HEIGHT } from '../../navigation/bar-kind.js'
import { bottomNavFootprint } from '../../navigation/bottom-nav-metrics.js'
import { SIDE_NAV_WIDTH } from '../../navigation/side-nav-metrics.js'

const SAFE = { top: 47, bottom: 34, left: 0, right: 0 }
const phone = { showSidebar: false, compactSidebar: false }

describe('what the floating player keeps clear of, per route', () => {
  it('a tab root: the home bar on top, the floating capsule below', () => {
    const i = onDemandInsets({ pathname: '/cameras', safe: SAFE, ...phone })
    expect(i.top).toBe(SAFE.top + PHONE_BAR_HEIGHT)
    expect(i.bottom).toBe(bottomNavFootprint({ visible: true, insetBottom: SAFE.bottom }))
    expect(i.bottom).toBeGreaterThan(SAFE.bottom)
  })

  it('a wide window: the 56pt bar and the rail replace the capsule', () => {
    const i = onDemandInsets({ pathname: '/cameras', safe: SAFE, showSidebar: true, compactSidebar: false })
    expect(i.top).toBe(SAFE.top + WIDE_BAR_HEIGHT)
    expect(i.bottom).toBe(SAFE.bottom)
    expect(i.left).toBe(SIDE_NAV_WIDTH)
  })

  it('a picture route (the live camera) has no bar: only the safe area', () => {
    const i = onDemandInsets({ pathname: '/camera/7', safe: SAFE, ...phone })
    expect(i).toEqual(SAFE)
  })

  it('an inner page spends its own header at the top and nothing at the bottom', () => {
    const i = onDemandInsets({ pathname: '/settings/notifications', safe: SAFE, ...phone })
    expect(i.top).toBeGreaterThan(SAFE.top)
    expect(i.bottom).toBe(SAFE.bottom)
  })
})
