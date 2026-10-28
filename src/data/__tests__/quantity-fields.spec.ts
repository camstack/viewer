import { describe, expect, it } from 'vitest'
import {
  BATTERY_LEVEL,
  quantityArgs,
  readQuantity,
  readQuantityNullable,
  readQuantityNumber,
} from '../quantity-fields'

describe('quantity-fields', () => {
  it('reads the new name, then the old one', () => {
    expect(readQuantityNumber({ level: 40 }, BATTERY_LEVEL)).toBe(40)
    expect(readQuantityNumber({ percentage: 55 }, BATTERY_LEVEL)).toBe(55)
  })

  it('the new name wins when a payload carries both', () => {
    expect(readQuantityNumber({ level: 40, percentage: 99 }, BATTERY_LEVEL)).toBe(40)
  })

  it('a new-name null is an answer and does not fall through to a stale old name', () => {
    expect(readQuantityNullable({ level: null, percentage: 99 }, BATTERY_LEVEL)).toBeNull()
    expect(readQuantity({ level: null }, BATTERY_LEVEL)).toBeNull()
  })

  it('says nothing for a missing, non-numeric or non-finite value', () => {
    expect(readQuantityNumber({}, BATTERY_LEVEL)).toBeUndefined()
    expect(readQuantityNumber({ level: '40' }, BATTERY_LEVEL)).toBeUndefined()
    expect(readQuantityNullable({ level: Number.NaN }, BATTERY_LEVEL)).toBeUndefined()
  })

  it('a write carries both names', () => {
    expect(quantityArgs(BATTERY_LEVEL, 30)).toEqual({ level: 30, percentage: 30 })
  })
})
