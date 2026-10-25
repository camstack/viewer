/**
 * @vitest-environment jsdom
 *
 * `/connect?hub=…` and `?hub=` — a link OFFERS a hub, it never replaces the
 * active one (operator decision 2026-10-06). Mounted with the real
 * `ServerProvider` over the in-memory storage stubs, so what is asserted is
 * what the store really holds after each tap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { mountScreen } from '../../testing/mount.js'
import { routerCalls } from '../../testing/native-stubs/expo-router.js'
import { ServerStore } from '../../connection/server-store.js'
import { asyncKvStore } from '../../app/kv-async-storage.js'
import { secureKvStore } from '../../app/kv-secure-storage.js'
import { ConnectScreen } from '../ConnectScreen.js'
import { _resetPendingDeepLink, peekPendingDeepLinkHub, stashPendingDeepLink } from '../../navigation/pending-deep-link.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const A = { id: 'https://a.example.com', label: 'A', serverUrl: 'https://a.example.com' }
const B = { id: 'https://b.example.com', label: 'B', serverUrl: 'https://b.example.com' }

function store(): ServerStore {
  return new ServerStore(asyncKvStore, { secrets: secureKvStore })
}

async function seedSignedIn(...servers: readonly (typeof A)[]): Promise<void> {
  const s = store()
  for (const server of servers) {
    await s.upsertServer(server)
    await s.setSession(server.id, { token: `tok-${server.label}`, refreshToken: null })
  }
}

async function mountConnect(hub: string): Promise<void> {
  mountScreen(React.createElement(ConnectScreen), { params: { hub }, pathname: '/connect' })
  // Let ServerProvider finish its boot read.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  for (const server of [A, B]) await store().clearToken(server.id)
})

afterEach(() => {
  cleanup()
  _resetPendingDeepLink()
})

describe('/connect — logged out', () => {
  it('an unknown hub opens the login prefilled with that origin, nothing saved', async () => {
    await mountConnect('https://c.example.com')
    expect(await screen.findByDisplayValue('https://c.example.com')).toBeTruthy()
    expect(await store().getServers()).toEqual([])
  })

  it('a refused hub (http, a path) says so and never prefills it', async () => {
    await mountConnect('http://evil.example.com/steal')
    expect(await screen.findByText('This link does not name a valid hub')).toBeTruthy()
    expect(screen.queryByDisplayValue('http://evil.example.com/steal')).toBeNull()
  })
})

describe('/connect — signed in to A', () => {
  it('a link to saved, signed-in B asks first; the active server is unchanged until Switch', async () => {
    await seedSignedIn(A, B)
    await store().setActive(A.id)
    await mountConnect('https://b.example.com')

    expect(await screen.findByText('Switch to b.example.com?')).toBeTruthy()
    expect((await store().getActiveServer())?.id).toBe(A.id)

    await act(async () => {
      fireEvent.click(screen.getByText('Switch'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await vi.waitFor(async () => expect((await store().getActiveServer())?.id).toBe(B.id))
    // B's own token; A keeps its sign-in.
    expect(await store().getToken(A.id)).toBe('tok-A')
    expect(routerCalls()).toContainEqual({ kind: 'replace', target: '/cameras' })
  })

  it('"Stay" leaves A active', async () => {
    await seedSignedIn(A, B)
    await store().setActive(A.id)
    await mountConnect('https://b.example.com')
    fireEvent.click(await screen.findByText('Stay on the current server'))
    expect((await store().getActiveServer())?.id).toBe(A.id)
    expect(routerCalls()).toContainEqual({ kind: 'replace', target: '/' })
  })

  it('an unknown hub offers the login with Cancel, and A stays signed in', async () => {
    await seedSignedIn(A)
    await store().setActive(A.id)
    await mountConnect('https://c.example.com')
    expect(await screen.findByDisplayValue('https://c.example.com')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
    expect((await store().getActiveServer())?.id).toBe(A.id)
    expect(await store().getToken(A.id)).toBe('tok-A')
  })
})

describe('?hub= on a cold-start deep link', () => {
  it('the login prefill reads the hub through the same gate', () => {
    stashPendingDeepLink('/camera/101?at=1&hub=https%3A%2F%2Fb.example.com')
    expect(peekPendingDeepLinkHub()).toBe('https://b.example.com')
    _resetPendingDeepLink()
    stashPendingDeepLink('/camera/101?hub=http%3A%2F%2Fb.example.com')
    expect(peekPendingDeepLinkHub()).toBeNull()
  })
})
