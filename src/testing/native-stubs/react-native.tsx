/**
 * `react-native` under test = `react-native-web`, with ONE thing put back:
 * `Platform`.
 *
 * Half the platform-specific behaviour in this app is a `Platform.OS === 'ios'`
 * or a `Platform.select`, and react-native-web hard-codes `OS: 'web'` — so a
 * harness built straight on it can only ever exercise the web branch, which is
 * the branch the operator is NOT running. `setTestPlatform('ios')` before
 * mounting picks the branch the phone takes.
 *
 * Everything else is re-exported verbatim. An explicit export shadows the
 * `export *`, which is how `Platform` is replaced without listing 60 names.
 *
 * The container components are also re-exported with ONE native rule put back:
 * a raw string may not be a child of a view. See `assertNoRawText`.
 */
import * as React from 'react'
import {
  View as WebView,
  ScrollView as WebScrollView,
  Pressable as WebPressable,
  TouchableOpacity as WebTouchableOpacity,
  TouchableHighlight as WebTouchableHighlight,
  KeyboardAvoidingView as WebKeyboardAvoidingView,
  Text as WebText,
  Image as WebImage,
  StyleSheet as WebStyleSheet,
} from 'react-native-web'

import { countRender } from '../render-tally.js'
import { currentTestPlatform, type TestPlatformOS } from '../platform-control.js'
import {
  currentTestAppState,
  subscribeTestAppState,
  type TestAppStateHandler,
  type TestAppStateStatus,
} from '../app-state-control.js'

export * from 'react-native-web'

/**
 * The state and its setter live in `../platform-control.ts`, which a spec can
 * import WITHOUT dragging the untyped `react-native-web` into the type-checked
 * graph — same split as `AppState` below. Import `setTestPlatform` from there,
 * never from here.
 */
type PlatformOS = TestPlatformOS

interface PlatformSelectSpec<T> {
  readonly ios?: T
  readonly android?: T
  readonly native?: T
  readonly web?: T
  readonly default?: T
}

export const Platform = {
  get OS(): PlatformOS {
    return currentTestPlatform()
  },
  get Version(): number | string {
    return currentTestPlatform() === 'ios' ? '18.2' : 34
  },
  get isTV(): boolean {
    return false
  },
  get isTesting(): boolean {
    return true
  },
  select<T>(spec: PlatformSelectSpec<T>): T | undefined {
    const os = currentTestPlatform()
    if (os === 'web') return 'web' in spec ? spec.web : spec.default
    if (os === 'ios' && 'ios' in spec) return spec.ios
    if (os === 'android' && 'android' in spec) return spec.android
    if ('native' in spec) return spec.native
    return spec.default
  },
}

/**
 * `AppState`, replacing react-native-web's Page-Visibility-derived one, which
 * can only ever report `active` or `background` — and the two statuses that
 * matter on a phone (`inactive`, and the pre-`active` launch window) are
 * exactly the two it cannot produce.
 *
 * This is only the adapter; the state and its controls live in
 * `../app-state-control.ts`, which a spec can import without dragging the
 * untyped `react-native-web` into the type-checked graph.
 */
export const AppState = {
  get currentState(): TestAppStateStatus {
    return currentTestAppState()
  },
  addEventListener(
    type: string,
    handler: TestAppStateHandler,
  ): { remove: () => void } {
    if (type !== 'change') return { remove: (): void => undefined }
    const unsubscribe = subscribeTestAppState(handler)
    return { remove: unsubscribe }
  },
}

/**
 * The invariant react-native-web does NOT have.
 *
 * On a device, a bare string under a view is a hard crash — "Text strings must
 * be rendered within a <Text> component" — thrown by the renderer, uncaught,
 * taking the whole tree with it. On the web the same string is a legal DOM text
 * node and renders happily. So a harness built on react-native-web is BLIND to
 * one of the two ways a screen can die on first paint, and this app has no
 * error boundary above a tab to soften it.
 *
 * The usual sources are a stray `{' '}` left by a formatter, a `{count}` that
 * was meant to be inside a `<Text>`, and a `{cond && 'label'}` short-circuit.
 * `{cond && <Thing/>}` yielding `false`, `null` and `undefined` are all fine —
 * React drops them and so does the device.
 */
function assertNoRawText(name: string, children: React.ReactNode): void {
  React.Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      // '' renders nothing on either platform; flagging it would be noise.
      if (child === '') return
      throw new Error(
        `Text strings must be rendered within a <Text> component. ` +
          `Found ${JSON.stringify(String(child))} as a direct child of <${name}>.`,
      )
    }
    // React.Children does not descend into a fragment, but the device does.
    if (React.isValidElement(child) && child.type === React.Fragment) {
      const props: { children?: React.ReactNode } = child.props as { children?: React.ReactNode }
      assertNoRawText(name, props.children)
    }
  })
}

/**
 * The other invariant react-native-web does NOT have.
 *
 * Fabric converts a style value to a C++ `Float`. `NaN` and `Infinity` do not
 * survive that conversion and take the app down; on the web the same value is
 * an unparseable CSS declaration the browser discards without a word. The
 * sources are always arithmetic — a width divided by a column count that was
 * momentarily `0`, a ratio taken before a measured layout has arrived.
 */
