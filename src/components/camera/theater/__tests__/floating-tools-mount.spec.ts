/**
 * @vitest-environment jsdom
 *
 * The floating timeline tools, mounted: Filtri / Zona / `−` range `+` at the
 * one top bar (Filtri · Zona · zoom · Clip), the right ones lit, the steppers walking the
 * presets and clamping at the ends.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import i18n from '../../../../app/i18n.js'
import { ThemeProvider } from '../../../../theme/theme-provider.js'
import { zoomIndicesByRange } from '../mock-data.js'
import { TimelineScaleProvider } from '../TimelineScaleProvider.js'
import {
  TimelineFloatingTools,
  FLOATING_TOOL_SIZE,
  floatingToolsTopInset,
  floatingToolsBottomInset,
  type TimelineFloatingToolsProps,
} from '../TimelineFloatingTools.js'
import { TOOLBAR_CONTROL_SIZE } from '../TimelineToolbarInline.js'

vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }))

afterEach(cleanup)

const LADDER = zoomIndicesByRange()

function mount(over: Partial<TimelineFloatingToolsProps> = {}) {
  const props: TimelineFloatingToolsProps = {
    zoomIndex: LADDER[2]!,
    zoomMode: 'fixed',
    onZoomIndexChange: vi.fn(),
    onZoomModeChange: vi.fn(),
    zoomEnabled: true,
    onFilter: vi.fn(),
    onZoneFilter: vi.fn(),
    onOpenClips: vi.fn(),
    clipsActive: false,
    filterActive: false,
    zoneActive: false,
    leftReserve: 50,
    rightReserve: 66,
    ...over,
  }
  render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(
        TimelineScaleProvider,
        { availableWidth: 390, children: React.createElement(TimelineFloatingTools, props) },
      ),
    ),
  )
  return props
}

const name = (key: string): string => i18n.t(key)

describe('TimelineFloatingTools', () => {
  it('renders Filtri, Zona, zoom steppers, the range and the clip pill', () => {
    mount()
    for (const key of [
      'v2.theater.filterTitle',
      'v2.theater.zoneFilter',
      'v2.theater.zoomShorter',
      'v2.theater.zoomLonger',
      'v2.theater.zoomRange',
      'v2.clips.title',
    ]) {
      expect(screen.getByLabelText(name(key)), key).toBeTruthy()
    }
  })

  it('omits Zona when the surface has no single picture', () => {
    mount({ onZoneFilter: undefined })
    expect(screen.queryByLabelText(name('v2.theater.zoneFilter'))).toBeNull()
  })

  it('an engaged pill is washed with the warning fill and exposes `selected`', () => {
    // react-native-web drops aria-selected on a button, so the DOM cannot show
    // it; the state is asserted where it is written, and the mount above proves
    // the pills render with every flag on.
    mount({ filterActive: true, zoneActive: true, clipsActive: true })
    const src = readFileSync(join(__dirname, '..', 'TimelineFloatingTools.tsx'), 'utf8')
    // The pill is a GlassButton: `active` washes it with `tint` and the button
    // exposes `selected` (asserted on the button itself, once, for every pill).
    expect(src).toMatch(/selected=\{active\}[\s\S]*?backgroundColor: tint/)
    expect(readFileSync(join(__dirname, '..', '..', '..', 'ui', 'GlassButton.tsx'), 'utf8')).toContain(
      'accessibilityState={{ selected: active, disabled }}',
    )
    expect(src).toContain('const activeTint = colors.warningFill')
  })

  it('the clip pill toggles clips mode', () => {
    const props = mount()
    fireEvent.click(screen.getByLabelText(name('v2.clips.title')))
    expect(props.onOpenClips).toHaveBeenCalledTimes(1)
  })

  it('+ and − step the presets and leave Auto for a fixed span', () => {
    const props = mount({ zoomMode: 'auto' })
    fireEvent.click(screen.getByLabelText(name('v2.theater.zoomLonger')))
    expect(props.onZoomModeChange).toHaveBeenCalledWith('fixed')
    expect(props.onZoomIndexChange).toHaveBeenCalledWith(LADDER[3])
    fireEvent.click(screen.getByLabelText(name('v2.theater.zoomShorter')))
    expect(props.onZoomIndexChange).toHaveBeenLastCalledWith(LADDER[1])
  })

  it('clamps at the ends: the stepper is disabled and does nothing', () => {
    const shortest = mount({ zoomIndex: LADDER[0]! })
    const minus = screen.getByLabelText(name('v2.theater.zoomShorter'))
    expect(minus.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(minus)
    expect(shortest.onZoomIndexChange).not.toHaveBeenCalled()
    cleanup()
    const longest = mount({ zoomIndex: LADDER[LADDER.length - 1]! })
    fireEvent.click(screen.getByLabelText(name('v2.theater.zoomLonger')))
    expect(longest.onZoomIndexChange).not.toHaveBeenCalled()
  })

  it('the range label opens the menu of Auto plus the presets', () => {
    mount()
    const range = screen.getByLabelText(name('v2.theater.zoomRange'))
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    fireEvent.click(range)
    expect(screen.getAllByRole('menuitem').length).toBe(LADDER.length + 1)
  })

  it('the list reserves room under the last card for the bottom tools bar', () => {
    // The bar is a standard toolbar control tall, not the 24 pt lane-header
    // strip it was squashed to under the heatmap.
    expect(floatingToolsBottomInset()).toBeGreaterThanOrEqual(TOOLBAR_CONTROL_SIZE)
    expect(floatingToolsTopInset()).toBeLessThan(FLOATING_TOOL_SIZE)
  })
})
