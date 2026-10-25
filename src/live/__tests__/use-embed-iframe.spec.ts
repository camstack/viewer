// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { handleBridgeMessage } from '../use-embed-iframe.js'

describe('handleBridgeMessage', () => {
  it('replies to embed-ready with embed-config built from buildConfig', () => {
    const post = vi.fn()
    const onHost = vi.fn()
    handleBridgeMessage({ type: 'embed-ready', mode: 'player' }, { postToEmbed: post, onHostMessage: onHost, buildConfig: () => ({ id: 9 }) })
    expect(post).toHaveBeenCalledWith({ type: 'embed-config', config: { id: 9 } })
    expect(onHost).not.toHaveBeenCalled()
  })

  it('routes any other message to onHostMessage', () => {
    const post = vi.fn()
    const onHost = vi.fn()
    handleBridgeMessage({ type: 'state', state: 'playing' }, { postToEmbed: post, onHostMessage: onHost, buildConfig: () => ({}) })
    expect(onHost).toHaveBeenCalledWith({ type: 'state', state: 'playing' })
    expect(post).not.toHaveBeenCalled()
  })

  it('ignores non-object data', () => {
    const post = vi.fn()
    const onHost = vi.fn()
    handleBridgeMessage('junk', { postToEmbed: post, onHostMessage: onHost, buildConfig: () => ({}) })
    expect(post).not.toHaveBeenCalled()
    expect(onHost).not.toHaveBeenCalled()
  })
})
