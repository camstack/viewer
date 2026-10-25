/**
 * @vitest-environment jsdom
 *
 * The bar lays itself out by the room it has (`playback-bar-fit.ts`), mounted
 * on the real component inside a real `TimelineScaleProvider`:
 *
 *  - where one row fits, nothing changes;
 *  - where it does not and the host can grow, it WRAPS — every control kept;
 *  - where the host cannot grow, record + speed move behind ONE overflow
 *    button, and the menu carries both.
 *
 * jsdom has no layout, so what is asserted is which controls are drawn and
 * where they live; that the chosen tier FITS is `playback-bar-fit.spec.ts`,
 * and the overlap itself was measured in a browser (2026-10-06).
 */
import { recordBinding } from '../../../../testing/record-binding.js'
import type { RecordControlBinding } from '../../../../recording/record-control.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import { TimelineScaleProvider } from '../TimelineScaleProvider.js'
import {
  TimelinePlaybackBar,
  OVERFLOW_TEST_ID,
  RECORD_TEST_ID,
  type TimelinePlaybackBarProps,
} from '../TimelinePlaybackBar.js'
import type { ToolbarDensity } from '../timeline-scale-tokens.js'

afterEach(cleanup)

const NOOP = (): void => undefined

function mountBar(
  width: number,
  density: ToolbarDensity,
  canWrap: boolean,
  onMenuAction: RecordControlBinding['onMenuAction'] = NOOP,
): HTMLElement {
  const props: TimelinePlaybackBarProps = {
    mode: 'playback',
    rate: 1,
    paused: true,
    loading: false,
    onTogglePause: NOOP,
    onJogBack: NOOP,
    onJogForward: NOOP,
    onStepFrame: NOOP,
    onSelectRate: NOOP,
    onGoLive: NOOP,
    record: recordBinding({ onMenuAction }),
    canWrap,
  }
  const { container } = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(TimelineScaleProvider, {
        availableWidth: width,
        density,
        children: React.createElement(TimelinePlaybackBar, props),
      }),
    ),
  )
  return container
}

const byLabel = (root: HTMLElement, label: string): HTMLElement | null =>
  root.querySelector(`[aria-label="${label}"]`)

const byId = (root: HTMLElement, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`)

/** The bar's rows: direct children of the toolbar (the clip track is absent here). */
function rows(root: HTMLElement): number {
  return root.querySelector('[role="toolbar"]')?.children.length ?? 0
}

describe('the operator’s rail — 380pt, medium density', () => {
  it('wraps onto two rows and keeps every control in the row', () => {
    const root = mountBar(380, 'medium', true)
    expect(rows(root)).toBe(2)
    for (const label of ['−10s', 'Previous frame', 'Play', 'Next frame', '+10s', 'Playback speed']) {
      expect(byLabel(root, label), label).not.toBeNull()
    }
    expect(byId(root, RECORD_TEST_ID)).not.toBeNull()
    expect(byId(root, OVERFLOW_TEST_ID)).toBeNull()
  })

  it('at small density it is the single full row it always was', () => {
    const root = mountBar(380, 'small', true)
    expect(rows(root)).toBe(1)
    expect(byLabel(root, 'Playback speed')).not.toBeNull()
    expect(byId(root, OVERFLOW_TEST_ID)).toBeNull()
  })
})

describe('the operator’s wide rail — 420pt, medium density (2026-10-07)', () => {
  it('is ONE row with every control: it fits once the transport is centred between the sides', () => {
    const root = mountBar(420, 'medium', true)
    expect(rows(root)).toBe(1)
    for (const label of ['−10s', 'Previous frame', 'Play', 'Next frame', '+10s', 'Playback speed']) {
      expect(byLabel(root, label), label).not.toBeNull()
    }
    expect(byId(root, RECORD_TEST_ID)).not.toBeNull()
    expect(byId(root, OVERFLOW_TEST_ID)).toBeNull()
  })
})

describe('a host that cannot grow a row', () => {
  it('moves record + speed behind ONE overflow button, and keeps the transport', () => {
    const root = mountBar(300, 'medium', false)
    expect(rows(root)).toBe(1)
    expect(byId(root, OVERFLOW_TEST_ID)).not.toBeNull()
    expect(byLabel(root, 'Playback speed')).toBeNull()
    expect(byId(root, RECORD_TEST_ID)).toBeNull()
    expect(byLabel(root, '−10s')).not.toBeNull()
    expect(byLabel(root, '+10s')).not.toBeNull()
  })

  it('the overflow menu carries every rate and the record actions, which still act', () => {
    const onMenuAction = vi.fn()
    const root = mountBar(300, 'medium', false, onMenuAction)
    fireEvent.click(byId(root, OVERFLOW_TEST_ID)!)

    const items = [...root.querySelectorAll('[role="menuitem"]')].map((el) => el.getAttribute('aria-label'))
    expect(items).toContain('1×')
    expect(items).toContain('Export')

    fireEvent.click(byId(root, `${RECORD_TEST_ID}-selectExport`)!)
    expect(onMenuAction).toHaveBeenCalledWith('selectExport')
    // Choosing closes the menu.
    expect(root.querySelector('[role="menuitem"]')).toBeNull()
  })
})
