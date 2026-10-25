import { describe, it, expect } from 'vitest'
import { parseAdhocDeviceIds, serializeAdhocDeviceIds } from '../adhoc-devices.js'

describe('serializeAdhocDeviceIds', () => {
  it('joins positive integer ids with commas', () => {
    expect(serializeAdhocDeviceIds([104, 102, 4])).toBe('104,102,4')
  })

  it('drops non-integers and non-positives', () => {
    expect(serializeAdhocDeviceIds([1, 0, -3, 2.5, Number.NaN, 7])).toBe('1,7')
  })

  it('yields the empty string for an empty list', () => {
    expect(serializeAdhocDeviceIds([])).toBe('')
  })
})

describe('parseAdhocDeviceIds', () => {
  it('parses a comma-separated list, preserving order', () => {
    expect(parseAdhocDeviceIds('104,102,4')).toEqual([104, 102, 4])
  })

  it('tolerates whitespace and dedupes', () => {
    expect(parseAdhocDeviceIds(' 5 , 5, 9 ')).toEqual([5, 9])
  })

  it('drops malformed / non-positive parts', () => {
    expect(parseAdhocDeviceIds('a,0,-1,2.5,,7')).toEqual([7])
  })

  it('handles undefined and the expo-router string[] shape', () => {
    expect(parseAdhocDeviceIds(undefined)).toEqual([])
    expect(parseAdhocDeviceIds(['1,2', '3'])).toEqual([1, 2, 3])
  })

  it('round-trips through serialize', () => {
    const ids = [12, 7, 33] as const
    expect(parseAdhocDeviceIds(serializeAdhocDeviceIds([...ids]))).toEqual([...ids])
  })
})
