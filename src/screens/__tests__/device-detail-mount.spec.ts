/**
 * @vitest-environment jsdom
 *
 * The device detail, mounted against a stub hub: a sheet whose header is the
 * viewer's (the name alone) and whose body is the hub's
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
  readonly onMessage: (event: { nativeEvent: { data: string } }) => void
}

const webviews = vi.hoisted(() => ({ last: null as unknown, scripts: [] as string[] }))

const tokenBox = vi.hoisted(() => {
  let token = 'viewer-token'
  const listeners = new Set<() => void>()
  return {
    get: (): string => token,
    set: (next: string): void => {
      token = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})

vi.mock('react-native-webview', async () => {
  const { View } = await import('react-native')
  const ReactMod = await import('react')
  const WebView = ReactMod.forwardRef((props: { readonly [key: string]: unknown }, ref: React.Ref<unknown>) => {
    webviews.last = props
    ReactMod.useImperativeHandle(ref, () => ({
      injectJavaScript: (script: string): void => {
        webviews.scripts.push(script)
      },
    }))
    return ReactMod.createElement(View, { testID: 'card-webview' })
  })
  return { __esModule: true, WebView, default: WebView }
})

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

vi.mock('../../app/ServerProvider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../app/ServerProvider.js')>()
  const ReactMod = await import('react')
  return {
    ...original,
    useServer: () => {
      const token = ReactMod.useSyncExternalStore(tokenBox.subscribe, tokenBox.get, tokenBox.get)
      return { ...original.useServer(), token }
    },
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
  webviews.scripts = []
  tokenBox.set('viewer-token')
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

  it('shows a spinner until the card for this device is ready, not when the document loads', () => {
    mountPlug()
    expect(screen.getByTestId('device-card-loading')).toBeTruthy()
    act(() => lastWebView().onLoadEnd())
    expect(screen.getByTestId('device-card-loading')).toBeTruthy()
    act(() => lastWebView().onMessage({ nativeEvent: { data: '{"type":"card-ready","deviceId":99}' } }))
    expect(screen.getByTestId('device-card-loading')).toBeTruthy()
    act(() => lastWebView().onMessage({ nativeEvent: { data: '{"type":"card-ready","deviceId":22}' } }))
    expect(screen.queryByTestId('device-card-loading')).toBeNull()
  })

  it('keeps one document when the token or the device changes, and messages the page', () => {
    let setId: ((id: number) => void) | null = null
    function Harness(): React.ReactElement {
      const [id, set] = React.useState(22)
      React.useEffect(() => {
        setId = set
        return () => {
          setId = null
        }
      }, [])
      return React.createElement(DeviceDetailScreen, {
        deviceId: id,
        deviceName: 'Washer plug',
        deviceType: 'switch',
      })
    }
    mountScreen(React.createElement(Harness), { hub: PLUG_HUB })
    const node = screen.getByTestId('card-webview')
    act(() => lastWebView().onLoadEnd())
    act(() => tokenBox.set('viewer-token-2'))
    expect(screen.getByTestId('card-webview')).toBe(node)
    expect(webviews.scripts.some((script) => script.includes('set-token') && script.includes('viewer-token-2'))).toBe(
      true,
    )
    act(() => setId?.(23))
    expect(screen.getByTestId('card-webview')).toBe(node)
    expect(webviews.scripts.some((script) => script.includes('show-device') && script.includes('23'))).toBe(true)
  })

  it('opens as a sheet whose header names the device alone: no provider, no reachability badge', async () => {
    mountPlug()
    expect(screen.getByTestId('device-sheet')).toBeTruthy()
    const header = screen.getByTestId('device-sheet-header')
    expect(header.textContent).toContain('Washer plug')
    await act(async () => {
      await Promise.resolve()
    })
    expect(within(header).queryByText(/Homematic|Casa/)).toBeNull()
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
