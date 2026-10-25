/**
 * Drop-in replacement for `src/connection/ConnectionProvider.tsx` under test.
 *
 * A mount test must not open a WebSocket, and `ConnectionProvider` constructs
 * its own `SystemController` (no seam to inject one), so the module itself is
 * what gets replaced:
 *
 * ```ts
 * vi.mock('../../connection/ConnectionProvider.js', async () =>
 *   (await import('../../testing/connection-stub.js')).connectionStubModule())
 * ```
 *
 * The stub reports `connected` — the state every `useQuery` in `src/data`
 * gates on — so the real hooks really run, against `hub-stub.ts`.
 */
import React from 'react'
import { createTrpcClientStub } from './hub-stub.js'
import { describeRoute, type RouteDescription } from '../connection/route-channel.js'
import type { PinRouteOutcome } from '../connection/system-controller.js'

const trpcClient = createTrpcClientStub()

const fakeSystem = {
  serverUrl: 'http://hub.test:8080',
  trpcClient,
  token: 'test-token',
  setToken: (): void => undefined,
  isConnected: (): boolean => true,
  isReady: (): boolean => true,
  awaitReady: (): Promise<void> => Promise.resolve(),
  connectionVersion: 1,
  awaitConnected: (): Promise<void> => Promise.resolve(),
  switchServerUrl: (): void => undefined,
  subscribeConnectionEvents: (): (() => void) => () => undefined,
  /**
   * Live hub events. Nothing is ever delivered — a mount test asserts the
   * FIRST render — but every subscriber must get its unsubscribe back, or the
   * effect cleanup throws on unmount.
   */
  subscribeEvent: (): (() => void) => () => undefined,
  close: (): void => undefined,
}

/**
 * What the stub reports, switchable per test (reset with
 * {@link resetStubConnection}). The default is the state every existing spec
 * assumes: connected, with a system. Flip it to prove a screen tells "not
 * connected" apart from "the hub answered nothing" (D315).
 */
interface StubConnection {
  state: string
  hasSystem: boolean
}
const stubConnection: StubConnection = { state: 'connected', hasSystem: true }

export function setStubConnection(next: Partial<StubConnection>): void {
  Object.assign(stubConnection, next)
}

export function resetStubConnection(): void {
  stubConnection.state = 'connected'
  stubConnection.hasSystem = true
}

const fakeController = {
  /** The CONFIGURED url, not the live route — `use-cameras` keys its
   *  cold-start cache on it and would skip hydration on an empty string. */
  configuredServerUrl: 'http://hub.test:8080',
  getSystem: () => (stubConnection.hasSystem ? fakeSystem : null),
  /** The route in use. `initial` and the configured host, because this fake has
   *  never raced anything — a stub that reported `race-won` would vouch for a
   *  decision nothing made. */
  getRoute: (): RouteDescription =>
    describeRoute('http://hub.test:8080', [], 'initial'),
  getPinnedRouteUrl: (): string | null => null,
  setPinnedRouteUrl: (): Promise<PinRouteOutcome> => Promise.resolve({ kind: 'applied' }),
  reprobe: (): Promise<void> => Promise.resolve(),
  retryNow: (): void => undefined,
  connect: (): Promise<void> => Promise.resolve(),
  dispose: (): void => undefined,
  subscribe: (): (() => void) => () => undefined,
  currentState: 'connected',
}

/**
 * The module object handed to `vi.mock`. Typed as the loose record vitest
 * expects; the real module's types are irrelevant at runtime and asserting
 * them here would require faking the whole `SystemController` surface.
 */
export function connectionStubModule(): Record<string, unknown> {
  return {
    ConnectionProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useConnection: () => ({
      controller: fakeController,
      state: stubConnection.state,
      startingUp: false,
    }),
  }
}

/** The fake `System` the stubbed `useConnection` hands out, for assertions. */
export function stubSystem(): typeof fakeSystem {
  return fakeSystem
}
