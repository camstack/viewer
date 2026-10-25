import { describe, it, expect } from 'vitest'
import { resolvePrimaryChildByType, CONTAINER_CHILD_PRIORITY } from '../container-primary.js'

describe('resolvePrimaryChildByType — container primary-child resolution', () => {
  it('returns null for an empty child set', () => {
    expect(resolvePrimaryChildByType([])).toBeNull()
  })

  it('picks the climate child of a Gree-A/C-style container over its switches', () => {
    // Mirrors device 560 (Gree A/C): a climate child + light/x-fan/health switches.
    const children = [
      { id: 562, type: 'switch' },
      { id: 561, type: 'climate' },
      { id: 563, type: 'switch' },
      { id: 564, type: 'switch' },
    ]
    expect(resolvePrimaryChildByType(children)?.id).toBe(561)
  })

  it('an actuator outranks a bare switch', () => {
    expect(resolvePrimaryChildByType([{ id: 1, type: 'switch' }, { id: 2, type: 'lock' }])?.id).toBe(2)
    expect(resolvePrimaryChildByType([{ id: 1, type: 'switch' }, { id: 2, type: 'cover' }])?.id).toBe(2)
  })

  it('unknown / absent types sort after every known entry', () => {
    expect(
      resolvePrimaryChildByType([{ id: 1, type: 'mystery' }, { id: 2, type: 'switch' }])?.id,
    ).toBe(2)
    // all-unknown → the first (stable order) wins
    expect(
      resolvePrimaryChildByType([{ id: 9, type: 'x' }, { id: 8, type: 'y' }])?.id,
    ).toBe(9)
  })

  it('is stable for equal-priority children (input order wins)', () => {
    expect(
      resolvePrimaryChildByType([{ id: 5, type: 'switch' }, { id: 6, type: 'switch' }])?.id,
    ).toBe(5)
  })

  it('priority places climate above switch and siren below switch', () => {
    expect(CONTAINER_CHILD_PRIORITY.indexOf('climate')).toBeLessThan(
      CONTAINER_CHILD_PRIORITY.indexOf('switch'),
    )
    expect(CONTAINER_CHILD_PRIORITY.indexOf('siren')).toBeGreaterThan(
      CONTAINER_CHILD_PRIORITY.indexOf('switch'),
    )
  })
})
