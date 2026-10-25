/**
 * @vitest-environment jsdom
 *
 * `useCapMutator` keeps the failure it used to swallow.
 *
 * A panel that refused to arm (`alarm-panel.arm` THROWS the refusal — the cap
 * answers `void`) looked exactly like a press that did nothing: the catch was
 * "best-effort" and the row simply stayed disarmed. A non-admin arms through
 * this path, so for them the refusal's text is the only evidence there is.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const REFUSAL = 'arm refused — open: Porch. Use "Arm anyway" to arm with them excluded.'
const arm = vi.fn()
let hasSystem = true

vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({
    state: 'connected',
    controller: {
      getSystem: () => (hasSystem ? { trpcClient: { alarmPanel: { arm: { mutate: arm } } } } : null),
    },
  }),
}))

// No i18n instance here: `t` echoes the key, which is the proof the APP's
// error went through translation rather than raw.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string): string => key }) }))

const { useCapMutator } = await import('../use-accessory-controls.js')

afterEach(() => {
  hasSystem = true
  arm.mockReset()
})

describe('useCapMutator — a failure is kept, not swallowed', () => {
  it('a thrown refusal lands in `error`, verbatim, and run does not rethrow', async () => {
    arm.mockRejectedValueOnce(new Error(REFUSAL))
    const { result } = renderHook(() => useCapMutator(1300))
    await act(async () => {
      await result.current.run('alarmPanel', 'arm', { mode: 'away' })
    })
    expect(arm).toHaveBeenCalledWith({ deviceId: 1300, mode: 'away' })
    expect(result.current.error).toBe(REFUSAL)
    expect(result.current.pending).toBe(false)
  })

  it('the next call that goes through clears it', async () => {
    arm.mockRejectedValueOnce(new Error(REFUSAL)).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useCapMutator(1300))
    await act(async () => {
      await result.current.run('alarmPanel', 'arm', { mode: 'away' })
    })
    await act(async () => {
      await result.current.run('alarmPanel', 'arm', { mode: 'away' })
    })
    expect(result.current.error).toBeNull()
  })

  it('a method the hub does not have is said, not silently skipped', async () => {
    const { result } = renderHook(() => useCapMutator(1300))
    await act(async () => {
      await result.current.run('alarmPanel', 'trigger', {})
    })
    expect(result.current.error).toBe('v2.accessories.unsupported')
  })

  it('not connected is said, translated', async () => {
    hasSystem = false
    const { result } = renderHook(() => useCapMutator(1300))
    await act(async () => {
      await result.current.run('alarmPanel', 'arm', { mode: 'away' })
    })
    expect(result.current.error).toBe('v2.nc.rules.editor.notConnected')
  })
})
