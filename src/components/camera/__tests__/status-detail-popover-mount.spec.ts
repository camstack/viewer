/**
 * @vitest-environment jsdom
 *
 * The badges STOP being mute: each is a button, and pressing it opens a layer
 * that states the figures. Asserted by mounting and clicking, because the
 * defect being retired ("the icons say nothing") is exactly a missing
 * interaction — a pure test of the lines cannot see whether anything is
 * pressable.
 *
 * Held down here:
 *   - the badge exposes itself as a button with a SPEAKING label (the figures
 *     are in it, so the popover is not the only way to learn them);
 *   - pressing opens the layer, and its numbers are the device's;
 *   - pressing the backdrop closes it — it is a popover, not a screen;
 *   - the second badge REPLACES the first's layer rather than stacking one over
 *     the other.
 */
import { afterEach, describe, expect, it } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { View } from 'react-native'

import '../../../app/i18n.js'
import { THEME } from '../../../theme/tokens.js'
// The card is the menus' glass (`GlassPanel`), which reads the theme.
import { ThemeProvider } from '../../../theme/theme-provider.js'
import { BatteryBadge } from '../BatteryBadge.js'
import { NetworkLinkBadge } from '../NetworkLinkBadge.js'
import {
  StatusBadgeButton,
  StatusDetailPopover,
  STATUS_DETAIL_BACKDROP_TEST_ID,
  STATUS_DETAIL_CARD_TEST_ID,
  useStatusDetail,
} from '../StatusDetailPopover.js'
import { batteryDetailLines, networkLinkDetailLines } from '../status-detail-lines.js'
import type { BatteryStatus } from '../../../data/use-battery.js'
import type { NetworkLinkStatus } from '../../../data/use-network-link.js'

afterEach(cleanup)

const BATTERY: BatteryStatus = { level: 63, charging: 'solar', sleeping: true }
const LINK: NetworkLinkStatus = { type: 'wifi', signal: 41, ssid: 'CasaWifi' }

function Subject(): React.ReactElement {
  const status = useStatusDetail()
  return React.createElement(
    View,
    null,
    React.createElement(
      StatusBadgeButton,
      { subject: 'battery' as const, lines: batteryDetailLines(BATTERY), controller: status, key: 'b' },
      React.createElement(BatteryBadge, { battery: BATTERY, colors: THEME.light, compact: true }),
    ),
    React.createElement(
      StatusBadgeButton,
      { subject: 'link' as const, lines: networkLinkDetailLines(LINK), controller: status, key: 'l' },
      React.createElement(NetworkLinkBadge, { link: LINK, colors: THEME.light, compact: true }),
    ),
    React.createElement(StatusDetailPopover, {
      controller: status,
      battery: BATTERY,
      link: LINK,
      colors: THEME.light,
      placement: 'below' as const,
      key: 'p',
    }),
  )
}

const card = (c: HTMLElement): HTMLElement | null => c.querySelector(`[data-testid="${STATUS_DETAIL_CARD_TEST_ID}"]`)

describe('status badges open a detail popover', () => {
  it('exposes each badge as a button whose label already carries the figures', () => {
    const { container } = render(React.createElement(ThemeProvider, null, React.createElement(Subject)))
    const buttons = container.querySelectorAll('[role="button"]')
    expect(buttons.length).toBe(2)
    const labels = Array.from(buttons).map((b) => b.getAttribute('aria-label') ?? '')
    expect(labels.some((l) => l.includes('63%'))).toBe(true)
    expect(labels.some((l) => l.includes('41%') && l.includes('CasaWifi'))).toBe(true)
  })

  it('opens on press with the numbers, and closes on a tap outside', () => {
    const { container } = render(React.createElement(ThemeProvider, null, React.createElement(Subject)))
    expect(card(container)).toBeNull()

    const batteryButton = container.querySelectorAll('[role="button"]')[0]
    expect(batteryButton).toBeDefined()
    fireEvent.click(batteryButton as Element)

    const open = card(container)
    expect(open).not.toBeNull()
    expect(open?.textContent).toContain('63%')
    // The sleeping state is a line of its own, in words.
    expect(open?.textContent).toContain('Sleeping')

    const backdrop = container.querySelector(`[data-testid="${STATUS_DETAIL_BACKDROP_TEST_ID}"]`)
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(card(container)).toBeNull()
  })

  it('the link badge shows its own detail, replacing the battery one', () => {
    const { container } = render(React.createElement(ThemeProvider, null, React.createElement(Subject)))
    const buttons = container.querySelectorAll('[role="button"]')
    fireEvent.click(buttons[0] as Element)
    fireEvent.click(buttons[1] as Element)
    const open = card(container)
    expect(open).not.toBeNull()
    expect(open?.textContent).toContain('41%')
    expect(open?.textContent).toContain('CasaWifi')
    expect(open?.textContent).not.toContain('63%')
    // One layer at a time.
    expect(container.querySelectorAll(`[data-testid="${STATUS_DETAIL_CARD_TEST_ID}"]`).length).toBe(1)
  })

  it('pressing the same badge again closes it', () => {
    const { container } = render(React.createElement(ThemeProvider, null, React.createElement(Subject)))
    const batteryButton = container.querySelectorAll('[role="button"]')[0] as Element
    fireEvent.click(batteryButton)
    expect(card(container)).not.toBeNull()
    fireEvent.click(batteryButton)
    expect(card(container)).toBeNull()
  })
})
