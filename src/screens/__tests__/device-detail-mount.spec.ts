/**
 * @vitest-environment jsdom
 *
 * The device detail, mounted against a stub hub: the header is the viewer's,
 * everything under it is the hub's device card (`/embed/device/<id>`) in a
 * WebView, signed in through the seeded admin session — never the URL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { DeviceDetailScreen } from '../DeviceDetailScreen.js'
import { ADMIN_ACCESS_TOKEN_KEY } from '../../device-embed/device-embed-url.js'

interface CapturedWebView {
  readonly source: { readonly uri: string }
  readonly injectedJavaScriptBeforeContentLoaded: string
  readonly onNavigationStateChange: (nav: { url: string }) => void
  readonly onShouldStartLoadWithRequest: (nav: { url: string }) => boolean
  readonly onLoadEnd: () => void
}

const webviews = vi.hoisted(() => ({ last: null as unknown }))

vi.mock('react-native-webview', async () => {
  const { View } = await import('react-native')
  const ReactMod = await import('react')
  const WebView = (props: Record<string, unknown>) => {
    webviews.last = props
    return ReactMod.createElement(View, { testID: 'card-webview' })
  }
  return { __esModule: true, WebView, default: WebView }
})

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

vi.mock('../../app/ServerProvider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../app/ServerProvider.js')>()
  return {
    ...original,
    useServer: () => ({ ...original.useServer(), token: 'viewer-token' }),
  }
})

function lastWebView(): CapturedWebView {
  if (webviews.last === null) throw new Error('no WebView mounted')
  return webviews.last as CapturedWebView
}

const PLUG_HUB = {
  'deviceManager.listAll': [{ id: 22, name: 'Washer plug', type: 'switch', online: true, features: ['switch'] }],
}

function mountPlug(): void {
  mountScreen(React.createElement(DeviceDetailScreen, { deviceId: 22, deviceName: 'Washer plug', deviceType: 'switch' }), {
    hub: PLUG_HUB,
  })
}

afterEach(() => {
  cleanup()
  webviews.last = null
})

describe('DeviceDetailScreen', () => {
  it('keeps the header and loads the hub card for the device, theme and language', async () => {
    mountPlug()
    expect(screen.getByText('Washer plug')).toBeTruthy()
    expect(await screen.findByText('Online')).toBeTruthy()
    const view = lastWebView()
    expect(view.source.uri).toMatch(/^http:\/\/hub\.test:8080\/embed\/device\/22\?theme=(light|dark)&lang=en&host=viewer$/)
    // No native copy of the card is drawn any more.
    expect(screen.queryByText('Overview')).toBeNull()
    expect(screen.queryByText('History')).toBeNull()
  })

  it('signs the page in through the seeded session, never through the URL', () => {
    mountPlug()
    const view = lastWebView()
    expect(view.source.uri).not.toContain('viewer-token')
    expect(view.injectedJavaScriptBeforeContentLoaded).toContain(ADMIN_ACCESS_TOKEN_KEY)
    expect(view.injectedJavaScriptBeforeContentLoaded).toContain('"viewer-token"')
  })

  it('follows nothing off the hub, and a bounce to sign-in is a failure, not a login form', () => {
    mountPlug()
    const view = lastWebView()
    expect(view.onShouldStartLoadWithRequest({ url: 'http://hub.test:8080/embed/device/23' })).toBe(true)
    expect(view.onShouldStartLoadWithRequest({ url: 'https://elsewhere.example/' })).toBe(false)
    act(() => view.onNavigationStateChange({ url: 'http://hub.test:8080/login' }))
    expect(screen.getByTestId('device-card-error')).toBeTruthy()
    expect(screen.queryByTestId('card-webview')).toBeNull()
    fireEvent.click(screen.getByTestId('device-card-retry'))
    expect(screen.getByTestId('card-webview')).toBeTruthy()
  })

  it('shows a spinner until the card has loaded', () => {
    mountPlug()
    expect(screen.getByTestId('device-card-loading')).toBeTruthy()
    act(() => lastWebView().onLoadEnd())
    expect(screen.queryByTestId('device-card-loading')).toBeNull()
  })

  it('keeps clear of the notch and the home indicator', () => {
    mountPlug()
    const card = screen.getByTestId('card-webview').parentElement as HTMLElement
    expect(parseFloat(getComputedStyle(card).paddingBottom)).toBeGreaterThanOrEqual(34)
    let node: HTMLElement | null = screen.getByTestId('header-back')
    let top = 0
    while (node !== null && top < 47) {
      top = parseFloat(getComputedStyle(node).paddingTop) || 0
      node = node.parentElement
    }
    expect(top).toBeGreaterThanOrEqual(47)
  })
})
