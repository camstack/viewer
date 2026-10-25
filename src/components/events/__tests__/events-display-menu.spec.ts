/**
 * @vitest-environment jsdom
 *
 * The Events page's eye — the shared `DisplayMenu` over the page's display
 * preferences. Pinned: every card has its title (operator, 2026-10-23: the
 * first card had none), single choices are segments, the tile details are
 * switches that each write their OWN preference, and the menu speaks the
 * Library filter row's type size.
 */
import React from 'react'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mountScreen } from '../../../testing/mount.js'
import { EventsDisplayMenu } from '../EventsDisplayMenu.js'
import { eventsDisplayMenu } from '../events-display-menu.js'
import { DEFAULTS, useSettingsStore } from '../../../store/settings-store.js'
import { TYPOGRAPHY } from '../../../theme/tokens.js'
import { TOGGLE_ROW_LABEL_LINES } from '../../ui/ToggleRow.js'
import i18n from '../../../app/i18n.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

beforeEach(() => {
  act(() => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, events: { ...DEFAULTS.events } } }))
})
afterEach(cleanup)

const events = (): typeof DEFAULTS.events => useSettingsStore.getState().settings.events
const t = (key: string): string => `T:${key}`

describe('eventsDisplayMenu — the declaration', () => {
  const sections = eventsDisplayMenu({ t, events: DEFAULTS.events, setEvents: vi.fn() })

  it('three cards, each with its own title', () => {
    expect(sections.map((s) => [s.id, s.title])).toEqual([
      ['tile-size', 'T:v2.library.tileSize'],
      ['tile-labels', 'T:v2.settings.tileLabelMode'],
      ['under-tile', 'T:v2.settings.tileDetailsSection'],
    ])
  })

  it('size and labels are single choices; the details are switches', () => {
    expect(sections.map((s) => s.items.map((i) => i.kind))).toEqual([['choice'], ['choice'], ['toggle', 'toggle']])
  })

  it('a choice answers with a value from its closed set, and an unknown value writes nothing', () => {
    const setEvents = vi.fn()
    const [size, labels] = eventsDisplayMenu({ t, events: DEFAULTS.events, setEvents })
    const density = size?.items[0]
    const mode = labels?.items[0]
    if (density?.kind !== 'choice' || mode?.kind !== 'choice') throw new Error('not choices')
    expect(density.options.map((o) => o.value)).toEqual(['compact', 'medium', 'large'])
    density.onChange('large')
    mode.onChange('label')
    density.onChange('huge')
    expect(setEvents.mock.calls).toEqual([
      ['gridDensity', 'large'],
      ['tileLabelMode', 'label'],
    ])
  })
})

describe('Events → eye, mounted', () => {
  it('offers the two tile details, all OFF until the operator opts in', () => {
    const { getByText } = mountScreen(React.createElement(EventsDisplayMenu))
    for (const label of ['Camera name', 'Zone', 'Under each tile', 'Tile size', 'Tile labels']) {
      expect(getByText(label)).toBeTruthy()
    }
    expect([events().tileDetailCamera, events().tileDetailZone]).toEqual([false, false])
  })

  it('each detail switch writes its OWN preference and nothing else', () => {
    const { getAllByRole } = mountScreen(React.createElement(EventsDisplayMenu))
    const switches = getAllByRole('switch')
    expect(switches).toHaveLength(2)
    act(() => { fireEvent.click(switches[1]!) })
    expect(events().tileDetailZone).toBe(true)
    expect(events().tileDetailCamera).toBe(false)
    act(() => { fireEvent.click(switches[0]!) })
    expect(events().tileDetailCamera).toBe(true)
  })

  it('a segment writes the tile size', () => {
    const { getByText } = mountScreen(React.createElement(EventsDisplayMenu))
    act(() => { fireEvent.click(getByText('Large')) })
    expect(events().gridDensity).toBe('large')
  })

  // Operator 2026-10-23: "reduce the font to that of the rest of the page" —
  // the filter chips' size, smaller than the menu's previous 14 pt.
  describe('type scale and long labels', () => {
    afterEach(async () => { await i18n.changeLanguage('en') })
    const fontSize = (el: HTMLElement): string => getComputedStyle(el).fontSize

    it('every label and segment uses the filter chips\' token size', () => {
      const { getByText } = mountScreen(React.createElement(EventsDisplayMenu))
      for (const label of ['Camera name', 'Zone', 'Small', 'Medium', 'Icon']) {
        expect(fontSize(getByText(label)), label).toBe(`${String(TYPOGRAPHY.size.sm)}px`)
      }
    })

    it('an Italian toggle label wraps (clamped, shrinkable) instead of being cut', async () => {
      await act(async () => { await i18n.changeLanguage('it') })
      const { getByText } = mountScreen(React.createElement(EventsDisplayMenu))
      const style = getComputedStyle(getByText('Nome telecamera'))
      expect(style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp')).toBe(String(TOGGLE_ROW_LABEL_LINES))
      expect(style.flexShrink).toBe('1')
    })
  })
})
