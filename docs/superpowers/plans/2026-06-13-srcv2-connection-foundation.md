# srcV2 Scaffold + Connection Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `srcV2/` namespace (camstack-only) with a test harness, the camstack Warm Amber/Stone theme tokens, and a connection foundation built on `@camstack/sdk`'s `System` — continuous LAN→remote endpoint racing, reconnect-aware re-race policy, scoped-JWT data-plane failover, and persisted server config.

**Architecture:** Pure-TS, dependency-injected modules under `srcV2/connection/` (unit-tested with vitest in node) compose the SDK's `createSystem` + `raceFastestEndpoint` + `switchServerUrl`. A thin RN layer (`ConnectionProvider` + `ConnectionBanner`) exposes connection state to the UI. No WebView; no other providers.

**Tech Stack:** TypeScript 5.9, `@camstack/sdk` (`System`, `createSystem`, `raceFastestEndpoint`, `BackendConnectionState`), vitest, Expo/React Native, `@react-native-async-storage/async-storage` (already transitively available; injected via an interface in tests).

---

## File Structure

- `srcV2/theme/tokens.ts` — camstack dark+light color/radius/spacing tokens (vendored from `@camstack/ui-library` `./theme`). One responsibility: design tokens.
- `srcV2/connection/manifest-endpoints.ts` — ordered, deduped playback endpoint list from a manifest.
- `srcV2/connection/data-plane-failover.ts` — `fetchWithFailover()` over an ordered endpoint list (LAN→relay), injected `fetch`.
- `srcV2/connection/recheck-policy.ts` — pure decision: when to re-race endpoints on a connection-state change.
- `srcV2/connection/server-store.ts` — persist/load server config + token over an injected KV interface.
- `srcV2/connection/system-controller.ts` — composes `createSystem` + racing + recheck policy; owns the live transport pivot.
- `srcV2/connection/ConnectionProvider.tsx` — React context exposing `{ system, state }` (RN).
- `srcV2/components/ConnectionBanner.tsx` — camstack-styled connection-state banner (RN).
- `vitest.config.ts`, `srcV2/**/__tests__/*.spec.ts` — test harness + specs.

---

### Task 1: Test harness + srcV2 scaffold + SDK bump

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDep `vitest`, script `test:v2`, bump `@camstack/sdk`)
- Modify: `tsconfig.json:8-13` (add `@v2/*` path)
- Create: `srcV2/connection/__tests__/smoke.spec.ts`

- [ ] **Step 1: Add the path alias** — in `tsconfig.json` `paths`, add after the `@/*` line:

```json
      "@v2/*": ["./srcV2/*"],
```

