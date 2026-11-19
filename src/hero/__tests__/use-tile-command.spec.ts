/**
 * @vitest-environment jsdom
 *
 * The failure verdict is THIS press's: an error the shared caller still holds
 * from another control must not fail a fresh press while its call is in flight.
 */
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { HeroCaller } from '../use-hero.js'
import type { RowArm } from '../row-arm.js'
import type { TileAction } from '../tile-action.js'
import { useTileCommand } from '../use-tile-command.js'

const action: TileAction = { id: 'own-power.off', call: { cap: 'switch', method: 'turnOff', args: {} }, confirm: null }
const arm: RowArm = { armedId: null, press: (_id, _needs, fire) => fire() }

function callerWith(error: string | null, runCall: HeroCaller['runCall']): HeroCaller {
  return { pending: false, error, runAction: () => Promise.resolve(), runCall, refresh: () => Promise.resolve(), runValue: () => Promise.resolve() }
}

describe('useTileCommand', () => {
  it('a stale caller error does not fail a press whose call is still in flight', () => {
    const caller = callerWith('old refusal', () => new Promise<void>(() => undefined))
    const { result } = renderHook(() => useTileCommand({ action, stateKey: 'on', caller, arm }))
    act(() => result.current.press())
    expect(result.current.phase).toBe('pending')
    expect(result.current.shake).toBe(0)
  })

  it('an error present once the call has answered fails the press', async () => {
    let finish: () => void = () => undefined
    const caller = callerWith('refused', () => new Promise<void>((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useTileCommand({ action, stateKey: 'on', caller, arm }))
    act(() => result.current.press())
    expect(result.current.phase).toBe('pending')
    await act(async () => finish())
    expect(result.current.phase).toBe('idle')
    expect(result.current.shake).toBe(1)
  })
})