function assertFiniteStyle(name: string, style: unknown): void {
  const flat: unknown = WebStyleSheet.flatten(style as never)
  if (typeof flat !== 'object' || flat === null) return
  for (const [key, value] of Object.entries(flat as Record<string, unknown>)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(
        `Style value ${key}: ${String(value)} on <${name}> is not a finite number. ` +
          `Fabric cannot convert it and the app crashes; the browser ignores it silently.`,
      )
    }
  }
}

interface GuardedProps {
  readonly children?: React.ReactNode
  readonly style?: unknown
}

function guarded<P extends GuardedProps>(
  Component: React.ComponentType<P>,
  name: string,
): React.ComponentType<P> {
  const Guarded = React.forwardRef<unknown, P>((props, ref) => {
    countRender(name)
    assertNoRawText(name, props.children)
    assertFiniteStyle(name, props.style)
    return React.createElement(Component as React.ComponentType<Record<string, unknown>>, {
      ...(props as Record<string, unknown>),
      ref,
    })
  })
  Guarded.displayName = name
  return Guarded as unknown as React.ComponentType<P>
}

function guardedStyleOnly<P extends GuardedProps>(
  Component: React.ComponentType<P>,
  name: string,
): React.ComponentType<P> {
  const Guarded = React.forwardRef<unknown, P>((props, ref) => {
    countRender(name)
    assertFiniteStyle(name, props.style)
    return React.createElement(Component as React.ComponentType<Record<string, unknown>>, {
      ...(props as Record<string, unknown>),
      ref,
    })
  })
  Guarded.displayName = name
  return Guarded as unknown as React.ComponentType<P>
}

export const View = guarded(WebView as React.ComponentType<GuardedProps>, 'View')
export const ScrollView = guarded(WebScrollView as React.ComponentType<GuardedProps>, 'ScrollView')
export const Pressable = guarded(WebPressable as React.ComponentType<GuardedProps>, 'Pressable')
export const TouchableOpacity = guarded(
  WebTouchableOpacity as React.ComponentType<GuardedProps>,
  'TouchableOpacity',
)
export const TouchableHighlight = guarded(
  WebTouchableHighlight as React.ComponentType<GuardedProps>,
  'TouchableHighlight',
)
export const KeyboardAvoidingView = guarded(
  WebKeyboardAvoidingView as React.ComponentType<GuardedProps>,
  'KeyboardAvoidingView',
)
/** `Text` may hold strings, so it is guarded for style values only. */
export const Text = guardedStyleOnly(WebText as React.ComponentType<GuardedProps>, 'Text')

/**
 * `Image.resolveAssetSource` — a METRO api, with no react-native-web equivalent.
 *
 * Every native embed host resolves the OTA bundle through it
 * (`live/use-native-embed-source.ts`: `Image.resolveAssetSource(localEmbedAsset)`),
 * and this harness runs as `Platform.OS = 'ios'` on purpose — so the moment a
 * mount test reached a WebView surface it died with `Image.resolveAssetSource
 * is not a function`. That is a hole in the STUB, not a device bug: on a device
 * Metro supplies both the function and the asset.
 *
 * It mattered on 2026-08-18, when the hub-hosted embed became the ONLY events
 * renderer: until then the mount tests always took the onboard branch, so the
 * embed surfaces (Library/Events, the Cameras reel, the grid) had never been
 * mounted by anything. Without this they still could not be.
 *
 * The shape returned is the one `resolveLocalSource` reads — a `uri` — sourced
 * from the `.html` asset stub, so the query string the host appends
 * (`?mode=events`) is built for real.
 */
interface ResolvedAssetSource {
  readonly uri: string
  readonly width: number
  readonly height: number
  readonly scale: number
}

function readUri(asset: unknown): string | null {
  if (typeof asset === 'string') return asset
  if (typeof asset !== 'object' || asset === null) return null
  const uri: unknown = (asset as { uri?: unknown }).uri
  return typeof uri === 'string' ? uri : null
}

function resolveAssetSource(asset: unknown): ResolvedAssetSource | null {
  const uri = readUri(asset)
  return uri === null ? null : { uri, width: 0, height: 0, scale: 1 }
}

const ImageBase = React.forwardRef<unknown, GuardedProps>((props, ref) =>
  React.createElement(WebImage as React.ComponentType<Record<string, unknown>>, {
    ...(props as Record<string, unknown>),
    ref,
  }),
)
ImageBase.displayName = 'Image'

export const Image = Object.assign(ImageBase, { resolveAssetSource })

/** Android-only, and absent from react-native-web entirely. */
export const PermissionsAndroid = {
  PERMISSIONS: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
  request: (): Promise<string> => Promise.resolve('granted'),
  check: (): Promise<boolean> => Promise.resolve(true),
}

/**
 * `InputAccessoryView` — iOS-only, and `react-native-web` has no equivalent,
 * so `export * from 'react-native-web'` leaves it UNDEFINED. This harness runs
 * as `Platform.OS = 'ios'`, so the first component to render one (the debug
 * note's keyboard "Done" bar) took the iOS branch and React was handed an
 * undefined element type: "Check the render method of `ConfirmProvider`".
 *
 * On a device UIKit docks this above the keyboard. There is no keyboard here,
 * so it renders its children in place — which keeps the bar's button
 * reachable to a test instead of hiding it behind a null stub.
 */
export function InputAccessoryView({
  children,
}: {
  readonly nativeID?: string
  readonly children?: React.ReactNode
}): React.ReactElement {
  return <>{children}</>
}
