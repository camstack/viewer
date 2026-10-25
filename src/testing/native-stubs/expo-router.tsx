/**
 * expo-router under test. Navigation is recorded, never performed: the router
 * object collects `push`/`replace`/`back` calls so a test can assert on them,
 * and `useLocalSearchParams` reads a module-level bag the harness sets before
 * mounting (`setTestSearchParams`) — that is how a deep-linked screen
 * (`?section=exports`, `?trackId=…`) gets exercised.
 *
 * `useFocusEffect` runs the effect once, like a freshly focused screen.
 */
import React from 'react'
import { View, type ViewProps } from 'react-native'
import { useTestFocusGeneration, useTestIsFocused } from '../focus-control.js'

export type Href = string

export interface RouterCall {
  readonly kind: 'push' | 'replace' | 'back' | 'dismissTo' | 'setParams' | 'navigate' | 'dispatch'
  readonly target?: unknown
}

let calls: RouterCall[] = []
let searchParams: Record<string, string | string[] | undefined> = {}
let pathname = '/'
/** What `router.canGoBack()` answers — `false` is a screen reached COLD
 *  (a deep link, a web reload), with nothing under it to go back to. */
let canGoBack = true

export function resetRouterStub(): void {
  calls = []
  searchParams = {}
  pathname = '/'
  canGoBack = true
}

export function setTestCanGoBack(next: boolean): void {
  canGoBack = next
}

export function setTestSearchParams(next: Record<string, string | string[] | undefined>): void {
  searchParams = next
}

export function setTestPathname(next: string): void {
  pathname = next
}

export function routerCalls(): readonly RouterCall[] {
  return calls
}

const record =
  (kind: RouterCall['kind']) =>
  (target?: unknown): void => {
    calls = [...calls, { kind, target }]
  }

const routerStub = {
  push: record('push'),
  replace: record('replace'),
  navigate: record('navigate'),
  back: record('back'),
  dismissTo: record('dismissTo'),
  setParams: record('setParams'),
  canGoBack: (): boolean => canGoBack,
}

export type RouterStub = typeof routerStub

export function useRouter(): RouterStub {
  return routerStub
}

export const router = routerStub

export function useLocalSearchParams<T>(): T {
  return searchParams as unknown as T
}

export const useGlobalSearchParams = useLocalSearchParams
export const useSearchParams = useLocalSearchParams

export function usePathname(): string {
  return pathname
}

export function useSegments(): readonly string[] {
  return pathname.split('/').filter(Boolean)
}

interface NavigationStub {
  readonly setOptions: () => void
  readonly addListener: () => () => void
  /** Recorded like a router call — a back guard lets a removal through with it. */
  readonly dispatch: (action?: unknown) => void
}

export function useNavigation(): NavigationStub {
  return { setOptions: () => undefined, addListener: () => () => undefined, dispatch: record('dispatch') }
}

/**
 * Runs on mount like a freshly focused screen, and AGAIN on every
 * `emitFocus()` — the harness's stand-in for popping a route off a screen that
 * `freezeOnBlur: false` left mounted underneath. See `../focus-control.ts`.
 */
export function useFocusEffect(effect: () => void | (() => void)): void {
  const generation = useTestFocusGeneration()
  React.useEffect(effect, [effect, generation])
}

export function useIsFocused(): boolean {
  return useTestIsFocused()
}

export const Redirect = (): null => null

const Passthrough = ({ children }: ViewProps): React.ReactElement => <View>{children}</View>

export const Slot = Passthrough
export const Link = Passthrough

interface NavigatorShell {
  (props: ViewProps): React.ReactElement
  Screen: () => null
}

function ScreenShell(): null {
  return null
}

function navigatorShell(): NavigatorShell {
  const shell = (props: ViewProps): React.ReactElement => Passthrough(props)
  shell.Screen = ScreenShell
  return shell
}

export const Stack = navigatorShell()
export const Tabs = navigatorShell()
export const SplashScreen = { preventAutoHideAsync: (): Promise<void> => Promise.resolve(), hideAsync: (): Promise<void> => Promise.resolve() }
