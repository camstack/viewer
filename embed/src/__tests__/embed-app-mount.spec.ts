/**
 * EmbedApp mount harness — the hub-hosted renderer the operator's WebView loads.
 *
 * The native host mount (`src/events-embed/__tests__/events-embed-mount.spec.ts`)
 * proves a WebView is handed a source. This file proves the OTHER half of that
 * chain: `EmbedApp` routes on mode (query / fragment / injected global) and
 * mounts the matching page. Without it, a broken dispatcher is invisible until
 * a device opens the embed.
 *
 * Pages are stubbed: the harness owns routing, not WebRTC / feed wiring (those
 * already have page-level specs).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../pages/EmbedGridPage', () => ({
  EmbedGridPage: () => createElement('div', { 'data-testid': 'page-grid' }),
}))
vi.mock('../pages/EmbedPlayerPage', () => ({
  EmbedPlayerPage: () => createElement('div', { 'data-testid': 'page-player' }),
}))
vi.mock('../pages/EmbedRecordingPage', () => ({
  EmbedRecordingPage: () => createElement('div', { 'data-testid': 'page-recording' }),
}))
vi.mock('../pages/EmbedEventsPage', () => ({
  EmbedEventsPage: () => createElement('div', { 'data-testid': 'page-events' }),
}))

import { EmbedApp } from '../EmbedApp.js'

afterEach(() => {
  cleanup()
  delete (window as Window & { __CAMSTACK_EMBED_MODE__?: string }).__CAMSTACK_EMBED_MODE__
  window.history.replaceState({}, '', '/')
})

beforeEach(() => {
  delete (window as Window & { __CAMSTACK_EMBED_MODE__?: string }).__CAMSTACK_EMBED_MODE__
  window.history.replaceState({}, '', '/')
})

describe('EmbedApp mount harness', () => {
  it('defaults to the grid page', () => {
    render(createElement(EmbedApp))
    expect(screen.getByTestId('page-grid')).toBeTruthy()
  })

  it('routes ?mode=events to the events page', () => {
    window.history.replaceState({}, '', '/?mode=events')
    render(createElement(EmbedApp))
    expect(screen.getByTestId('page-events')).toBeTruthy()
  })

  it('routes ?mode=player and ?mode=recording', () => {
    window.history.replaceState({}, '', '/?mode=player')
    const player = render(createElement(EmbedApp))
    expect(screen.getByTestId('page-player')).toBeTruthy()
    player.unmount()

    window.history.replaceState({}, '', '/?mode=recording')
    render(createElement(EmbedApp))
    expect(screen.getByTestId('page-recording')).toBeTruthy()
  })

  it('reads mode from the fragment when the query has none (native file URL)', () => {
    window.history.replaceState({}, '', '/#mode=events')
    render(createElement(EmbedApp))
    expect(screen.getByTestId('page-events')).toBeTruthy()
  })

  it('prefers the injected __CAMSTACK_EMBED_MODE__ over the URL', () => {
    window.history.replaceState({}, '', '/?mode=grid')
    ;(window as Window & { __CAMSTACK_EMBED_MODE__?: string }).__CAMSTACK_EMBED_MODE__ = 'events'
    render(createElement(EmbedApp))
    expect(screen.getByTestId('page-events')).toBeTruthy()
  })
})
