/**
 * @vitest-environment jsdom
 *
 * The cursor DRAWS one reading, on the epoch axis, and takes no press.
 *
 * Both layers had a clip arm for one release — the line drew the file's
 * fraction, the pill read its clock and doubled as the control that re-hooked
 * the scroll follow. The operator removed the strip first (*"il progresso
 * sulla clip adesso e' mostrato sia sul cursore che sulla clip, toglilo dal
 * cursore"*) and then the rest: over a held file the cursor is not rendered at
 * all, and what is rendered is never a control (D62).
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import {
  TimelineCursorLine,
  CURSOR_LINE_TEST_ID,
  CURSOR_ORIGIN_DOT_TEST_ID,
} from '../TimelineCursorLayers.js'
import {
  PROGRESS_STRIP_FILL_TEST_ID,
  PROGRESS_STRIP_SWEEP_TEST_ID,
} from '../../../ui/ProgressStrip.js'
import type { TimelineCursor } from '../timeline-cursor.js'
import { CURSOR_LINE_START_PX } from '../timeline-lanes-layout.js'

afterEach(cleanup)

function line(cursor: TimelineCursor): HTMLElement {
  const { container } = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(TimelineCursorLine, { cursor }),
    ),
  )
  return container
}

function find(el: HTMLElement, testId: string): HTMLElement | null {
  return el.querySelector(`[data-testid="${testId}"]`)
}

describe('the cursor LINE draws no progress, on either arm', () => {
  it('is a plain mark over our own footage', () => {
    const el = line({ kind: 'epoch' })
    expect(find(el, CURSOR_LINE_TEST_ID)).not.toBeNull()
    // Neither arm of the strip. The ONE drawing of a fraction is the running
    // row's own (`clip-row-progress.spec.ts`).
    expect(find(el, PROGRESS_STRIP_FILL_TEST_ID)).toBeNull()
    expect(find(el, PROGRESS_STRIP_SWEEP_TEST_ID)).toBeNull()
  })

  it('is a plain mark at the live edge', () => {
    const el = line({ kind: 'live' })
    expect(find(el, CURSOR_LINE_TEST_ID)).not.toBeNull()
    expect(find(el, PROGRESS_STRIP_FILL_TEST_ID)).toBeNull()
    expect(find(el, PROGRESS_STRIP_SWEEP_TEST_ID)).toBeNull()
  })
})

describe('the cursor DOT', () => {
  it('marks the time at the line start, past the label column', () => {
    for (const cursor of [{ kind: 'epoch' } as const, { kind: 'live' } as const]) {
      const el = line(cursor)
      expect(find(el, CURSOR_ORIGIN_DOT_TEST_ID)).not.toBeNull()
      // No readout pill any more: the label column belongs to the hour labels.
      expect(el.textContent).toBe('')
      expect(el.querySelector('[role="button"]')).toBeNull()
    }
  })

  it('starts the line at the label column edge (8 padding + 38 labels)', () => {
    expect(CURSOR_LINE_START_PX).toBe(46)
  })
})
