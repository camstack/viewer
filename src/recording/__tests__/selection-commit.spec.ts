import { describe, it, expect } from 'vitest'

import { formatSelectionSpan, resolveExportSelection } from '../export-selection.js'
import { planSelectionCommit } from '../selection-commit.js'

const FROM = Date.parse('2026-09-07T10:00:00Z')
const TO = Date.parse('2026-09-07T10:01:20Z')
const RANGE = resolveExportSelection(TO, FROM, TO + 60_000)!

describe('planSelectionCommit', () => {
  it('an export builds the createExport input from the ordered range', () => {
    const plan = planSelectionCommit('export', false, 7, RANGE)
    expect(plan).toMatchObject({ action: 'export', input: { deviceId: 7, fromMs: FROM, toMs: TO } })
  })

  it('a delete by an admin is deleteFootprint over exactly the selected window', () => {
    expect(planSelectionCommit('delete', true, 7, RANGE)).toEqual({
      action: 'delete',
      request: { deviceId: 7, fromMs: FROM, toMs: TO },
    })
  })

  it('a delete by anyone the hub has not confirmed as admin is REFUSED, never planned', () => {
    expect(planSelectionCommit('delete', false, 7, RANGE)).toEqual({
      action: 'refuse',
      reason: 'not-admin',
    })
  })

  it('an export is not an admin act', () => {
    expect(planSelectionCommit('export', false, 7, RANGE).action).toBe('export')
  })
})

describe('formatSelectionSpan — what the confirm button names', () => {
  it('reads like the operator wrote it', () => {
    expect(formatSelectionSpan(80_000)).toBe('1m20s')
    expect(formatSelectionSpan(45_000)).toBe('45s')
    expect(formatSelectionSpan(60_000)).toBe('1m00s')
    expect(formatSelectionSpan(3_720_000)).toBe('1h02m')
    expect(formatSelectionSpan(0)).toBe('0s')
  })
})
