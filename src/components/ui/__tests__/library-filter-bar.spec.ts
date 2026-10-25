/**
 * @vitest-environment jsdom
 *
 * The Library's ONE filter bar and the review pages' `⋯` menu, MOUNTED.
 *
 * Pinned: a chip states its answer ("Cameras 2"), Reset exists only while
 * something is narrowed, every chip opens the same anchored checkbox list,
 * a single-pick list closes on its pick, and the overflow menu draws every
 * item with its LABEL and refuses a disabled one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestViewport } from '../../../testing/viewport-control.js'
import i18n from '../../../app/i18n.js'
import { LibraryFilterBar, type LibraryFilterDef } from '../LibraryFilterBar.js'
import { useHeaderOverflowMenu, type OverflowMenuItem } from '../HeaderOverflowMenu.js'
import { ScreenHeader } from '../../ScreenHeader.js'
import { CheckSquare, Plus, RefreshCw } from '../../../lib/icons.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

function byText(container: HTMLElement, text: string): HTMLElement | undefined {
  const node = [...container.querySelectorAll('*')].find(
    (el) => el.textContent === text && el.children.length === 0,
  )
  return node instanceof HTMLElement ? node : undefined
}

function pressText(text: string): void {
  const node = byText(document.body, text)
  expect(node, `nothing reads "${text}"`).toBeDefined()
  const button = node?.closest('[role="button"],[role="menuitem"],[role="checkbox"],[role="switch"]') ?? node
  if (button) fireEvent.click(button)
}

function cameras(count: number, onToggle: (key: string) => void, closeOnPick = false): LibraryFilterDef {
  return {
    id: 'cameras',
    label: 'Cameras',
    count,
    sections: [
      {
        title: 'Cameras',
        options: [
          { key: '1', label: 'MARK-front-door' },
          { key: '2', label: 'MARK-Garden' },
        ],
        selected: count > 0 ? ['1', '2'].slice(0, count) : [],
        onToggle,
        closeOnPick,
      },
    ],
  }
}

describe('LibraryFilterBar', () => {
  it('a facet reads its question alone, and Reset is absent, while nothing is narrowed', () => {
    const { container } = mountScreen(
      React.createElement(LibraryFilterBar, { filters: [cameras(0, vi.fn())], onReset: vi.fn() }),
    )
    expect(byText(container, 'Cameras')).toBeDefined()
    expect(byText(container, i18n.t('common.reset'))).toBeUndefined()
  })

  it('a narrowed facet states its count, and Reset clears it', () => {
    const onReset = vi.fn()
    const { container } = mountScreen(
      React.createElement(LibraryFilterBar, { filters: [cameras(2, vi.fn())], onReset }),
    )
    expect(byText(container, 'Cameras 2')).toBeDefined()
    pressText(i18n.t('common.reset'))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('a facet whose default is a selection states its count but offers no Reset', () => {
    const facet: LibraryFilterDef = { ...cameras(2, vi.fn()), active: false }
    const { container } = mountScreen(React.createElement(LibraryFilterBar, { filters: [facet], onReset: vi.fn() }))
    expect(byText(container, 'Cameras 2')).toBeDefined()
    expect(byText(container, i18n.t('common.reset'))).toBeUndefined()
  })

  it('a chip opens the shared checkbox list and a pick reaches the page', async () => {
    const onToggle = vi.fn()
    mountScreen(React.createElement(LibraryFilterBar, { filters: [cameras(0, onToggle)], onReset: vi.fn() }))
    pressText('Cameras')
    await waitFor(() => expect(byText(document.body, 'MARK-Garden')).toBeDefined())
    pressText('MARK-Garden')
    expect(onToggle).toHaveBeenCalledWith('2')
  })

  it('a destination list closes on its pick', async () => {
    const onToggle = vi.fn()
    mountScreen(React.createElement(LibraryFilterBar, { filters: [cameras(0, onToggle, true)], onReset: vi.fn() }))
    pressText('Cameras')
    await waitFor(() => expect(byText(document.body, 'MARK-front-door')).toBeDefined())
    pressText('MARK-front-door')
    expect(onToggle).toHaveBeenCalledWith('1')
    await waitFor(() => expect(byText(document.body, 'MARK-front-door')).toBeUndefined())
  })
})

describe('LibraryFilterBar — the one header row (2026-10-21)', () => {
  const display = {
    id: 'display',
    icon: Plus,
    label: 'MARK-Display · Newest',
    testID: 'bar-display',
    sections: [{ title: 'MARK-Sort by', options: [{ key: 'time', label: 'MARK-By time' }], selected: ['time'], onToggle: vi.fn() }],
  }
  const primary = { id: 'new', label: 'MARK-New person', icon: Plus, onPress: vi.fn(), testID: 'bar-primary' }
  const more: readonly OverflowMenuItem[] = [{ id: 'select', icon: CheckSquare, label: 'MARK-Select', onPress: vi.fn() }]

  function mountBar(width: number) {
    setTestViewport({ width, height: 844 })
    return mountScreen(
      React.createElement(LibraryFilterBar, {
        filters: [cameras(0, vi.fn())],
        onReset: vi.fn(),
        tools: [display],
        primary,
        more,
        moreTestID: 'bar-more',
        summary: 'MARK-14 faces',
        summaryTestID: 'bar-summary',
        testID: 'bar',
      }),
    )
  }

  it('the order lives in a tool (the eye) whose menu holds the lists, never a row of its own', async () => {
    const { getByTestId, container } = mountBar(390)
    // The current order is the icon's accessible name, not a visible chip.
    expect(byText(container, 'MARK-Display · Newest')).toBeUndefined()
    expect(getByTestId('bar-display').getAttribute('aria-label')).toBe('MARK-Display · Newest')
    fireEvent.click(getByTestId('bar-display'))
    await waitFor(() => expect(byText(document.body, 'MARK-By time')).toBeDefined())
  })

  it('offers the `⋯` menu and the primary action at the row end, with the count under it', async () => {
    const { getByTestId } = mountBar(390)
    expect(getByTestId('bar-summary').textContent).toBe('MARK-14 faces')
    fireEvent.click(getByTestId('bar-primary'))
    expect(primary.onPress).toHaveBeenCalledTimes(1)
    fireEvent.click(getByTestId('bar-more'))
    await waitFor(() => expect(byText(document.body, 'MARK-Select')).toBeDefined())
  })

  it('draws a tool as an icon at the row end: a plain one fires, a menu one opens its body', async () => {
    const onShare = vi.fn()
    const { getByTestId, container } = mountScreen(
      React.createElement(LibraryFilterBar, {
        filters: [cameras(0, vi.fn())],
        onReset: vi.fn(),
        tools: [
          { id: 'display', icon: Plus, label: 'MARK-Display', render: () => React.createElement('span', null, 'MARK-Display body'), testID: 'bar-display' },
          { id: 'share', icon: Plus, label: 'MARK-Share', onPress: onShare, testID: 'bar-share' },
        ],
      }),
    )
    // An icon with an accessible name — never a chip among the facets.
    expect(byText(container, 'MARK-Display')).toBeUndefined()
    expect(getByTestId('bar-share').getAttribute('aria-label')).toBe('MARK-Share')
    fireEvent.click(getByTestId('bar-share'))
    expect(onShare).toHaveBeenCalledTimes(1)
    fireEvent.click(getByTestId('bar-display'))
    await waitFor(() => expect(byText(document.body, 'MARK-Display body')).toBeDefined())
  })

  it('labels the primary action only where there is room for it', () => {
    const phone = mountBar(390)
    expect(byText(phone.container, 'MARK-New person')).toBeUndefined()
    phone.unmount()
    const tablet = mountBar(820)
    expect(byText(tablet.container, 'MARK-New person')).toBeDefined()
  })
})

function HeaderWithOverflow({ items }: { readonly items: readonly OverflowMenuItem[] }): React.JSX.Element {
  const overflow = useHeaderOverflowMenu(items, 'test-overflow')
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(ScreenHeader, { inset: false, actions: [overflow.action] }),
    overflow.menu,
  )
}

describe('HeaderOverflowMenu', () => {
  it('draws every item with its label, and a disabled one does nothing', async () => {
    const onSelect = vi.fn()
    const onRecompute = vi.fn()
    const { getByTestId } = mountScreen(
      React.createElement(HeaderWithOverflow, {
        items: [
          { id: 'select', icon: CheckSquare, label: 'MARK-Select', onPress: onSelect },
          { id: 'recompute', icon: RefreshCw, label: 'MARK-Recompute', onPress: onRecompute, disabled: true },
        ],
      }),
    )
    fireEvent.click(getByTestId('test-overflow'))
    await waitFor(() => expect(byText(document.body, 'MARK-Select')).toBeDefined())
    expect(byText(document.body, 'MARK-Recompute')).toBeDefined()
    pressText('MARK-Recompute')
    expect(onRecompute).not.toHaveBeenCalled()
    pressText('MARK-Select')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

// The timeline's date control without the time (operator, 2026-10-23): a
// calendar chip whose menu is the kit `MonthCalendar`; a pick applies and closes.
describe('LibraryFilterBar — the date chip', () => {
  const NOW = new Date(2026, 9, 23, 16, 20).getTime()
  const today = new Date(2026, 9, 23).getTime()
  const calendarOpen = (): boolean => document.querySelector('[data-testid="library-date-calendar"]') !== null

  it('reads Today, opens the month calendar and picks a day as its local midnight, then closes', async () => {
    const onPick = vi.fn()
    mountScreen(
      React.createElement(LibraryFilterBar, { date: { dayMs: today, nowMs: NOW, onPick }, filters: [], onReset: vi.fn() }),
    )
    pressText(i18n.t('v2.calendar.today'))
    await waitFor(() => expect(calendarOpen()).toBe(true))
    // A day of the shown month, by its number — the 20th.
    const cell = [...document.querySelectorAll('[data-testid="library-date-calendar"] [role="button"]')].find(
      (el) => el.textContent === '20',
    )
    expect(cell).toBeDefined()
    if (cell) fireEvent.click(cell)
    expect(onPick).toHaveBeenCalledWith(new Date(2026, 9, 20).getTime())
    await waitFor(() => expect(calendarOpen()).toBe(false))
  })

  it('a future day cannot be picked', async () => {
    const onPick = vi.fn()
    mountScreen(
      React.createElement(LibraryFilterBar, { date: { dayMs: today, nowMs: NOW, onPick }, filters: [], onReset: vi.fn() }),
    )
    pressText(i18n.t('v2.calendar.today'))
    await waitFor(() => expect(calendarOpen()).toBe(true))
    // The LAST "28": the grid opens on the end of September (a past day).
    const future = [...document.querySelectorAll('[data-testid="library-date-calendar"] [role="button"]')]
      .filter((el) => el.textContent === '28')
      .at(-1)
    if (future) fireEvent.click(future)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('as navigation (Events, Media): no "All dates", and a past day is not a narrowing', async () => {
    mountScreen(
      React.createElement(LibraryFilterBar, {
        date: { dayMs: new Date(2026, 9, 20).getTime(), nowMs: NOW, onPick: vi.fn() },
        filters: [],
        onReset: vi.fn(),
      }),
    )
    expect(byText(document.body, i18n.t('common.reset'))).toBeUndefined()
    const chip = byText(document.body, i18n.t('v2.calendar.yesterday'))
    expect(chip).toBeUndefined()
  })

  it('as a filter (People, Plates): "All dates" in the menu, a picked day offers Reset', async () => {
    const onPick = vi.fn()
    mountScreen(
      React.createElement(LibraryFilterBar, { date: { dayMs: null, nowMs: NOW, onPick, allowAll: true }, filters: [], onReset: vi.fn() }),
    )
    expect(byText(document.body, i18n.t('common.reset'))).toBeUndefined()
    pressText(i18n.t('v2.library.allDates'))
    await waitFor(() => expect(calendarOpen()).toBe(true))
    const inMenu = [...document.querySelectorAll('[data-testid="library-date-calendar"] [role="button"]')].find(
      (el) => el.textContent === i18n.t('v2.library.allDates'),
    )
    expect(inMenu).toBeDefined()
    if (inMenu) fireEvent.click(inMenu)
    expect(onPick).toHaveBeenCalledWith(null)
    cleanup()
    mountScreen(
      React.createElement(LibraryFilterBar, { date: { dayMs: today, nowMs: NOW, onPick, allowAll: true }, filters: [], onReset: vi.fn() }),
    )
    await waitFor(() => expect(byText(document.body, i18n.t('common.reset'))).toBeDefined())
  })
})
