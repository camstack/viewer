/**
 * Which flow the ONE record button drives.
 *
 * The operator's first report: pressing the record button during playback
 * answered "cannot record the live view". The screen's handler called
 * `startLiveCapture()` unconditionally, and in a recorded mode there is no live
 * view to record — the failure was reported over footage that was playing fine.
 *
 * The rule that retires it is here rather than in the component, because a
 * `?:` inside a 2 000-line component nothing can mount is exactly what shipped
 * the defect. Both claims below are about UNREACHABILITY, which is the only
 * kind of fix that cannot regress by omission.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveRecordControl, type ExportSelectionFlow, type LiveCaptureFlow } from '../record-control.js'
import { describeExportSelection, type ExportSelectionView } from '../export-selection.js'
import type { PlaybackMode } from '../playback-machine.js'

const T = (s: string): number => Date.parse(`2026-09-07T${s}Z`)
const DAY_FROM = T('00:00:00')
const DAY_TO = T('23:59:59')
const NOW = T('23:00:00')
const FOOTAGE = [{ startMs: DAY_FROM, endMs: DAY_TO }]

const RECORDED_MODES: readonly PlaybackMode[] = ['seeking', 'playback', 'gap', 'error']

function view(anchor: number | null, current: number | null): ExportSelectionView {
  return describeExportSelection(anchor, current, FOOTAGE, DAY_FROM, DAY_TO, NOW)
}

function live(): LiveCaptureFlow {
  return {
    capturing: false,
    elapsedLabel: '0:07',
    onStart: vi.fn(),
    onKeep: vi.fn(),
    onDiscard: vi.fn(),
  }
}

function selection(): ExportSelectionFlow {
  return { kind: 'export', onBegin: vi.fn(), onSave: vi.fn(), onDiscard: vi.fn(), saving: false }
}

const ADMIN = { isAdmin: true, onSnapshot: vi.fn() }
const VIEWER = { isAdmin: false, onSnapshot: vi.fn() }

describe('a recorded mode can never reach the live-capture flow', () => {
  for (const mode of RECORDED_MODES) {
    it(`${mode}: every callback belongs to the selection`, () => {
      const l = live()
      const s = selection()
      const control = resolveRecordControl(mode, l, s, view(T('10:00:00'), T('10:05:00')), ADMIN)!
      control.onMenuAction('selectExport')
      control.onAccept()
      control.onDiscard()
      expect(l.onStart).not.toHaveBeenCalled()
      expect(l.onKeep).not.toHaveBeenCalled()
      expect(l.onDiscard).not.toHaveBeenCalled()
      expect(s.onBegin).toHaveBeenCalledWith('export')
      expect(s.onSave).toHaveBeenCalledTimes(1)
      expect(s.onDiscard).toHaveBeenCalledTimes(1)
    })
  }
})

describe('the live edge can never reach the selection flow', () => {
  it('records the picture forward from now, and arms nothing', () => {
    const l = live()
    const s = selection()
    const control = resolveRecordControl('live', l, s, view(null, null), ADMIN)!
    control.onMenuAction('recordLive')
    control.onAccept()
    control.onDiscard()
    expect(l.onStart).toHaveBeenCalledTimes(1)
    expect(l.onKeep).toHaveBeenCalledTimes(1)
    expect(l.onDiscard).toHaveBeenCalledTimes(1)
    expect(s.onBegin).not.toHaveBeenCalled()
    expect(s.onSave).not.toHaveBeenCalled()
  })

  it('a capture always has something in it: no coverage verdict, no warning', () => {
    const control = resolveRecordControl('live', live(), selection(), view(null, null), ADMIN)!
    expect(control.canAccept).toBe(true)
    expect(control.warn).toBe(false)
    expect(control.durationLabel).toBe('0:07')
  })
})

describe('the pair carries the same facts either way', () => {
  it('the selection puts its LENGTH on Accept, and a hole tints it', () => {
    const holed = describeExportSelection(
      T('09:30:00'),
      T('11:00:00'),
      [{ startMs: T('10:00:00'), endMs: T('12:00:00') }],
      DAY_FROM,
      DAY_TO,
      NOW,
    )
    const control = resolveRecordControl('playback', live(), selection(), holed, ADMIN)!
    expect(control.durationLabel).toBe('1:30:00')
    expect(control.warn).toBe(true)
    expect(control.canAccept).toBe(true)
  })

  it('a selection with no range yet accepts nothing — Accept cannot fire on null', () => {
    const s = selection()
    const control = resolveRecordControl('playback', live(), s, view(T('10:00:00'), null), ADMIN)!
    expect(control.canAccept).toBe(false)
    control.onAccept()
    expect(s.onSave).not.toHaveBeenCalled()
  })
})

describe('an absent flow is an absent control, never a disabled one', () => {
  it('the wall has neither picture nor camera', () => {
    const noSnapshot = { isAdmin: true }
    expect(resolveRecordControl('live', undefined, selection(), view(null, null), noSnapshot)).toBeUndefined()
    expect(resolveRecordControl('playback', live(), undefined, view(null, null), noSnapshot)).toBeUndefined()
  })
})

describe('the menu routes each action to its flow, once', () => {
  it('snapshot is the player\'s, in either mode, and arms nothing', () => {
    for (const mode of ['live', 'playback'] as const) {
      const onSnapshot = vi.fn()
      const l = live()
      const s = selection()
      const control = resolveRecordControl(mode, l, s, view(null, null), { isAdmin: true, onSnapshot })!
      control.onMenuAction('snapshot')
      expect(onSnapshot).toHaveBeenCalledTimes(1)
      expect(l.onStart).not.toHaveBeenCalled()
      expect(s.onBegin).not.toHaveBeenCalled()
    }
  })

  it('Delete recording arms a DELETE selection for an admin', () => {
    const s = selection()
    const control = resolveRecordControl('playback', live(), s, view(null, null), ADMIN)!
    expect(control.menu).toContain('deleteRecording')
    control.onMenuAction('deleteRecording')
    expect(s.onBegin).toHaveBeenCalledWith('delete')
  })

  it('a non-admin has no Delete entry, and the action is inert even if forced', () => {
    const s = selection()
    const control = resolveRecordControl('playback', live(), s, view(null, null), VIEWER)!
    expect(control.menu).not.toContain('deleteRecording')
    control.onMenuAction('deleteRecording')
    expect(s.onBegin).not.toHaveBeenCalled()
  })
})
