import { describe, expect, it, vi } from 'vitest'

import { bridgeChannel } from '../bridge-channel.js'
import { helloMessage } from '../bridge-host.js'

describe('the bridge channel to the framed app', () => {
  it('delivers to the frame that registered, and says whether anyone took it', () => {
    const send = vi.fn()
    const release = bridgeChannel.attach(send)
    expect(bridgeChannel.send(helloMessage())).toBe(true)
    expect(send).toHaveBeenCalledWith(helloMessage())
    release()
    expect(bridgeChannel.send(helloMessage())).toBe(false)
  })

  it('a frame that was replaced cannot detach its successor', () => {
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = bridgeChannel.attach(first)
    const releaseSecond = bridgeChannel.attach(second)
    releaseFirst()
    expect(bridgeChannel.send(helloMessage())).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    releaseSecond()
  })
})