- [ ] **Step 2: Add vitest config** — create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['srcV2/**/__tests__/**/*.spec.ts'],
  },
})
```

- [ ] **Step 3: package.json** — add `"vitest": "^3.2.0"` to `devDependencies`, add `"test:v2": "vitest run"` to `scripts`, and bump `"@camstack/sdk"` from `0.1.22` to `"^0.1.54"` (the version that ships `raceFastestEndpoint` + `switchServerUrl`). Then:

```bash
npm install
```

- [ ] **Step 4: Write a smoke test** — create `srcV2/connection/__tests__/smoke.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('srcV2 test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run it**

Run: `npm run test:v2`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json tsconfig.json srcV2/connection/__tests__/smoke.spec.ts
git commit -m "chore(srcV2): scaffold namespace, vitest harness, bump @camstack/sdk"
```

---

### Task 2: camstack theme tokens (dark + light)

**Files:**
- Create: `srcV2/theme/tokens.ts`
- Test: `srcV2/theme/__tests__/tokens.spec.ts`

- [ ] **Step 1: Write the failing test** — create `srcV2/theme/__tests__/tokens.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { THEME, type ThemeMode, type ColorTokens } from '../tokens.js'

describe('camstack theme tokens', () => {
  it('exposes dark and light modes with the camstack Warm Amber/Stone palette', () => {
    expect(THEME.dark.background).toBe('#0c0a09')
    expect(THEME.dark.primary).toBe('#f59e42')
    expect(THEME.light.background).toBe('#fafaf9')
    expect(THEME.light.primary).toBe('#e67e22')
  })

  it('defines the same token keys in both modes (parity)', () => {
    const darkKeys = Object.keys(THEME.dark).sort()
    const lightKeys = Object.keys(THEME.light).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  it('exposes semantic activity-band colors used by the timeline', () => {
    expect(THEME.dark.danger).toBe('#f87171') // recording band
    expect(THEME.dark.info).toBe('#60a5fa')   // motion band
    expect(THEME.dark.success).toBe('#4ade80') // audio gradient low
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- srcV2/theme`
Expected: FAIL — cannot find module `../tokens.js`.

- [ ] **Step 3: Write minimal implementation** — create `srcV2/theme/tokens.ts`:

```typescript
export type ThemeMode = 'dark' | 'light'

export interface ColorTokens {
  primary: string
  primaryForeground: string
  background: string
  backgroundElevated: string
  surface: string
  surfaceHover: string
  border: string
  borderSubtle: string
  foreground: string
  foregroundMuted: string
  foregroundSubtle: string
  foregroundDisabled: string
  success: string
  warning: string
  danger: string
  info: string
}

const dark: ColorTokens = {
  primary: '#f59e42',
  primaryForeground: '#0c0a09',
  background: '#0c0a09',
  backgroundElevated: '#1c1917',
  surface: '#1c1917',
  surfaceHover: '#292524',
  border: '#292524',
  borderSubtle: '#1c1917',
  foreground: '#fafaf9',
  foregroundMuted: '#a8a29e',
  foregroundSubtle: '#78716c',
  foregroundDisabled: '#57534e',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  info: '#60a5fa',
}

const light: ColorTokens = {
  primary: '#e67e22',
  primaryForeground: '#ffffff',
  background: '#fafaf9',
  backgroundElevated: '#ffffff',
  surface: '#f5f5f4',
  surfaceHover: '#e7e5e4',
  border: '#d6d3d1',
  borderSubtle: '#e7e5e4',
  foreground: '#1c1917',
  foregroundMuted: '#57534e',
  foregroundSubtle: '#78716c',
  foregroundDisabled: '#a8a29e',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#2563eb',
}

export const RADIUS = { sm: 4, md: 6, lg: 8, xl: 12 } as const
export const SPACING = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, '2xl': 24, '3xl': 32 } as const

/** Activity-band colors (semantic). Audio renders as a gradient low→mid→high. */
export const BAND = {
  recording: dark.danger,
  motion: dark.info,
  audioGradient: [dark.success, dark.warning, dark.danger] as const,
  cursor: dark.primary, // amber scrub cursor
} as const

export const THEME: Record<ThemeMode, ColorTokens> = { dark, light }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- srcV2/theme`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/theme/tokens.ts srcV2/theme/__tests__/tokens.spec.ts
git commit -m "feat(srcV2): camstack Warm Amber/Stone theme tokens (dark+light)"
```

---

### Task 3: Ordered playback endpoints from a manifest

**Files:**
- Create: `srcV2/connection/manifest-endpoints.ts`
- Test: `srcV2/connection/__tests__/manifest-endpoints.spec.ts`

- [ ] **Step 1: Write the failing test**:

```typescript
import { describe, it, expect } from 'vitest'
import { orderedPlaybackEndpoints, type PlaybackManifestLike } from '../manifest-endpoints.js'

describe('orderedPlaybackEndpoints', () => {
  it('puts playbackUrl first, then the rest, deduped, nulls dropped', () => {
    const m: PlaybackManifestLike = {
      playbackUrl: 'https://lan/master.m3u8?t=tok',
      playbackEndpoints: ['https://lan/master.m3u8?t=tok', 'https://relay/master.m3u8?t=tok'],
    }
    expect(orderedPlaybackEndpoints(m)).toEqual([
      'https://lan/master.m3u8?t=tok',
      'https://relay/master.m3u8?t=tok',
    ])
  })

  it('returns [] when there is no footage', () => {
    expect(orderedPlaybackEndpoints({ playbackUrl: null, playbackEndpoints: [] })).toEqual([])
  })

  it('falls back to playbackEndpoints when playbackUrl is null', () => {
    expect(
      orderedPlaybackEndpoints({ playbackUrl: null, playbackEndpoints: ['https://relay/m.m3u8'] }),
    ).toEqual(['https://relay/m.m3u8'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- manifest-endpoints`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation** — create `srcV2/connection/manifest-endpoints.ts`:

```typescript
/** The fields of `recording.getPlaybackManifest` output this module needs.
 *  `playbackEndpoints` is LAN-first, then relay; `playbackUrl` is its [0]. */
export interface PlaybackManifestLike {
  readonly playbackUrl: string | null
  readonly playbackEndpoints: readonly string[]
}

/** Ordered, deduped candidate master-playlist URLs to try in sequence
 *  (LAN first, then relay). Each carries the scoped JWT in its path. */
export function orderedPlaybackEndpoints(manifest: PlaybackManifestLike): string[] {
  const all = [manifest.playbackUrl, ...manifest.playbackEndpoints]
  const out: string[] = []
  for (const url of all) {
    if (url && !out.includes(url)) out.push(url)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- manifest-endpoints`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/connection/manifest-endpoints.ts srcV2/connection/__tests__/manifest-endpoints.spec.ts
git commit -m "feat(srcV2): ordered playback endpoint resolution from manifest"
```

---

### Task 4: Data-plane fetch with LAN→relay failover

**Files:**
- Create: `srcV2/connection/data-plane-failover.ts`
- Test: `srcV2/connection/__tests__/data-plane-failover.spec.ts`

- [ ] **Step 1: Write the failing test**:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { fetchWithFailover, AllEndpointsFailedError } from '../data-plane-failover.js'

function res(status: number): Response {
  return new Response(status === 200 ? 'ok' : '', { status })
}

describe('fetchWithFailover', () => {
  it('returns the first endpoint that responds 2xx', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('lan') ? res(200) : res(500),
    )
    const r = await fetchWithFailover(['https://lan/a', 'https://relay/a'], { fetchImpl })
    expect(r.url).toBe('https://lan/a')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls through 401/timeout/5xx to the next endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('relay') ? res(200) : res(401)))
    const r = await fetchWithFailover(['https://lan/a', 'https://relay/a'], { fetchImpl })
    expect(r.url).toBe('https://relay/a')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws AllEndpointsFailedError when every endpoint fails', async () => {
    const fetchImpl = vi.fn(async () => res(503))
    await expect(
      fetchWithFailover(['https://lan/a', 'https://relay/a'], { fetchImpl }),
    ).rejects.toBeInstanceOf(AllEndpointsFailedError)
  })

  it('treats a thrown fetch (network error) as failover', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('lan')) throw new Error('ECONNREFUSED')
      return res(200)
    })
    const r = await fetchWithFailover(['https://lan/a', 'https://relay/a'], { fetchImpl })
    expect(r.url).toBe('https://relay/a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- data-plane-failover`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation** — create `srcV2/connection/data-plane-failover.ts`:

```typescript
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

export interface FailoverOptions {
  readonly fetchImpl?: FetchImpl
  readonly init?: RequestInit
}

export interface FailoverResult {
  readonly url: string
  readonly response: Response
}

/** Thrown when no candidate endpoint produced a 2xx response. */
export class AllEndpointsFailedError extends Error {
  constructor(public readonly attempts: number) {
    super(`All ${attempts} data-plane endpoints failed`)
    this.name = 'AllEndpointsFailedError'
  }
}

/** Try each endpoint in order (LAN→relay); first 2xx wins. A non-2xx status
 *  OR a thrown fetch (network error / timeout) falls through to the next.
 *  Endpoints already carry the scoped JWT in their path — no extra auth header. */
export async function fetchWithFailover(
  endpoints: readonly string[],
  options: FailoverOptions = {},
): Promise<FailoverResult> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchImpl)
  for (const url of endpoints) {
    try {
      const response = await fetchImpl(url, options.init)
      if (response.ok) return { url, response }
    } catch {
      // network error — try the next endpoint
    }
  }
  throw new AllEndpointsFailedError(endpoints.length)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- data-plane-failover`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/connection/data-plane-failover.ts srcV2/connection/__tests__/data-plane-failover.spec.ts
git commit -m "feat(srcV2): data-plane fetch with LAN→relay failover"
```

---

### Task 5: Re-race policy on connection-state changes

**Files:**
- Create: `srcV2/connection/recheck-policy.ts`
- Test: `srcV2/connection/__tests__/recheck-policy.spec.ts`

- [ ] **Step 1: Write the failing test**:

```typescript
import { describe, it, expect } from 'vitest'
import { shouldRerace } from '../recheck-policy.js'

describe('shouldRerace', () => {
  it('re-races when transitioning into a connected state (recovery)', () => {
    expect(shouldRerace('reconnecting', 'connected')).toBe(true)
    expect(shouldRerace('disconnected', 'connected')).toBe(true)
  })

  it('does NOT re-race while staying connected', () => {
    expect(shouldRerace('connected', 'connected')).toBe(false)
  })

  it('does NOT re-race on going offline (nothing to race)', () => {
    expect(shouldRerace('connected', 'disconnected')).toBe(false)
    expect(shouldRerace('connected', 'reconnecting')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- recheck-policy`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation** — create `srcV2/connection/recheck-policy.ts`:

```typescript
/** The connection states we react to. Mirrors `@camstack/sdk`'s
 *  `BackendConnectionState` string union (kept structural so this module
 *  has no SDK import). */
export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/** Re-evaluate the fastest endpoint (LAN vs remote) only when we have just
 *  (re)gained a connection — that is the moment the best route may have
 *  changed (network switch, VPN up, came back on LAN). Never while offline. */
export function shouldRerace(prev: ConnState, next: ConnState): boolean {
  return next === 'connected' && prev !== 'connected'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- recheck-policy`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/connection/recheck-policy.ts srcV2/connection/__tests__/recheck-policy.spec.ts
git commit -m "feat(srcV2): endpoint re-race policy on connection recovery"
```

---

### Task 6: Server config + token persistence

**Files:**
- Create: `srcV2/connection/server-store.ts`
- Test: `srcV2/connection/__tests__/server-store.spec.ts`

- [ ] **Step 1: Write the failing test**:

```typescript
import { describe, it, expect } from 'vitest'
import { ServerStore, type KvStore, type ServerConfig } from '../server-store.js'

function memoryKv(): KvStore {
  const m = new Map<string, string>()
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  }
}

const SERVER: ServerConfig = { id: 's1', label: 'Home', serverUrl: 'https://hub.local:4443' }

describe('ServerStore', () => {
  it('round-trips servers + active id + token', async () => {
    const store = new ServerStore(memoryKv())
    await store.upsertServer(SERVER)
    await store.setActive('s1')
    await store.setToken('jwt-abc')

    const reloaded = new ServerStore(memoryKv())
    // a fresh store over the SAME kv would see it; here assert the same instance reads back
    expect(await store.getServers()).toEqual([SERVER])
    expect(await store.getActiveServer()).toEqual(SERVER)
    expect(await store.getToken()).toBe('jwt-abc')
    expect(reloaded).toBeInstanceOf(ServerStore)
  })

  it('returns null active server when none set', async () => {
    const store = new ServerStore(memoryKv())
    expect(await store.getActiveServer()).toBeNull()
  })

  it('clears the token on signOut but keeps servers', async () => {
    const store = new ServerStore(memoryKv())
    await store.upsertServer(SERVER)
    await store.setToken('jwt-abc')
    await store.signOut()
    expect(await store.getToken()).toBeNull()
    expect(await store.getServers()).toEqual([SERVER])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- server-store`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation** — create `srcV2/connection/server-store.ts`:

```typescript
/** Minimal KV surface — satisfied by `@react-native-async-storage/async-storage`
 *  in the app and by an in-memory mock in tests. */
export interface KvStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface ServerConfig {
  readonly id: string
  readonly label: string
  readonly serverUrl: string
}

const K_SERVERS = 'v2.servers'
const K_ACTIVE = 'v2.activeServerId'
const K_TOKEN = 'v2.token'

/** Persists the list of known camstack servers, which one is active, and the
 *  current auth token. All reads/writes go through the injected `KvStore`. */
export class ServerStore {
  constructor(private readonly kv: KvStore) {}

  async getServers(): Promise<ServerConfig[]> {
    const raw = await this.kv.getItem(K_SERVERS)
    return raw ? (JSON.parse(raw) as ServerConfig[]) : []
  }

  async upsertServer(server: ServerConfig): Promise<void> {
    const servers = await this.getServers()
    const next = servers.filter((s) => s.id !== server.id)
    next.push(server)
    await this.kv.setItem(K_SERVERS, JSON.stringify(next))
  }

  async setActive(id: string): Promise<void> {
    await this.kv.setItem(K_ACTIVE, id)
  }

  async getActiveServer(): Promise<ServerConfig | null> {
    const id = await this.kv.getItem(K_ACTIVE)
    if (!id) return null
    const servers = await this.getServers()
    return servers.find((s) => s.id === id) ?? null
  }

  async setToken(token: string): Promise<void> {
    await this.kv.setItem(K_TOKEN, token)
  }

  async getToken(): Promise<string | null> {
    return this.kv.getItem(K_TOKEN)
  }

  async signOut(): Promise<void> {
    await this.kv.removeItem(K_TOKEN)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- server-store`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/connection/server-store.ts srcV2/connection/__tests__/server-store.spec.ts
git commit -m "feat(srcV2): persisted server config + token store"
```

---

### Task 7: SystemController — compose SDK + racing + recheck

**Files:**
- Create: `srcV2/connection/system-controller.ts`
- Test: `srcV2/connection/__tests__/system-controller.spec.ts`

- [ ] **Step 1: Write the failing test** — mock the SDK so the controller is tested in isolation:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted above module-scope consts, so the spies must be created
// inside vi.hoisted() to be initialised before the mock factory runs.
const { switchServerUrl, createSystem, raceFastestEndpoint } = vi.hoisted(() => {
  const switchServerUrl = vi.fn()
  return {
    switchServerUrl,
    createSystem: vi.fn(() => ({ switchServerUrl, dispose: vi.fn() })),
    raceFastestEndpoint: vi.fn(async () => 'https://lan:4443'),
  }
})

vi.mock('@camstack/sdk', () => ({ createSystem, raceFastestEndpoint }))

import { SystemController } from '../system-controller.js'

beforeEach(() => {
  switchServerUrl.mockClear()
  createSystem.mockClear()
  raceFastestEndpoint.mockClear()
})

describe('SystemController', () => {
  it('creates a System for the active server and races candidates on connect', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['https://lan:4443', 'https://public:4443'],
    })
    await ctrl.connect()
    expect(createSystem).toHaveBeenCalledTimes(1)
    expect(raceFastestEndpoint).toHaveBeenCalledWith(
      ['https://lan:4443', 'https://public:4443'],
      expect.any(Number),
    )
    // pivots the transport onto the race winner
    expect(switchServerUrl).toHaveBeenCalledWith('https://lan:4443')
  })

  it('re-races when the connection recovers (reconnecting → connected)', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['https://lan:4443', 'https://public:4443'],
    })
    await ctrl.connect()
    raceFastestEndpoint.mockClear()
    switchServerUrl.mockClear()

    await ctrl.handleStateChange('reconnecting')
    await ctrl.handleStateChange('connected')

    expect(raceFastestEndpoint).toHaveBeenCalledTimes(1)
    expect(switchServerUrl).toHaveBeenCalledWith('https://lan:4443')
  })

  it('does not re-race while merely staying connected', async () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      token: 'jwt',
      candidates: ['https://lan:4443'],
    })
    await ctrl.connect()
    raceFastestEndpoint.mockClear()
    await ctrl.handleStateChange('connected')
    expect(raceFastestEndpoint).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- system-controller`
Expected: FAIL — cannot find module `../system-controller.js`.

- [ ] **Step 3: Write minimal implementation** — create `srcV2/connection/system-controller.ts`:

```typescript
import { createSystem, raceFastestEndpoint } from '@camstack/sdk'
import { shouldRerace, type ConnState } from './recheck-policy.js'

const RACE_TIMEOUT_MS = 1500

export interface SystemControllerConfig {
  readonly serverUrl: string
  readonly token?: string
  /** LAN-first candidate base URLs to race for the fastest control-plane route. */
  readonly candidates: readonly string[]
}

interface SystemLike {
  switchServerUrl(url: string): void
  dispose?(): void
}

/** Owns the live `System` transport: creates it for the active server, then
 *  continuously evaluates the fastest route (LAN vs remote) and pivots the
 *  transport onto the winner — on connect and on every connection recovery. */
export class SystemController {
  private system: SystemLike | null = null
  private prevState: ConnState = 'connecting'

  constructor(private readonly config: SystemControllerConfig) {}

  async connect(): Promise<void> {
    this.system = createSystem({
      serverUrl: this.config.serverUrl,
      token: this.config.token,
      onConnectionChange: (state) => void this.handleStateChange(state as ConnState),
    }) as SystemLike
    await this.race()
    // The connect-time race already picked the best route; baseline the state
    // to 'connected' so the SDK's immediate 'connected' event does not double-race.
    this.prevState = 'connected'
  }

  /** React to an SDK connection-state change; re-race on recovery. */
  async handleStateChange(next: ConnState): Promise<void> {
    const prev = this.prevState
    this.prevState = next
    if (shouldRerace(prev, next)) await this.race()
  }

  private async race(): Promise<void> {
    if (!this.system || this.config.candidates.length === 0) return
    const winner = await raceFastestEndpoint([...this.config.candidates], RACE_TIMEOUT_MS)
    if (winner) this.system.switchServerUrl(winner)
  }

  getSystem(): SystemLike | null {
    return this.system
  }

  dispose(): void {
    this.system?.dispose?.()
    this.system = null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- system-controller`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/connection/system-controller.ts srcV2/connection/__tests__/system-controller.spec.ts
git commit -m "feat(srcV2): SystemController composes SDK + endpoint racing + recheck"
```

---

### Task 8: ConnectionProvider + ConnectionBanner (RN wiring)

**Files:**
- Create: `srcV2/connection/ConnectionProvider.tsx`
- Create: `srcV2/components/ConnectionBanner.tsx`

> These are the RN glue; they are validated by type-check + the existing CI `ts-check`, not vitest (no RN test env in this sub-project). Keep them thin — all logic lives in the tested modules above.

- [ ] **Step 1: ConnectionProvider** — create `srcV2/connection/ConnectionProvider.tsx`:

```tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { SystemController, type SystemControllerConfig } from './system-controller.js'
import type { ConnState } from './recheck-policy.js'

interface ConnectionContextValue {
  controller: SystemController
  state: ConnState
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function ConnectionProvider({
  config,
  children,
}: {
  config: SystemControllerConfig
  children: React.ReactNode
}) {
  const controller = useMemo(() => new SystemController(config), [config])
  const [state, setState] = useState<ConnState>('connecting')

  useEffect(() => {
    const original = controller.handleStateChange.bind(controller)
    controller.handleStateChange = async (next: ConnState) => {
      setState(next)
      await original(next)
    }
    void controller.connect()
    return () => controller.dispose()
  }, [controller])

  const value = useMemo(() => ({ controller, state }), [controller, state])
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext)
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider')
  return ctx
}
```

- [ ] **Step 2: ConnectionBanner** — create `srcV2/components/ConnectionBanner.tsx`:

```tsx
import React from 'react'
import { View, Text } from 'react-native'
import { useConnection } from '../connection/ConnectionProvider.js'
import { THEME, SPACING, RADIUS } from '../theme/tokens.js'
import type { ConnState } from '../connection/recheck-policy.js'

const LABEL: Record<ConnState, string> = {
  connecting: 'Connessione…',
  connected: 'Online',
  reconnecting: 'Riconnessione…',
  disconnected: 'Offline',
}

const COLOR: Record<ConnState, string> = {
  connecting: THEME.dark.warning,
  connected: THEME.dark.success,
  reconnecting: THEME.dark.warning,
  disconnected: THEME.dark.danger,
}

/** Thin status banner; hidden when fully connected. */
export function ConnectionBanner() {
  const { state } = useConnection()
  if (state === 'connected') return null
  return (
    <View
      style={{
        backgroundColor: THEME.dark.surface,
        borderColor: COLOR[state],
        borderWidth: 1,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.sm,
        paddingHorizontal: SPACING.md,
        margin: SPACING.sm,
      }}
    >
      <Text style={{ color: COLOR[state], fontSize: 12 }}>{LABEL[state]}</Text>
    </View>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npm run ts-check`
Expected: no new errors in `srcV2/`.

- [ ] **Step 4: Commit**

```bash
git add srcV2/connection/ConnectionProvider.tsx srcV2/components/ConnectionBanner.tsx
git commit -m "feat(srcV2): ConnectionProvider context + camstack-styled ConnectionBanner"
```

---

## Self-Review

**Spec coverage (sub-project 1, connection half):**
- D8 connection on `@camstack/sdk` `System` → Task 7 (`createSystem`). ✓
- §3 continuous LAN→remote evaluation (`raceFastestEndpoint` + `switchServerUrl`) → Task 7 (`race()` on connect + recovery). ✓
- §3 reconnect/backoff → delegated to the SDK (`createSystem` keepalive/backoff); re-race policy → Task 5. ✓
- §3 connection state in UI → Task 8 (`ConnectionProvider` + `ConnectionBanner`). ✓
- §3.1 data-plane endpoint failover (LAN→relay), token-in-path → Task 3 (ordering) + Task 4 (`fetchWithFailover`). ✓
- §3 onboarding: persisted server URL(s) + token → Task 6 (`ServerStore`). ✓
- §5.3 camstack tokens (dark+light) → Task 2. ✓
- Scaffold + camstack-only namespace → Task 1. ✓

**Out of this plan (correctly deferred):** ScrubEngine, live/VOD wiring, activity bands, camera·timeline UI → Plan C (gated by the iOS spike `2026-06-13-srcv2-ios-scrub-spike.md` + the motion/audio density contract confirmation). The `react-native-video` VOD player and PTZ/quality controls also land in Plan C.

**Placeholder scan:** every code step shows full code; every run step states the command + expected result. No TODO/TBD. ✓

**Type consistency:** `ConnState` defined in Task 5 and reused in Tasks 7/8; `SystemControllerConfig` defined in Task 7 and consumed in Task 8; `ServerConfig`/`KvStore` defined in Task 6; `PlaybackManifestLike` in Task 3; `FetchImpl`/`FailoverResult` in Task 4. `raceFastestEndpoint(urls, timeoutMs)` + `createSystem(config)` match the SDK surface. ✓

---

## Post-implementation amendments (final review, 2026-06-13)

The code+tests are the source of truth; these review-driven corrections were applied on top of the task text above (commit `46e4a11`):

1. **SDK teardown uses `close()`, not `dispose()`** — the `@camstack/sdk` `System` exposes `close(): void`. `SystemLike` now declares `close?(): void` and `SystemController.dispose()` calls `this.system?.close?.()` (the previous `dispose?()` was a silent no-op → WebSocket leak). The test mock returns `{ switchServerUrl, close }`.
2. **`ConnState` matches the SDK union exactly** — `'connecting' | 'connected' | 'disconnected'` (there is NO `'reconnecting'`; a reconnect surfaces as connected→disconnected→connecting→connected). The recheck-policy + system-controller tests and the banner's `LABEL`/`COLOR` maps use the 3-value union.
3. **No connect-time double-race** — `connect()` sets `prevState = 'connected'` BEFORE the connect-time `race()`, so the SDK's immediate `'connected'` event doesn't trigger a second concurrent race.
4. **`race()` re-checks `this.system` after the await** — `if (winner && this.system)` guards a null deref if `dispose()` runs during the race.
5. **`onStateChange` is part of the `SystemController` contract** — `ConnectionProvider` sets `controller.onStateChange = setState` (replacing the fragile monkeypatch of `handleStateChange`) and `.catch()`es a failed initial `connect()` to surface as `'disconnected'`.
6. **`ServerStore.upsertServer` is immutable**; the round-trip test now verifies real cross-instance persistence over the same KV; the scaffolding `smoke.spec.ts` was deleted.

**Tracked follow-up (not in this plan):** `BAND` tokens and `ConnectionBanner` hardcode the dark palette — light-mode theming lands with the srcV2 `ThemeProvider`/`useColorScheme` plumbing (a later UI task / Plan C). Final suite: **20 tests across 6 files, all green**; `ts-check` clean for `srcV2/`.
