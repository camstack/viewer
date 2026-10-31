import { describe, it, expect } from 'vitest'

import { formatSelectionSpan, resolveExportSelection } from '../export-selection.js'
import { planScopeSelectionCommit, planSelectionCommit } from '../selection-commit.js'

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

describe('planScopeSelectionCommit', () => {
  const TARGETS = [
    { deviceId: 7, name: 'Front door' },
    { deviceId: 9, name: 'Garage' },
  ]

  it('an export over N cameras is one createExport input per camera, over the same window, in scope order', () => {
    const plan = planScopeSelectionCommit('export', false, TARGETS, RANGE)
    expect(plan.action).toBe('export')
    if (plan.action !== 'export') return
    expect(plan.commits.map((c) => c.input)).toEqual([
      expect.objectContaining({ deviceId: 7, fromMs: FROM, toMs: TO }),
      expect.objectContaining({ deviceId: 9, fromMs: FROM, toMs: TO }),
    ])
  })

  it('a delete by an admin is one deleteFootprint request per camera', () => {
    expect(planScopeSelectionCommit('delete', true, TARGETS, RANGE)).toEqual({
      action: 'delete',
      commits: [
        { action: 'delete', request: { deviceId: 7, fromMs: FROM, toMs: TO } },
        { action: 'delete', request: { deviceId: 9, fromMs: FROM, toMs: TO } },
      ],
    })
  })

  it('a delete by a non-admin is refused before any commit exists', () => {
    expect(planScopeSelectionCommit('delete', false, TARGETS, RANGE)).toEqual({
      action: 'refuse',
      reason: 'not-admin',
    })
  })

  it('an empty scope refuses rather than committing nothing', () => {
    expect(planScopeSelectionCommit('export', true, [], RANGE)).toEqual({
      action: 'refuse',
      reason: 'no-cameras',
    })
  })

  it('with ONE camera the plan is exactly planSelectionCommit in a list of one', () => {
    const one = [{ deviceId: 7, name: 'Front door' }]
    const exp = planScopeSelectionCommit('export', false, one, RANGE)
    const del = planScopeSelectionCommit('delete', true, one, RANGE)
    expect(exp).toEqual({ action: 'export', commits: [planSelectionCommit('export', false, 7, RANGE)] })
    expect(del).toEqual({ action: 'delete', commits: [planSelectionCommit('delete', true, 7, RANGE)] })
  })
})
