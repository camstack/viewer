import { describe, expect, it } from 'vitest'

import { frameTargetOf } from '../admin-frame.js'
import { MAX_ATTEMPTS, createReadyNavigator } from '../ready-navigation.js'

const page = frameTargetOf({ kind: 'addon-page', pageId: 'homematic-ccu' })
const web = frameTargetOf({ kind: 'web', path: '/x', auth: 'handoff' })

/** A stub bridge: what the shell would send for each `ready` the page reports. */
function harness(planKind: 'webview-handoff' | 'iframe', target: ReturnType<typeof frameTargetOf>) {
  const nav = createReadyNavigator()
  const sent: string[] = []
  return {
    sent,
    reset: nav.reset,
    ready: (entryPath: string | null = null, reportedPath = '/') => {
      const path = nav.onReady({ planKind, target, entryPath, reportedPath })
      if (path !== null) sent.push(path)
    },
  }
}

describe('where a framed app is sent on ready', () => {
  it('an addon page on the handoff plan: navigates until the page reports being there, again after a reload', () => {
    const h = harness('webview-handoff', page)
    h.ready()
    h.ready(null, '/addon/homematic-ccu')
    h.ready(null, '/addon/homematic-ccu')
    expect(h.sent).toEqual(['/addon/homematic-ccu'])
    h.reset()
    h.ready()
    expect(h.sent).toEqual(['/addon/homematic-ccu', '/addon/homematic-ccu'])
  })

  it('the admin redirecting to its last page after the first ready (the Logs bug) is navigated away from again', () => {
    const h = harness('webview-handoff', page)
    h.ready(null, '/')
    h.ready(null, '/system/logs')
    h.ready(null, '/addon/homematic-ccu')
    expect(h.sent).toEqual(['/addon/homematic-ccu', '/addon/homematic-ccu'])
  })

  it('stops after MAX_ATTEMPTS when the page keeps redirecting', () => {
    const h = harness('webview-handoff', page)
    for (let i = 0; i < 10; i++) h.ready(null, '/system/logs')
    expect(h.sent).toHaveLength(MAX_ATTEMPTS)
  })

  it('never for a web entry and never on the iframe plan', () => {
    const a = harness('webview-handoff', web)
    a.ready()
    const b = harness('iframe', page)
    b.ready()
    expect(a.sent).toEqual([])
    expect(b.sent).toEqual([])
  })

  it('a page that already reports its own path is left alone', () => {
    const h = harness('webview-handoff', page)
    h.ready(null, '/addon/homematic-ccu')
    expect(h.sent).toEqual([])
  })

  it('a search result path wins and spends the page navigation of that load', () => {
    const h = harness('webview-handoff', page)
    h.ready('/addon/homematic-ccu/devices')
    h.ready(null, '/addon/homematic-ccu/devices')
    h.ready()
    expect(h.sent).toEqual(['/addon/homematic-ccu/devices'])
  })

  it('a redirect after a search-result navigate retries that path, not the page root', () => {
    const h = harness('webview-handoff', page)
    h.ready('/addon/homematic-ccu/devices', '/')
    h.ready(null, '/system/logs')
    expect(h.sent).toEqual(['/addon/homematic-ccu/devices', '/addon/homematic-ccu/devices'])
  })

  it('after arrival, a ready at a different path (the user navigated away) is left alone', () => {
    const h = harness('webview-handoff', page)
    h.ready(null, '/addon/homematic-ccu')
    h.ready(null, '/system/logs')
    expect(h.sent).toEqual([])
  })
})
