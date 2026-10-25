/**
 * `expo-image` under jsdom. Not `react-native-web`'s `Image`: that one resolves
 * the source through a native-ish loader and warns on `contentFit`. A screen
 * mounts identically either way — what matters is that the element exists and
 * that `Image.prefetch` / `Image.clearDiskCache` are callable, because several
 * viewer modules call them at module scope or in an effect.
 */
import React from 'react'
import { View, type ViewProps } from 'react-native'

interface ImageProps extends ViewProps {
  readonly source?: unknown
  readonly onLoad?: (event: ImageLoadEventData) => void
  readonly onDisplay?: () => void
  readonly onError?: (event: { readonly error: string }) => void
  readonly [key: string]: unknown
}

/**
 * Which sources FAIL to load, as a test decides. A real image can fail (the
 * data plane refused it, the network dropped it) and surfaces that through
 * `onError`; a stub that can only succeed hides every error path. Reset by
 * `resetExpoImageFailures()` — the test's `afterEach` calls it.
 */
// Kept on `globalThis`, not in module scope: vitest reaches this file through
// the `expo-image` alias for the component under test and through a relative
// path for the spec that sets the predicate — two module instances of the
// same file. A module-level variable would be set in one and read in the
// other.
const FAILING_KEY = '__camstackExpoImageFailing'
type FailPredicate = (uri: string) => boolean
function readFailing(): FailPredicate {
  const fn = (globalThis as Record<string, unknown>)[FAILING_KEY]
  return typeof fn === 'function' ? (fn as FailPredicate) : () => false
}
export function failExpoImageWhen(predicate: FailPredicate): void {
  ;(globalThis as Record<string, unknown>)[FAILING_KEY] = predicate
}
export function resetExpoImageFailures(): void {
  delete (globalThis as Record<string, unknown>)[FAILING_KEY]
}

/** `data-testid` prefix carrying the source a stubbed image was handed. */
export const EXPO_IMAGE_TESTID_PREFIX = 'expo-image:'

/**
 * Whether the source carried an `Authorization` header, as a DOM attribute.
 *
 * A hub address without the session token answers 401, and expo-image reports
 * that as a plain `onError` — a black tile with nothing to read. Carrying the
 * uri alone let a test watch a tile point at the right address and still fail
 * on the device for want of a credential, which is exactly what shipped on
 * 2026-09-21: 61 asks, 61 failures, every one of them a 401.
 */
export const EXPO_IMAGE_AUTHORIZED = 'expo-image:authorized'
/** …and its opposite, which is the one worth asserting. */
export const EXPO_IMAGE_UNAUTHORIZED = 'expo-image:unauthorized'

function sourceAuthorized(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const headers: unknown = (source as { headers?: unknown }).headers
  if (typeof headers !== 'object' || headers === null) return false
  const auth: unknown = (headers as { Authorization?: unknown }).Authorization
  return typeof auth === 'string' && auth.length > 0
}

function sourceUri(source: unknown): string {
  if (typeof source === 'string') return source
  if (typeof source === 'object' && source !== null) {
    const uri: unknown = (source as { uri?: unknown }).uri
    if (typeof uri === 'string') return uri
  }
  return ''
}

/**
 * The stub carries its `source.uri` out to the DOM as a `testID`.
 *
 * Without it a mount test can see THAT a tile rendered but not WHICH frame it
 * pointed at — and "the tile lost its image source" (`SnapshotImage` returns
 * null when the candidate is null) is indistinguishable from "the tile is one
 * div shallower". That distinction is the whole of the snapshot-blanking
 * contract, so it has to be observable.
 */
export function Image({ style, source, onLoad, onDisplay, onError }: ImageProps): React.ReactElement {
  const uri = sourceUri(source)
  const authorized = sourceAuthorized(source)
  // A source that never reports back is a source that never FINISHES loading,
  // and every snapshot surface keys its state machine on that: `everLoaded`
  // stays false, so the skeleton never lifts and neither the age chip nor the
  // offline chip can ever be asserted. A stub that silently omits a callback
  // production depends on hides exactly the transitions these tests exist for.
  //
  // Order matters and mirrors the real module: `onLoad` first (with the
  // resolved url, which `SnapshotImage` compares against its own candidate to
  // reject a late generation), then `onDisplay` once pixels are up.
  //
  // The callbacks are read through a ref and the effect depends on the URI
  // ALONE. Both are inline arrows rebuilt on every render, so an effect that
  // depended on them would fire again for each render they cause — and
  // `onDisplay` sets state, so that is an unbounded loop, not a re-notify.
  const handlers = React.useRef({ onLoad, onDisplay, onError })
  React.useEffect(() => {
    handlers.current = { onLoad, onDisplay, onError }
  })
  //
  // Reported on a LATER TICK, never inside the mount's own effect flush. A real
  // decode is asynchronous, and the difference is not cosmetic: `useSnapshot`
  // resets its load state in an effect keyed on the device id, and an ancestor's
  // effect runs AFTER its descendants' — so a stub that reported the load
  // synchronously had `everLoaded` set and then immediately wiped, leaving every
  // tile stuck on its skeleton for reasons no device would have.
  React.useEffect(() => {
    if (uri.length === 0) return undefined
    const timer = setTimeout(() => {
      if (readFailing()(uri)) {
        handlers.current.onError?.({ error: `stubbed load failure for ${uri}` })
        return
      }
      handlers.current.onLoad?.({ source: { url: uri, width: 1280, height: 720 } })
      handlers.current.onDisplay?.()
    }, 0)
    return () => clearTimeout(timer)
  }, [uri])
  // The auth flag rides in the testID rather than as a loose DOM attribute:
  // `View`'s props are typed, and a stub that casts to smuggle one in would be
  // a stub lying about the shape it stands for.
  return React.createElement(View, {
    style,
    testID: `${EXPO_IMAGE_TESTID_PREFIX}${uri}`,
    accessibilityLabel: authorized ? EXPO_IMAGE_AUTHORIZED : EXPO_IMAGE_UNAUTHORIZED,
  })
}
Image.prefetch = (): Promise<boolean> => Promise.resolve(true)
Image.clearDiskCache = (): Promise<boolean> => Promise.resolve(true)
Image.clearMemoryCache = (): Promise<boolean> => Promise.resolve(true)
Image.getCachePathAsync = (): Promise<string | null> => Promise.resolve(null)

export const ImageBackground = Image
export type ImageContentFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
export interface ImageLoadEventData {
  /** `url` is load-bearing: `SnapshotImage` compares it against its own
   *  candidate so a slow generation that finishes late cannot become the
   *  painted backing frame. */
  readonly source: { readonly url: string; readonly width: number; readonly height: number }
}
export type ImageStyle = Record<string, unknown>
export type ImageSource = { readonly uri?: string }
