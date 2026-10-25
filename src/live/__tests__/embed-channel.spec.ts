import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerEmbedChannel, getEmbedChannel, createEmbedChannel } from '../embed-channel.js'

describe('embed-channel', () => {
  beforeEach(() => {
    getEmbedChannel(7)?.unregister?.()
  })

  it('registers and retrieves a channel by deviceId', () => {
    const ch = createEmbedChannel()
    const off = registerEmbedChannel(7, ch)
    expect(getEmbedChannel(7)).toBe(ch)
    off()
    expect(getEmbedChannel(7)).toBeUndefined()
  })

  it('notifies micState subscribers', () => {
    const ch = createEmbedChannel()
    const cb = vi.fn()
    const off = ch.subscribeMicState(cb)
    ch.setMicState('talking')
    expect(cb).toHaveBeenCalledWith('talking')
    expect(ch.getMicState()).toBe('talking')
    off()
    ch.setMicState('idle')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('forwards postCommand to the registered sender', () => {
    const send = vi.fn()
    const ch = createEmbedChannel(send)
    ch.postCommand({ kind: 'setMic', value: true })
    expect(send).toHaveBeenCalledWith({ kind: 'setMic', value: true })
  })
})
