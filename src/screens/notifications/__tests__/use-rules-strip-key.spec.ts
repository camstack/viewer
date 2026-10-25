/**
 * @vitest-environment jsdom
 *
 * The Rules tab's strip tab survives the segment unmounting it, for the
 * session only — it is never written to storage (an ephemeral field).
 */
import { act, renderHook } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetRulesStripKeyForTests, useRulesStripKey } from '../use-rules-strip-key.js'

beforeEach(async () => {
  await AsyncStorage.clear()
  resetRulesStripKeyForTests()
})

describe('useRulesStripKey', () => {
  it('opens on All in a fresh session', () => {
    const { result } = renderHook(() => useRulesStripKey())
    expect(result.current[0]).toBe('all')
  })

  it('keeps the tab across an unmount within the session', () => {
    const first = renderHook(() => useRulesStripKey())
    act(() => first.result.current[1]('occupancy'))
    first.unmount()
    const second = renderHook(() => useRulesStripKey())
    expect(second.result.current[0]).toBe('occupancy')
  })

  it('writes nothing to storage', async () => {
    const { result } = renderHook(() => useRulesStripKey())
    act(() => result.current[1]('sensor'))
    expect(await AsyncStorage.getAllKeys()).toEqual([])
  })
})
