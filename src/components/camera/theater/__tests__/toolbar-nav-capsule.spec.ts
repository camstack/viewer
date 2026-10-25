/**
 * @vitest-environment jsdom
 *
 * Player toolbar: three glass capsules at TOOLBAR_CONTROL_SIZE — nav (back
 * alone), date alone, actions together (the camera switch ends that capsule;
 * the legend button is gone). Floating tools keep the lane-header
 * hit target.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mountScreen } from '../../../../testing/mount.js'
import {
  TimelineToolbarInline,
  TOOLBAR_CONTROL_SIZE,
} from '../TimelineToolbarInline.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

function render(extra: Record<string, unknown> = {}): HTMLElement {
  return mountScreen(
    React.createElement(TimelineToolbarInline, {
      onBack: () => {},
      dateLabel: () => 'Today',
      qualityLabel: 'Auto',
      ...extra,
    }),
  ).container
}

describe('the three toolbar glass capsules', () => {
  it('holds back alone in the nav surface; the camera switch ends the actions capsule', () => {
    const onPickCamera = vi.fn()
    const root = render({ onPickCamera })
    const nav = root.querySelector('[data-testid="timeline-nav-capsule"]')!
    expect(nav.querySelector('[aria-label="Back"]')).not.toBeNull()
    expect(nav.querySelector('[aria-label="Switch camera"]')).toBeNull()
    const actions = root.querySelector('[data-testid="timeline-actions-capsule"]')!
    const labelled = Array.from(actions.querySelectorAll('[aria-label]'))
    expect(labelled[labelled.length - 1]?.getAttribute('aria-label')).toBe('Switch camera')
    fireEvent.click(labelled[labelled.length - 1]!)
    expect(onPickCamera).toHaveBeenCalledTimes(1)
    expect(TOOLBAR_CONTROL_SIZE).toBe(36)
  })

  it('has no help / legend button any more', () => {
    const src = readFileSync(join(__dirname, '..', 'TimelineToolbarInline.tsx'), 'utf8')
    expect(src).not.toContain('HelpCircle')
    expect(src).not.toContain('onToggleLegend')
  })

  it('the legend is reachable from the settings panel, through the legend panel kind', () => {
    const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8')
    expect(read('..', 'CameraViewOptionsSurface.tsx')).toContain("t('v2.cameraMenu.timelineLegend')")
    expect(read('TimelineViewOptionsPanel.tsx')).toContain('onOpenLegend={onOpenLegend}')
    expect(read('TimelineBodyPanel.tsx')).toContain('onOpenLegend={managementBinding.onOpenLegend}')
    expect(read('TheaterTimeline.tsx')).toContain("openPanel('legend')")
  })

  it('without a camera callback there is no switch; on the wide rail only the switch', () => {
    expect(render().querySelector('[aria-label="Switch camera"]')).toBeNull()
    const wide = render({ hideBack: true, onPickCamera: () => {} })
    expect(wide.querySelector('[aria-label="Back"]')).toBeNull()
    expect(wide.querySelector('[aria-label="Switch camera"]')).not.toBeNull()
  })

  it('the date is its own glass pill; actions share a second capsule', () => {
    const root = render({ onToggleMenu: () => {} })
    expect(root.querySelector('[data-testid="timeline-date-pill"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="Pick a date"]')).not.toBeNull()
    const actions = root.querySelector('[data-testid="timeline-actions-capsule"]')!
    expect(actions.querySelector('[aria-label="Stream quality"]')).not.toBeNull()
    const src = readFileSync(join(__dirname, '..', 'TimelineToolbarInline.tsx'), 'utf8')
    expect(src).toContain('TOOLBAR_CONTROL_SIZE')
    expect(src).not.toContain('HEADER_BUTTON_SIZE')
    expect(src).not.toContain('colors.surface')
  })

  it('the quality drop-down is a sibling of the clipped capsule, not inside it', () => {
    const src = readFileSync(join(__dirname, '..', 'TimelineToolbarInline.tsx'), 'utf8')
    const actions = src.slice(src.indexOf('timeline-actions-capsule'))
    // Menu must sit after the GlassSurface closes — overflow:hidden clips children.
    const surfaceClose = actions.indexOf('</GlassSurface>')
    const menu = actions.indexOf('styles.qualityMenu')
    expect(surfaceClose).toBeGreaterThan(0)
    expect(menu).toBeGreaterThan(surfaceClose)
  })
})

describe('the floating bottom tools bar', () => {
  it('has the standard toolbar height and keeps a 44 pt target through hitSlop', () => {
    const src = readFileSync(join(__dirname, '..', 'TimelineFloatingTools.tsx'), 'utf8')
    expect(src).toContain('TOOLBAR_CONTROL_SIZE')
    expect(src).toContain('Math.ceil((FLOATING_TOOL_SIZE - TOOLBAR_CONTROL_SIZE) / 2)')
    expect(src).not.toMatch(/height: LANE_HEADER_HEIGHT_PX/)
    expect(src).toContain('<BarDivider />')
    expect(src).not.toContain('hitSlop={4}')
  })
})
