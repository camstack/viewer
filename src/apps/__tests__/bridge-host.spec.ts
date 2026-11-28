import { describe, expect, it } from 'vitest'

import { helloMessage, interpretAppMessage, navigateMessage, searchMessage, themeMessage } from '../bridge-host.js'

const ENV = { dominevo: 'app-bridge', v: 1 } as const

describe('what the shell says to an app', () => {
  it('hello is the versioned envelope', () => {
    expect(helloMessage()).toEqual({ ...ENV, type: 'hello' })
  })
  it('navigate, search and theme carry their payload', () => {
    expect(navigateMessage('/x')).toEqual({ ...ENV, type: 'navigate', path: '/x' })
    expect(searchMessage('cam')).toEqual({ ...ENV, type: 'search', query: 'cam' })
    expect(themeMessage('dark')).toEqual({ ...ENV, type: 'theme', mode: 'dark' })
  })
})

describe('what an app says to the shell', () => {
  it('reads ready, path, invalidate and open-app, as an object or as JSON text', () => {
    expect(interpretAppMessage({ ...ENV, type: 'ready', path: '/a' })).toEqual({ kind: 'ready', path: '/a' })
    expect(interpretAppMessage(JSON.stringify({ ...ENV, type: 'path', path: '/b', title: 'B' }))).toEqual({
      kind: 'path',
      path: '/b',
      title: 'B',
    })
    expect(interpretAppMessage({ ...ENV, type: 'invalidate', what: 'nav' })).toEqual({ kind: 'invalidate', what: 'nav' })
    expect(interpretAppMessage({ ...ENV, type: 'open-app', appId: 'x', path: '/p' })).toEqual({
      kind: 'open-app',
      appId: 'x',
      path: '/p',
    })
  })

  it('ignores an unknown, malformed or foreign message', () => {
    expect(interpretAppMessage({ dominevo: 'app-bridge', v: 2, type: 'ready', path: '/' })).toBeNull()
    expect(interpretAppMessage({ ...ENV, type: 'teleport' })).toBeNull()
    expect(interpretAppMessage({ ...ENV, type: 'ready' })).toBeNull()
    expect(interpretAppMessage({ source: 'react-devtools' })).toBeNull()
    expect(interpretAppMessage('not json')).toBeNull()
    expect(interpretAppMessage(42)).toBeNull()
    expect(interpretAppMessage(null)).toBeNull()
  })

  it('ignores a shell-to-app message echoed back', () => {
    expect(interpretAppMessage(helloMessage())).toBeNull()
    expect(interpretAppMessage(navigateMessage('/x'))).toBeNull()
  })
})
