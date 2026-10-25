import { describe, it, expect } from 'vitest'
import { NC_CONDITION_CATALOG } from '@camstack/types'
import { isNumberConditionKey } from '../condition-field-keys.js'
import { scopeDescriptorRole } from '../rule-scope-form.js'

describe('condition-field-keys', () => {
  it('every catalog descriptor of valueType number has a key guard', () => {
    const numberIds = NC_CONDITION_CATALOG.filter((d) => d.valueType === 'number').map((d) => d.id)
    // Non-vacuous: the published catalog carries at least one today.
    expect(numberIds.length).toBeGreaterThan(0)
    for (const id of numberIds) expect(isNumberConditionKey(id)).toBe(true)
  })

  it('every zone-list descriptor is a SCOPE field, never a widget of its own', () => {
    const zoneIds = NC_CONDITION_CATALOG.filter(
      (d) => d.valueType === 'zoneIdList' || d.valueType === 'zoneSelection',
    ).map((d) => d.id)
    expect(zoneIds.length).toBeGreaterThan(0)
    for (const id of zoneIds) expect(scopeDescriptorRole(id)?.axis).toBe('zones')
  })

  it('the guard rejects a key it does not know — a new descriptor renders nothing rather than writing the wrong key', () => {
    expect(isNumberConditionKey('minFutureThing')).toBe(false)
    expect(isNumberConditionKey('zonesExclude')).toBe(false)
  })
})
