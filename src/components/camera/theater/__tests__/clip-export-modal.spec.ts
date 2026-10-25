/**
 * @vitest-environment jsdom
 *
 * The picker shows the copies, refuses the one the hub would refuse, and draws
 * a progress that is honest about what it does not know.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import {
  ClipExportModal,
  CLIP_EXPORT_OPTION_TEST_ID,
  CLIP_EXPORT_PROGRESS_TEST_ID,
} from '../ClipExportModal.js'
import {
  PROGRESS_STRIP_FILL_TEST_ID,
  PROGRESS_STRIP_SWEEP_TEST_ID,
} from '../../../ui/ProgressStrip.js'
import type { ClipQualityOption } from '../../../../clips/clip-export-quality.js'
import type { ClipExportPhase } from '../../../../clips/clip-export-progress.js'

afterEach(cleanup)

const NOOP = (): void => undefined

const HIGH: ClipQualityOption = { profile: 'high', bytes: 23_736_535, refusal: null }
const LOW: ClipQualityOption = { profile: 'low', bytes: 712_460, refusal: null }
const HIGH_TOO_BIG: ClipQualityOption = { profile: 'high', bytes: 174_964_736, refusal: 'too-large' }

function mount(
  phase: ClipExportPhase,
  options: readonly ClipQualityOption[] = [HIGH, LOW],
  onPick: (profile: 'high' | 'low') => void = NOOP,
): HTMLElement {
  const { baseElement } = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(ClipExportModal, {
        visible: true,
        options,
        phase,
        onPick,
        onClose: NOOP,
      }),
    ),
  )
  return baseElement
}

function rows(el: HTMLElement): readonly HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(`[data-testid="${CLIP_EXPORT_OPTION_TEST_ID}"]`)]
}

describe('the picker', () => {
  it('draws one row per distinct copy, with the size beside it', () => {
    // The size is what makes the choice mean anything: 22.6 MB against 696 KB.
    const el = mount({ kind: 'idle' })
    expect(rows(el)).toHaveLength(2)
    expect(el.textContent).toContain('MB')
    expect(el.textContent).toContain('KB')
  })

  it('reports a copy whose size the row did not state, rather than showing a dash', () => {
    const el = mount({ kind: 'idle' }, [{ profile: 'high', bytes: null, refusal: null }])
    expect(el.textContent).toContain('not stated')
  })

  it('picks the profile that was pressed', () => {
    const onPick = vi.fn()
    const el = mount({ kind: 'idle' }, [HIGH, LOW], onPick)
    fireEvent.click(rows(el)[1])
    expect(onPick).toHaveBeenCalledWith('low')
  })
})

describe('a copy the export path would refuse', () => {
  it('is SHOWN, disabled — dropping it would silently downgrade the keep', () => {
    const el = mount({ kind: 'idle' }, [HIGH_TOO_BIG, LOW])
    expect(rows(el)).toHaveLength(2)
    expect(rows(el)[0].getAttribute('aria-disabled')).toBe('true')
  })

  it('cannot be picked', () => {
    const onPick = vi.fn()
    const el = mount({ kind: 'idle' }, [HIGH_TOO_BIG, LOW], onPick)
    fireEvent.click(rows(el)[0])
    expect(onPick).not.toHaveBeenCalled()
  })

  it('says why, in OUR words — the bound is ours, not the camera nothing', () => {
    expect(mount({ kind: 'idle' }, [HIGH_TOO_BIG, LOW]).textContent).toContain('Too large')
  })
})

describe('the progress is the RECORD progress', () => {
  it('fills the bar to a measured fraction', () => {
    const el = mount({ kind: 'working', progress: { kind: 'known', fraction: 0.4 } })
    const fill = el.querySelector<HTMLElement>(`[data-testid="${PROGRESS_STRIP_FILL_TEST_ID}"]`)
    expect(fill).not.toBeNull()
    expect(fill?.style.width).toBe('40%')
  })

  it('goes INDETERMINATE when the hub states no percentage', () => {
    // Never a bar at zero: the hub reports `null` wherever no real fraction
    // exists, and an empty bar claims the render has not begun.
    const el = mount({ kind: 'working', progress: { kind: 'unknown' } })
    expect(el.querySelector(`[data-testid="${PROGRESS_STRIP_SWEEP_TEST_ID}"]`)).not.toBeNull()
    expect(el.querySelector(`[data-testid="${PROGRESS_STRIP_FILL_TEST_ID}"]`)).toBeNull()
  })

  it('is indeterminate before the hub has answered at all', () => {
    const el = mount({ kind: 'asked' })
    expect(el.querySelector(`[data-testid="${PROGRESS_STRIP_SWEEP_TEST_ID}"]`)).not.toBeNull()
  })

  it('replaces the picker once something has been asked', () => {
    // A second profile would be a second job — and a second wake — off one
    // gesture.
    expect(rows(mount({ kind: 'working', progress: { kind: 'unknown' } }))).toHaveLength(0)
  })

  it('draws no bar at all once the job is done', () => {
    const el = mount({ kind: 'ready', exportId: 'exp-1', fileBytes: 812_345 })
    expect(el.querySelector(`[data-testid="${CLIP_EXPORT_PROGRESS_TEST_ID}"]`)).toBeNull()
  })

  it('says the job outlives the modal, because it does', () => {
    const el = mount({ kind: 'working', progress: { kind: 'unknown' } })
    expect(el.textContent).toContain('keeps running')
  })
})

describe('a failure', () => {
  it('translates the TOKEN and prints the producer words verbatim', () => {
    const el = mount({
      kind: 'failed',
      failure: { code: 'camera-refused', detail: 'NVR busy, try later' },
    })
    expect(el.textContent).toContain('The camera refused')
    // Never paraphrased, never translated — they are the camera's (D563).
    expect(el.textContent).toContain('NVR busy, try later')
  })

  it('falls back to a generic sentence for an error outside that vocabulary', () => {
    const el = mount({ kind: 'failed', failure: { code: null, detail: 'ECONNRESET' } })
    expect(el.textContent).toContain('The export failed')
    expect(el.textContent).toContain('ECONNRESET')
  })
})

describe('what it does NOT promise', () => {
  it('never offers a download — the file is collected from the Library', () => {
    const el = mount({ kind: 'ready', exportId: 'exp-1', fileBytes: 1 })
    expect(el.textContent).toContain('Library')
    expect(el.textContent?.toLowerCase()).not.toContain('download')
  })
})
