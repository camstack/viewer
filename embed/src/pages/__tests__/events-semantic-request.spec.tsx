/**
 * The request the mounted Events page SENDS for a semantic search — observed
 * on the client it calls, not read off its source text.
 *
 * `minScore` rides the request only when the operator set one; absent, the hub
 * applies its own floor (0.2 today, per embedding model from D649). A floor
 * re-invented anywhere between the config and the call (`?? 0.2` on the page,
 * a default in the schema) would put a MobileCLIP number on a SigLIP2 search.
 */
import { createElement } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '../EmbedEventsPage'
import { parseEventsConfig, type EventsConfig } from '../../embed/events-config'
import type { EventsDataClient, SearchObjectEventsInput } from '../../embed/events-client'
import { resetAuthedImageCache } from '../../embed/use-authed-image'

let searches: SearchObjectEventsInput[] = []

function config(patch: Record<string, unknown>): EventsConfig {
  const result = parseEventsConfig({
    serverUrl: 'https://hub.test',
    token: 'jwt',
    refreshMs: 0,
    deviceIds: [101],
    view: 'gallery',
    search: 'red car',
    searchMode: 'semantic',
    ...patch,
  })
  if (!result.ok) throw new Error(result.error)
  return result.config
}

function recordingClient(): EventsDataClient {
  return {
    listRecentTracks: () => Promise.resolve({ tracks: [], nextCursor: null }),
    listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door', isCamera: true }]),
    searchObjectEvents: (input) => {
      searches.push(input)
      return Promise.resolve([])
    },
    listEventKinds: () => Promise.resolve([]),
  }
}

beforeEach(() => {
  searches = []
  resetAuthedImageCache()
  Reflect.set(window, 'ReactNativeWebView', { postMessage: () => {} })
  Reflect.set(
    window,
    'IntersectionObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false })),
  )
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:stub'
    URL.revokeObjectURL = () => {}
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the semantic search request the page sends', () => {
  it('no score set → the request carries NO minScore', async () => {
    render(createElement(Events, { client: recordingClient(), initialConfig: config({}) }))
    await waitFor(() => expect(searches).toHaveLength(1))
    expect(searches[0]).not.toHaveProperty('minScore')
    expect(searches[0]).toMatchObject({ text: 'red car', limit: 50, deviceId: 101 })
  })

  it('an explicit score is sent verbatim — 0 included', async () => {
    render(createElement(Events, { client: recordingClient(), initialConfig: config({ semanticMinScore: 0.35 }) }))
    await waitFor(() => expect(searches).toHaveLength(1))
    expect(searches[0]?.minScore).toBe(0.35)
    cleanup()
    searches = []
    render(createElement(Events, { client: recordingClient(), initialConfig: config({ semanticMinScore: 0 }) }))
    await waitFor(() => expect(searches).toHaveLength(1))
    expect(searches[0]?.minScore).toBe(0)
  })
})
