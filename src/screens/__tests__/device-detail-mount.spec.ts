/**
 * @vitest-environment jsdom
 *
 * The device detail, mounted against a stub hub: a sheet whose header is the
 * viewer's (name, integration chip) and whose body is the hub's
 * device card (`/embed/device/<id>?host=viewer`) in a WebView, signed in
 * through the seeded admin session — never the URL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { DeviceDetailScreen } from '../DeviceDetailScreen.js'
import { ADMIN_ACCESS_TOKEN_KEY } from '../../device-embed/device-embed-url.js'
import { routerCalls, setTestCanGoBack } from '../../testing/native-stubs/expo-router.js'

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
  'deviceManager.listAll': [
    {
      id: 22,
      name: 'Washer plug',
      type: 'switch',
      online: true,
      features: ['switch'],
      addonId: 'provider-homematic',
      integrationId: 'int-1',
    },
  ],
  'addons.list': [{ manifest: { id: 'provider-homematic', name: 'Homematic' } }],
  'integrations.get': { id: 'int-1', addonId: 'provider-homematic', name: 'Casa' },
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
    // An online device draws no reachability badge in the header (the card
    // owns the Offline chip).
    expect(await screen.findByTestId('card-webview')).toBeTruthy()
    expect(screen.queryByText('Online')).toBeNull()
    expect(screen.queryByText('Offline')).toBeNull()
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

  it('opens as a sheet whose header carries the integration and no reachability badge', async () => {
    mountPlug()
    expect(screen.getByTestId('device-sheet')).toBeTruthy()
    const header = screen.getByTestId('device-sheet-header')
    expect(header.textContent).toContain('Washer plug')
    expect(await screen.findByText('Homematic (Casa)')).toBeTruthy()
    // The card's own chip is the only reachability mark.
    expect(within(header).queryByText(/online|offline/i)).toBeNull()
  })

  it('closing the sheet goes back to the screen it was opened over', async () => {
    vi.useFakeTimers()
    try {
      mountPlug()
      fireEvent.click(within(screen.getByTestId('device-sheet-header')).getByLabelText('Close'))
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(routerCalls().filter((c) => c.kind === 'back')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closing a sheet reached cold (no history) lands on the home screen, never a blank one', async () => {
    vi.useFakeTimers()
    try {
      mountPlug()
      setTestCanGoBack(false)
      fireEvent.click(within(screen.getByTestId('device-sheet-header')).getByLabelText('Close'))
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(routerCalls().filter((c) => c.kind === 'back')).toHaveLength(0)
      expect(routerCalls().filter((c) => c.kind === 'replace').map((c) => c.target)).toEqual(['/'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a sheet unmounted mid-close never pops the screen that replaced it', async () => {
    vi.useFakeTimers()
    try {
      mountPlug()
      fireEvent.click(within(screen.getByTestId('device-sheet-header')).getByLabelText('Close'))
      cleanup()
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(routerCalls().filter((c) => c.kind === 'back' || c.kind === 'replace')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
