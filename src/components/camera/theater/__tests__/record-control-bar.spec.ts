/**
 * @vitest-environment jsdom
 *
 * The bar's ONE record control, in both flows.
 *
 * The operator's report is what this file is about: the trailing slot used to
 * hold two different controls that drew the same red dot in the same place —
 * the live capture and the export-selection arm — and pressing it in a recorded
 * mode ran the LIVE path and reported "cannot record the live view". The fix is
 * structural rather than a guard: there is one control, one test id, and the
 * MODE decides which flow its three callbacks belong to.
 *
 * What is asserted here:
 *
 *  • There is exactly ONE way to start recording, in either mode.
 *  • A recorded mode never reaches the live-capture callbacks.
 *  • Accept must fire exactly once — it is the irreversible half — and Discard
 *    must never save.
 *  • The duration lives ON the Accept chip: the operator sees how much they are
 *    about to keep before they press.
 *  • While a selection is armed, everything that would land the player is gone
 *    — the landscape drawer is 240pt and Save must fit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'

import { recordBinding } from '../../../../testing/record-binding.js'
import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import {
  TimelinePlaybackBar,
  RECORD_TEST_ID,
  RECORD_ACCEPT_TEST_ID,
  RECORD_DISCARD_TEST_ID,
} from '../TimelinePlaybackBar.js'
import type { RecordControlBinding } from '../../../../recording/record-control.js'
import type { PlaybackMode } from '../../../../recording/playback-machine.js'

afterEach(cleanup)

const NOOP = (): void => undefined

function mountBar(
  record: RecordControlBinding | undefined,
  overrides: Partial<Parameters<typeof TimelinePlaybackBar>[0]> = {},
): HTMLElement {
  const { container } = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(TimelinePlaybackBar, {
        mode: 'playback',
        rate: 1,
        paused: false,
        loading: false,
        onTogglePause: NOOP,
        onJogBack: NOOP,
        onJogForward: NOOP,
        onSelectRate: NOOP,
        onGoLive: NOOP,
        liveLocked: false,
        onToggleLiveLock: NOOP,
        record,
        ...overrides,
      }),
    ),
  )
  return container
}

const byId = (root: HTMLElement, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`)

const binding = recordBinding

describe('a surface with no record binding draws no record control', () => {
  it('the wall gets none of the three', () => {
    const root = mountBar(undefined)
    expect(byId(root, RECORD_TEST_ID)).toBeNull()
    expect(byId(root, RECORD_ACCEPT_TEST_ID)).toBeNull()
    expect(byId(root, RECORD_DISCARD_TEST_ID)).toBeNull()
  })
})

describe('there is exactly ONE REC button, and pressing it opens a menu', () => {
  for (const mode of ['live', 'playback', 'seeking', 'gap', 'error'] as const) {
    it(`${mode}: one control; the press starts nothing, the menu row does`, () => {
      const bind = binding({
        menu: mode === 'live' ? ['snapshot', 'recordLive'] : ['selectExport', 'snapshot'],
      })
      const root = mountBar(bind, { mode })
      // ONE node with the record id — not a rec dot beside an arm chip.
      expect(root.querySelectorAll(`[data-testid="${RECORD_TEST_ID}"]`)).toHaveLength(1)
      fireEvent.click(byId(root, RECORD_TEST_ID)!)
      expect(bind.onMenuAction).not.toHaveBeenCalled()
      const rows = [...root.querySelectorAll('[role="menuitem"]')].map((el) => el.getAttribute('aria-label'))
      expect(rows).toEqual(
        mode === 'live' ? ['Snapshot', 'Record'] : ['Export', 'Snapshot'],
      )
      fireEvent.click(byId(root, `${RECORD_TEST_ID}-snapshot`)!)
      expect(bind.onMenuAction).toHaveBeenCalledTimes(1)
      expect(bind.onMenuAction).toHaveBeenCalledWith('snapshot')
    })
  }

  it('live: a snapshot-only menu still draws the button', () => {
    const bind = binding({ menu: ['snapshot'] })
    const root = mountBar(bind, { mode: 'live' })
    fireEvent.click(byId(root, RECORD_TEST_ID)!)
    expect(root.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
  })

  it('a PAUSED live surface has no picture to record, so it has no control', () => {
    const root = mountBar(binding(), { mode: 'live', paused: true })
    expect(byId(root, RECORD_TEST_ID)).toBeNull()
  })
})

describe('the pair has the same shape in both modes', () => {
  const active = { active: true, canAccept: true, durationLabel: '1:30' }

  for (const mode of ['live', 'playback'] as const) {
    it(`${mode}: Accept and Discard replace the dot, and the duration is ON Accept`, () => {
      const root = mountBar(
        binding({ ...active, kind: mode === 'live' ? 'capture' : 'export', spanLabel: '1m30s' }),
        { mode },
      )
      expect(byId(root, RECORD_TEST_ID)).toBeNull()
      expect(byId(root, RECORD_ACCEPT_TEST_ID)).not.toBeNull()
      expect(byId(root, RECORD_DISCARD_TEST_ID)).not.toBeNull()
      // A live clip is a ticking clock; a selection names the span it will save.
      expect(root.textContent).toContain(mode === 'live' ? '1:30' : '1m30s')
    })
  }

  it('Accept fires once and never discards', () => {
    const bind = binding(active)
    const root = mountBar(bind)
    fireEvent.click(byId(root, RECORD_ACCEPT_TEST_ID)!)
    expect(bind.onAccept).toHaveBeenCalledTimes(1)
    expect(bind.onDiscard).not.toHaveBeenCalled()
  })

  it('Discard fires and never accepts — nothing is kept', () => {
    const bind = binding(active)
    const root = mountBar(bind)
    fireEvent.click(byId(root, RECORD_DISCARD_TEST_ID)!)
    expect(bind.onDiscard).toHaveBeenCalledTimes(1)
    expect(bind.onAccept).not.toHaveBeenCalled()
  })

  it('a range too short to render cannot be accepted', () => {
    const bind = binding({ active: true, canAccept: false, durationLabel: '0:00' })
    const root = mountBar(bind)
    fireEvent.click(byId(root, RECORD_ACCEPT_TEST_ID)!)
    expect(bind.onAccept).not.toHaveBeenCalled()
  })

  it('an accept already in flight cannot be pressed twice', () => {
    const bind = binding({ ...active, busy: true })
    const root = mountBar(bind)
    fireEvent.click(byId(root, RECORD_ACCEPT_TEST_ID)!)
    fireEvent.click(byId(root, RECORD_ACCEPT_TEST_ID)!)
    expect(bind.onAccept).not.toHaveBeenCalled()
  })

  it('Discard stays live while an accept is in flight, so the operator is never stuck', () => {
    const bind = binding({ ...active, busy: true })
    const root = mountBar(bind)
    fireEvent.click(byId(root, RECORD_DISCARD_TEST_ID)!)
    expect(bind.onDiscard).toHaveBeenCalledTimes(1)
  })
})

/**
 * Landscape: the drawer is 240pt at its narrowest
 * (`landscape-drawer-geometry.ts` clamps it there), and the bar is the widest
 * fixed row inside it. While a selection is armed the trailing side carries TWO
 * controls instead of one, so the transport's reserved-but-empty slots have to
 * give their width back — otherwise Accept is pushed past the panel's edge on
 * the one surface where the operator is most likely to be scrubbing.
 */
