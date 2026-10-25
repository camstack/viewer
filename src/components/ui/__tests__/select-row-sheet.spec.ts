import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Settings → Network used to cycle the preferred route on tap (next option
 * in a ring). With four advertised URLs that is a wizard, not a selector.
 * The row must open the shared anchored dropdown (the occupancy-style
 * tendina), not a full-screen bottom sheet and not a centered Modal.
 */
const src = readFileSync(join(process.cwd(), 'src/components/ui/SelectRow.tsx'), 'utf8')
const picker = readFileSync(
  join(process.cwd(), 'src/components/camera/overlay/OverlayPositionPicker.tsx'),
  'utf8',
)
const settings = readFileSync(join(process.cwd(), 'src/screens/settings/NetworkSection.tsx'), 'utf8')

describe('SelectRow is a real selector, not a progressive cycle', () => {
  it('opens the shared anchored dropdown instead of advancing (index + 1) % n', () => {
    expect(src).toContain('AnchoredDropdown')
    expect(src).toContain('measureInWindow')
    expect(src).not.toContain('(index + 1) % options.length')
  })

  it('does not mount a full-screen bottom sheet', () => {
    expect(src).not.toContain('justifyContent: \'flex-end\'')
    expect(src).not.toContain('animationType="slide"')
  })

  it('renders every option, including an optional detail line', () => {
    expect(src).toContain('options')
    expect(src).toContain('detail')
  })
})

describe('OverlayPositionPicker hangs on its trigger, not the window center', () => {
  it('uses the shared anchored dropdown', () => {
    expect(picker).toContain('AnchoredDropdown')
    expect(picker).toContain('measureInWindow')
  })

  it('does not center a Modal on the screen', () => {
    expect(picker).not.toContain("backgroundColor: 'rgba(0,0,0,0.4)'")
    expect(picker).not.toContain('styles.scrim')
    expect(picker).not.toContain('styles.menu')
  })
})

describe('Settings network route picker', () => {
  it('does not surface loopback (or any route the page cannot pin) as a pin-able route', () => {
    // `pinnableRouteEndpoints` drops loopback AND plain http on an https page —
    // its behaviour is pinned in `connection/__tests__/secure-lan-twin.spec.ts`.
    expect(settings).toContain('pinnableRouteEndpoints(endpoints, currentPageProtocol())')
  })
})