describe('the armed bar gives back the width it no longer uses', () => {
  it('drops the speed chip and the frame-step, and KEEPS the jog that trims the span', () => {
    const root = mountBar(binding({ active: true, canAccept: true, durationLabel: '2:00' }), {
      onStepFrame: NOOP,
    })
    expect(root.querySelector('[aria-label="Playback speed"]')).toBeNull()
    expect(root.querySelector('[aria-label="Next frame"]')).toBeNull()
    expect(root.querySelector('[aria-label="−10s"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="+10s"]')).not.toBeNull()
    // LIVE-to-go + play + two jogs + Discard + Accept.
    expect(root.querySelectorAll('[role="button"]').length).toBeLessThanOrEqual(6)
  })

  it('the confirm chip carries NO verb — the figure only; the full meaning is its accessibility label', () => {
    const armed = { active: true, canAccept: true, spanLabel: '1m20s' }
    const saving = mountBar(binding({ ...armed, kind: 'export' }))
    expect(saving.textContent).toContain('1m20s')
    expect(saving.textContent).not.toMatch(/Save|Delete/)
    expect(saving.querySelector('[aria-label="Save 1m20s export"]')).not.toBeNull()
    cleanup()
    const deleting = mountBar(binding({ ...armed, kind: 'delete' }))
    expect(deleting.textContent).toContain('1m20s')
    expect(deleting.textContent).not.toMatch(/Save|Delete/)
    expect(deleting.querySelector('[aria-label="Delete 1m20s of recording"]')).not.toBeNull()
  })

  it('keeps them all when nothing is armed', () => {
    const root = mountBar(binding(), { onStepFrame: NOOP })
    expect(root.querySelectorAll('[role="button"]').length).toBeGreaterThan(4)
  })

  it('a live capture keeps the live bar as it was: those controls were never there', () => {
    const modes: readonly PlaybackMode[] = ['live']
    for (const mode of modes) {
      const root = mountBar(binding({ active: true, canAccept: true, durationLabel: '2:00' }), {
        mode,
        onStepFrame: NOOP,
      })
      // Leading LIVE badge + play/pause + Discard + Accept, and nothing else.
      expect(root.querySelectorAll('[role="button"]').length).toBe(4)
      cleanup()
    }
  })
})
