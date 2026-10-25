# Web Viewer — Viewer (srcV2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Web/PWA build of `@camstack/viewer` stream by rendering the stream-broker embed in a browser `<iframe>` (single-camera live + grid + intercom), and give the web app a desktop shell (persistent sidebar + fullscreen).

**Architecture:** A web-only iframe bridge (`use-embed-iframe.ts`) loads the same `/addon/stream-broker/embed/?mode=player|grid` URL the iOS WebView loads, runs the `embed-ready`→`embed-config` handshake, sends `embed-command` messages, and receives host events via `postMessage`. `.web.tsx` variants of `LiveView` and `GridLiveEmbed` use it; `use-intercom.web.ts` delegates talk-back to the player iframe via a per-device channel. A responsive change makes the existing sidebar persistent on wide web, plus a Fullscreen API hook.

**Tech Stack:** Expo ~54, React Native 0.81 / react-native-web, React 19, TypeScript 5.9, Vitest (node; jsdom per-file for DOM specs). Repo: `camstack-viewer`, dir `srcV2/`.

**Companion spec:** `docs/superpowers/specs/2026-06-15-srcv2-web-viewer-completion-design.md`
**Depends on:** `camstack-server/docs/superpowers/plans/2026-06-15-web-viewer-server-embed.md` MUST be implemented and deployed to the hub for end-to-end web streaming. The unit tasks here do not require it; the final verification (Task 8) does.
**Branch:** `feat/srcv2-web-viewer` (already created; the spec is committed there).

---

## Conventions for this plan

- Paths relative to `camstack-viewer/` unless absolute. Tests: `npm run test:v2` (vitest, env `node`).
- Single file: `npx vitest run srcV2/<path>.spec.ts`.
- DOM specs (postMessage/iframe) need jsdom — add `// @vitest-environment jsdom` as the FIRST line of the spec file.
- **Viewer files may use `eslint-disable react-hooks/*`** (only `ui-library`/`embed` files forbid it).
- **NEVER `git add -A`** — stage explicit paths (`node_modules/.expo` symlinks corrupt merges).
- Metro auto-selects `.web.tsx`/`.web.ts` over the base on web; the base file stays the native impl.

## File structure (what each unit owns)

- Modify `srcV2/grid-embed/embed-messages.ts` — split a `coerceGridHostMessage(data)` out of `parseGridHostMessage` so the web bridge can parse a postMessage OBJECT (not a JSON string).
- Create `srcV2/live/embed-player-config.ts` — shared single-camera `EmbedConfig` type + `buildPlayerEmbedConfig` (extracted from `LiveViewWebView.tsx`).
- Create `srcV2/live/embed-player-messages.ts` — `PlayerCommand` union, `MicState`, `coercePlayerHostMessage(data)`.
- Create `srcV2/live/embed-channel.ts` — per-device command channel registry (single-cam intercom glue). Pure.
- Create `srcV2/live/use-embed-iframe.ts` — web-only iframe handshake/command hook (DOM).
- Create `srcV2/live/LiveView.web.tsx` — real iframe player (replaces the placeholder).
- Create `srcV2/grid-embed/GridLiveEmbed.web.tsx` — iframe grid (same props as native).
- Rewrite `srcV2/live/use-intercom.web.ts` — delegate to the player channel.
- Modify `srcV2/hooks/use-responsive.ts` + `srcV2/navigation/TabsNavigator.tsx` — persistent sidebar on wide web.
- Create `srcV2/hooks/use-web-fullscreen.ts` — Fullscreen API hook (web-only DOM).

---

## Task 1: `coerceGridHostMessage` — parse a postMessage object

**Files:**
- Modify: `srcV2/grid-embed/embed-messages.ts`
- Test: `srcV2/grid-embed/__tests__/embed-messages.spec.ts`

The native path receives a JSON STRING (`WebView.onMessage`); the web path receives an OBJECT (`postMessage`). Refactor so both share one validator.

- [ ] **Step 1: Write the failing test (append to the existing spec)**

Append to `srcV2/grid-embed/__tests__/embed-messages.spec.ts`:

```typescript
import { coerceGridHostMessage } from '../embed-messages.js'

describe('coerceGridHostMessage', () => {
  const rect = { x: 1, y: 2, w: 3, h: 4 }

  it('coerces an object (web postMessage) without JSON.parse', () => {
    expect(coerceGridHostMessage({ type: 'tileOpen', deviceId: 7 })).toEqual({ type: 'tileOpen', deviceId: 7 })
    expect(coerceGridHostMessage({ type: 'state', state: 'ready' })).toEqual({ type: 'state', state: 'ready' })
    expect(coerceGridHostMessage({ type: 'tileTap', deviceId: 7, rect })).toEqual({ type: 'tileTap', deviceId: 7, rect })
  })

  it('returns null for junk objects', () => {
    expect(coerceGridHostMessage({ type: 'nope' })).toBeNull()
    expect(coerceGridHostMessage(null)).toBeNull()
    expect(coerceGridHostMessage('a string')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/grid-embed/__tests__/embed-messages.spec.ts`
Expected: FAIL — `coerceGridHostMessage` is not exported.

- [ ] **Step 3: Refactor `parseGridHostMessage` to delegate to `coerceGridHostMessage`**

In `srcV2/grid-embed/embed-messages.ts`, replace the body of `parseGridHostMessage`
(the function starting `export function parseGridHostMessage(raw: string)`) so it
JSON-parses then delegates, and add the exported object validator. Keep ALL the
existing per-type validation logic — just move it from `parseGridHostMessage` into
`coerceGridHostMessage`:

```typescript
/** Validate an untrusted page→host message string (native WebView.onMessage). */
export function parseGridHostMessage(raw: string): GridHostMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  return coerceGridHostMessage(data)
}

/** Validate an already-parsed page→host message object (web iframe postMessage). */
export function coerceGridHostMessage(data: unknown): GridHostMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>

  switch (m.type) {
    case 'state': {
      if (typeof m.state !== 'string' || !REPORT_STATES.includes(m.state as GridReportState)) return null
      const state = m.state as GridReportState
      return typeof m.message === 'string' ? { type: 'state', state, message: m.message } : { type: 'state', state }
    }
    case 'tileTap':
    case 'tileLongPress': {
      if (typeof m.deviceId !== 'number' || !isRect(m.rect)) return null
      return { type: m.type, deviceId: m.deviceId, rect: m.rect }
    }
    case 'tileOpen': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'tileOpen', deviceId: m.deviceId }
    }
    case 'audioToggle': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'audioToggle', deviceId: m.deviceId }
    }
    case 'pauseToggle': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'pauseToggle', deviceId: m.deviceId }
    }
    case 'ptzOpen': {
      if (typeof m.deviceId !== 'number') return null
      return { type: 'ptzOpen', deviceId: m.deviceId }
    }
    case 'layout': {
      if (!Array.isArray(m.tiles)) return null
      const tiles: { deviceId: number; rect: TileRect }[] = []
      for (const t of m.tiles) {
        if (typeof t !== 'object' || t === null) return null
        const tt = t as Record<string, unknown>
        if (typeof tt.deviceId !== 'number' || !isRect(tt.rect)) return null
        tiles.push({ deviceId: tt.deviceId, rect: tt.rect })
      }
      return { type: 'layout', tiles }
    }
    default:
      return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run srcV2/grid-embed/__tests__/embed-messages.spec.ts`
Expected: PASS — both the original `parseGridHostMessage` tests and the new `coerceGridHostMessage` tests.

- [ ] **Step 5: Commit**

```bash
git add srcV2/grid-embed/embed-messages.ts srcV2/grid-embed/__tests__/embed-messages.spec.ts
git commit -m "refactor(viewer): coerceGridHostMessage for web postMessage objects"
```

---

## Task 2: Extract the single-camera embed config builder

**Files:**
- Create: `srcV2/live/embed-player-config.ts`
- Modify: `srcV2/live/LiveViewWebView.tsx` (import the extracted builder)
- Test: `srcV2/live/__tests__/embed-player-config.spec.ts`

The single-cam `EmbedConfig` type + injected payload currently live PRIVATELY in `LiveViewWebView.tsx` (lines 62-143). Extract them so the web variant reuses the exact shape.

- [ ] **Step 1: Write the failing test**

Create `srcV2/live/__tests__/embed-player-config.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildPlayerEmbedConfig } from '../embed-player-config.js'

describe('buildPlayerEmbedConfig', () => {
  it('maps a connection + target into the injected config shape', () => {
    const cfg = buildPlayerEmbedConfig({
      serverUrl: 'https://hub.local',
      token: 'jwt',
      deviceId: 7,
      target: { kind: 'adaptive' },
      muted: true,
      stats: false,
    })
    expect(cfg).toEqual({
      serverUrl: 'https://hub.local',
      token: 'jwt',
      deviceId: 7,
      target: { kind: 'adaptive' },
      muted: true,
      stats: false,
    })
  })

  it('includes snapshot/highlight only when provided', () => {
    const cfg = buildPlayerEmbedConfig({
      serverUrl: 'https://hub.local',
      token: 'jwt',
      deviceId: 7,
      target: { kind: 'adaptive' },
      muted: false,
      stats: true,
      snapshot: 'data:image/png;base64,xxx',
    })
    expect(cfg.snapshot).toBe('data:image/png;base64,xxx')
    expect('highlight' in cfg).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/live/__tests__/embed-player-config.spec.ts`
Expected: FAIL — `Cannot find module '../embed-player-config.js'`.

- [ ] **Step 3: Create the shared module**

Create `srcV2/live/embed-player-config.ts`:

```typescript
/**
 * Shared single-camera embed config — the payload the player embed reads as
 * `window.__CAMSTACK_EMBED__` (native: injected before load; web: sent via the
 * embed-config handshake). The shape MUST match the server's
 * `embedConfigSchema` (`addon-pipeline/embed/src/pages/EmbedPlayerPage.tsx`).
 * Pure — unit-tested. Used by both `LiveViewWebView.tsx` (native) and
 * `LiveView.web.tsx` (web).
 */
import type { WebrtcTarget } from './signaling-types.js'
import type { GridHighlightEmbedConfig } from '../grid-embed/embed-config.js'

export interface EmbedConfig {
  readonly serverUrl: string
  readonly token: string
  readonly deviceId: number
  readonly target: WebrtcTarget
  readonly muted: boolean
  readonly stats: boolean
  readonly highlight?: GridHighlightEmbedConfig
  /** Last-known snapshot data URL — cold-start poster only (before first frame). */
  readonly snapshot?: string
}

export interface BuildPlayerEmbedConfigInput {
  readonly serverUrl: string
  readonly token: string
  readonly deviceId: number
  readonly target: WebrtcTarget
  readonly muted: boolean
  readonly stats: boolean
  readonly highlight?: GridHighlightEmbedConfig
  readonly snapshot?: string
}

export function buildPlayerEmbedConfig(input: BuildPlayerEmbedConfigInput): EmbedConfig {
  return {
    serverUrl: input.serverUrl,
    token: input.token,
    deviceId: input.deviceId,
    target: input.target,
    muted: input.muted,
    stats: input.stats,
    ...(input.highlight ? { highlight: input.highlight } : {}),
    ...(input.snapshot ? { snapshot: input.snapshot } : {}),
  }
}
```

- [ ] **Step 4: Refactor `LiveViewWebView.tsx` to use the extracted type/builder**

In `srcV2/live/LiveViewWebView.tsx`:
1. Delete the local `interface EmbedConfig { … }` (lines 62-72).
2. Add `import { buildPlayerEmbedConfig, type EmbedConfig } from './embed-player-config.js'`.
3. Replace the `injectedBefore` config-object literal (the `buildBeforeContentScript({ serverUrl, token, deviceId, target, muted, stats, highlight, ...(snapshot ? {snapshot} : {}) })` call) so the object is built via `buildPlayerEmbedConfig`:

```typescript
const injectedBefore = serverUrl
  ? buildBeforeContentScript(
      buildPlayerEmbedConfig({
        serverUrl,
        token: token ?? '',
        deviceId,
        target,
        muted,
        stats: showStats,
        highlight,
        ...(snapshot ? { snapshot } : {}),
      }),
    )
  : undefined
```

`buildBeforeContentScript(config: EmbedConfig)` keeps its existing body
(`window.__CAMSTACK_EMBED__ = ${JSON.stringify(config)}; true;`).

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run srcV2/live/__tests__/embed-player-config.spec.ts`
Expected: PASS.
Run: `npm run ts-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add srcV2/live/embed-player-config.ts srcV2/live/__tests__/embed-player-config.spec.ts srcV2/live/LiveViewWebView.tsx
git commit -m "refactor(viewer): extract shared single-camera embed config builder"
```

---

## Task 3: Player command + host-message vocabulary

**Files:**
- Create: `srcV2/live/embed-player-messages.ts`
- Test: `srcV2/live/__tests__/embed-player-messages.spec.ts`

The native player drives the embed with inline injected JS; the web player needs a typed command union and a host-message coercer.

- [ ] **Step 1: Write the failing test**

Create `srcV2/live/__tests__/embed-player-messages.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { coercePlayerHostMessage } from '../embed-player-messages.js'

describe('coercePlayerHostMessage', () => {
  it('parses a player state message object', () => {
    expect(coercePlayerHostMessage({ type: 'state', state: 'playing' })).toEqual({ type: 'state', state: 'playing' })
    expect(coercePlayerHostMessage({ type: 'state', state: 'connecting' })).toEqual({ type: 'state', state: 'connecting' })
  })

  it('parses a micState message object', () => {
    expect(coercePlayerHostMessage({ type: 'micState', state: 'talking' })).toEqual({ type: 'micState', state: 'talking' })
  })

  it('returns null for junk / unknown', () => {
    expect(coercePlayerHostMessage({ type: 'state', state: 'bogus' })).toBeNull()
    expect(coercePlayerHostMessage({ type: 'nope' })).toBeNull()
    expect(coercePlayerHostMessage(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/live/__tests__/embed-player-messages.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `srcV2/live/embed-player-messages.ts`:

```typescript
/**
 * Player (single-camera) embed message vocabulary, mirroring the server
 * `EmbedPlayerPage` contract. `PlayerCommand` = host→embed (posted as
 * `embed-command`); `PlayerHostMessage` = embed→host (state / micState). Pure.
 */
import type { WebrtcTarget } from './signaling-types.js'
import type { GridHighlightEmbedConfig } from '../grid-embed/embed-config.js'

export type EmbedPlayerState = 'connecting' | 'playing' | 'error'
export type MicState = 'idle' | 'starting' | 'talking' | 'error'

export type PlayerCommand =
  | { readonly kind: 'setMuted'; readonly value: boolean }
  | { readonly kind: 'setTarget'; readonly value: WebrtcTarget }
  | { readonly kind: 'setStats'; readonly value: boolean }
  | { readonly kind: 'setHighlight'; readonly value: GridHighlightEmbedConfig }
  | { readonly kind: 'setSnapshot'; readonly value: string }
  | { readonly kind: 'setMic'; readonly value: boolean }
  | { readonly kind: 'fit'; readonly w: number; readonly h: number }
  | { readonly kind: 'reconnect' }

export type PlayerHostMessage =
  | { readonly type: 'state'; readonly state: EmbedPlayerState; readonly message?: string }
  | { readonly type: 'micState'; readonly state: MicState }

const PLAYER_STATES: readonly EmbedPlayerState[] = ['connecting', 'playing', 'error']
const MIC_STATES: readonly MicState[] = ['idle', 'starting', 'talking', 'error']

/** Validate an already-parsed embed→host message object (web postMessage). */
export function coercePlayerHostMessage(data: unknown): PlayerHostMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>
  if (m.type === 'state' && typeof m.state === 'string' && PLAYER_STATES.includes(m.state as EmbedPlayerState)) {
    const state = m.state as EmbedPlayerState
    return typeof m.message === 'string' ? { type: 'state', state, message: m.message } : { type: 'state', state }
  }
  if (m.type === 'micState' && typeof m.state === 'string' && MIC_STATES.includes(m.state as MicState)) {
    return { type: 'micState', state: m.state as MicState }
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run srcV2/live/__tests__/embed-player-messages.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcV2/live/embed-player-messages.ts srcV2/live/__tests__/embed-player-messages.spec.ts
git commit -m "feat(viewer): player embed message vocabulary (PlayerCommand + coercePlayerHostMessage)"
```

---

## Task 4: Per-device command channel (intercom glue)

**Files:**
- Create: `srcV2/live/embed-channel.ts`
- Test: `srcV2/live/__tests__/embed-channel.spec.ts`

On web the single-cam talk button (`use-intercom.web.ts`) is separate from the player iframe (`LiveView.web.tsx`). They communicate through a tiny per-device registry: the player registers its `postCommand` + mic-state stream; the intercom hook posts `setMic` and reads `micState`.

- [ ] **Step 1: Write the failing test**

Create `srcV2/live/__tests__/embed-channel.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerEmbedChannel, getEmbedChannel, createEmbedChannel } from '../embed-channel.js'

describe('embed-channel', () => {
  beforeEach(() => {
    // Ensure a clean registry between tests.
    getEmbedChannel(7)?.unregister?.()
  })

  it('registers and retrieves a channel by deviceId', () => {
    const ch = createEmbedChannel()
    const off = registerEmbedChannel(7, ch)
    expect(getEmbedChannel(7)).toBe(ch)
    off()
    expect(getEmbedChannel(7)).toBeUndefined()
  })

  it('notifies micState subscribers', () => {
    const ch = createEmbedChannel()
    const cb = vi.fn()
    const off = ch.subscribeMicState(cb)
    ch.setMicState('talking')
    expect(cb).toHaveBeenCalledWith('talking')
    expect(ch.getMicState()).toBe('talking')
    off()
    ch.setMicState('idle')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('forwards postCommand to the registered sender', () => {
    const send = vi.fn()
    const ch = createEmbedChannel(send)
    ch.postCommand({ kind: 'setMic', value: true })
    expect(send).toHaveBeenCalledWith({ kind: 'setMic', value: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/live/__tests__/embed-channel.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `srcV2/live/embed-channel.ts`:

```typescript
/**
 * Per-device command channel between a player iframe (`LiveView.web`) and other
 * web consumers (`use-intercom.web`). The player owns the iframe and registers a
 * channel keyed by deviceId; the intercom hook posts `setMic` and subscribes to
 * `micState`. Pure (no DOM). On native this file is unused.
 */
import type { MicState, PlayerCommand } from './embed-player-messages.js'

export interface EmbedChannel {
  /** Post a command toward the player iframe (set by the channel owner). */
  readonly postCommand: (command: PlayerCommand) => void
  /** Latest mic state. */
  readonly getMicState: () => MicState
  /** Owner pushes mic-state updates received from the embed. */
  readonly setMicState: (state: MicState) => void
  /** Subscribe to mic-state changes. Returns an unsubscribe fn. */
  readonly subscribeMicState: (cb: (state: MicState) => void) => () => void
  /** Convenience to remove this channel from the registry (set on register). */
  unregister?: () => void
}

/** Create a channel. `send` is the iframe poster (omit to no-op until set). */
export function createEmbedChannel(send: (command: PlayerCommand) => void = () => {}): EmbedChannel {
  let micState: MicState = 'idle'
  const subs = new Set<(state: MicState) => void>()
  return {
    postCommand: (command) => send(command),
    getMicState: () => micState,
    setMicState: (state) => {
      micState = state
      for (const cb of subs) cb(state)
    },
    subscribeMicState: (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}

const registry = new Map<number, EmbedChannel>()

/** Register a channel for a device. Returns an unregister fn. */
export function registerEmbedChannel(deviceId: number, channel: EmbedChannel): () => void {
  const off = (): void => {
    if (registry.get(deviceId) === channel) registry.delete(deviceId)
  }
  channel.unregister = off
  registry.set(deviceId, channel)
  return off
}

export function getEmbedChannel(deviceId: number): EmbedChannel | undefined {
  return registry.get(deviceId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run srcV2/live/__tests__/embed-channel.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcV2/live/embed-channel.ts srcV2/live/__tests__/embed-channel.spec.ts
git commit -m "feat(viewer): per-device embed command channel for web intercom"
```

---

## Task 5: Web iframe bridge hook (`use-embed-iframe.ts`)

**Files:**
- Create: `srcV2/live/use-embed-iframe.ts` (web-only consumer; uses DOM)
- Test: `srcV2/live/__tests__/use-embed-iframe.spec.ts` (jsdom)

This hook is the web counterpart to the native `injectedJavaScript`/`onMessage` plumbing: it runs the handshake, posts commands, and surfaces inbound host data. It is imported ONLY by `.web.tsx` files (never bundled on native).

- [ ] **Step 1: Write the failing test (jsdom)**

Create `srcV2/live/__tests__/use-embed-iframe.spec.ts` with jsdom:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { handleBridgeMessage } from '../use-embed-iframe.js'

describe('handleBridgeMessage', () => {
  it('replies to embed-ready with embed-config built from buildConfig', () => {
    const post = vi.fn()
    const onHost = vi.fn()
    handleBridgeMessage({ type: 'embed-ready', mode: 'player' }, { postToEmbed: post, onHostMessage: onHost, buildConfig: () => ({ id: 9 }) })
    expect(post).toHaveBeenCalledWith({ type: 'embed-config', config: { id: 9 } })
    expect(onHost).not.toHaveBeenCalled()
  })

  it('routes any other message to onHostMessage', () => {
    const post = vi.fn()
    const onHost = vi.fn()
    handleBridgeMessage({ type: 'state', state: 'playing' }, { postToEmbed: post, onHostMessage: onHost, buildConfig: () => ({}) })
    expect(onHost).toHaveBeenCalledWith({ type: 'state', state: 'playing' })
    expect(post).not.toHaveBeenCalled()
  })

  it('ignores non-object data', () => {
    const post = vi.fn()
    const onHost = vi.fn()
    handleBridgeMessage('junk', { postToEmbed: post, onHostMessage: onHost, buildConfig: () => ({}) })
    expect(post).not.toHaveBeenCalled()
    expect(onHost).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/live/__tests__/use-embed-iframe.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the hook + the pure `handleBridgeMessage`**

Create `srcV2/live/use-embed-iframe.ts`:

```typescript
/**
 * Web-only iframe bridge for the stream-broker embed. Loads
 * `/addon/stream-broker/embed/?mode=…`, runs the `embed-ready`→`embed-config`
 * handshake, posts `embed-command` messages, and forwards inbound host data.
 * Imported ONLY by `.web.tsx` files (uses DOM APIs). Mirrors the native
 * injectedJavaScript/onMessage plumbing.
 */
import { useCallback, useEffect, useRef } from 'react'
import { buildGridEmbedUrl } from '../grid-embed/embed-url.js'

interface BridgeDeps {
  readonly postToEmbed: (msg: unknown) => void
  readonly onHostMessage: (data: unknown) => void
  readonly buildConfig: () => unknown
}

/** Pure message router: reply to `embed-ready`, else forward. Unit-tested. */
export function handleBridgeMessage(data: unknown, deps: BridgeDeps): void {
  if (typeof data !== 'object' || data === null) return
  const m = data as Record<string, unknown>
  if (m.type === 'embed-ready') {
    deps.postToEmbed({ type: 'embed-config', config: deps.buildConfig() })
    return
  }
  deps.onHostMessage(data)
}

export interface EmbedIframeParams {
  readonly serverUrl: string | null
  readonly mode: 'grid' | 'player'
  readonly buildConfig: () => unknown
  readonly onHostMessage: (data: unknown) => void
}

export interface EmbedIframeApi {
  readonly iframeRef: React.RefObject<HTMLIFrameElement | null>
  readonly src: string | null
  readonly postCommand: (command: unknown) => void
  readonly reload: () => void
}

export function useEmbedIframe(params: EmbedIframeParams): EmbedIframeApi {
  const { serverUrl, mode } = params
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const hostOrigin = serverUrl ? new URL(serverUrl).origin : null
  const src = serverUrl ? buildGridEmbedUrl(serverUrl, mode) : null

  // Keep callbacks in refs so the message listener mounts once.
  const buildConfigRef = useRef(params.buildConfig)
  buildConfigRef.current = params.buildConfig
  const onHostMessageRef = useRef(params.onHostMessage)
  onHostMessageRef.current = params.onHostMessage

  const postToEmbed = useCallback(
    (msg: unknown): void => {
      iframeRef.current?.contentWindow?.postMessage(msg, hostOrigin ?? '*')
    },
    [hostOrigin],
  )

  useEffect(() => {
    const listener = (e: MessageEvent): void => {
      // Only our iframe, and (defence-in-depth) only the hub origin.
      if (e.source !== iframeRef.current?.contentWindow) return
      if (hostOrigin && e.origin !== hostOrigin) return
      handleBridgeMessage(e.data, {
        postToEmbed,
        onHostMessage: (d) => onHostMessageRef.current(d),
        buildConfig: () => buildConfigRef.current(),
      })
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [hostOrigin, postToEmbed])

  const postCommand = useCallback(
    (command: unknown): void => {
      postToEmbed({ type: 'embed-command', command })
    },
    [postToEmbed],
  )

  const reload = useCallback((): void => {
    if (iframeRef.current && src) iframeRef.current.src = src
  }, [src])

  return { iframeRef, src, postCommand, reload }
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run srcV2/live/__tests__/use-embed-iframe.spec.ts`
Expected: PASS.
Run: `npm run ts-check`
Expected: no errors. (If `HTMLIFrameElement`/`URL`/`window` are unresolved, the
viewer tsconfig already includes the DOM lib for the web target — confirm `lib`
contains `"dom"`; it must, since `react-native-web` builds the web bundle.)

- [ ] **Step 5: Commit**

```bash
git add srcV2/live/use-embed-iframe.ts srcV2/live/__tests__/use-embed-iframe.spec.ts
git commit -m "feat(viewer): web iframe bridge hook (handshake + commands)"
```

---

## Task 6: `LiveView.web.tsx` — real iframe player

**Files:**
- Rewrite: `srcV2/live/LiveView.web.tsx`

Replace the placeholder with an iframe player driven by the bridge. It registers a per-device channel so `use-intercom.web` can drive talk-back, and forwards player state to an overlay.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `srcV2/live/LiveView.web.tsx`:

```typescript
/**
 * LiveView (web) — single-camera live via the stream-broker embed in an
 * `<iframe>`. Mirrors `LiveViewWebView.tsx` (iOS) but over the web postMessage
 * bridge instead of RN injectedJavaScript. Registers a per-device `EmbedChannel`
 * so the talk button (`use-intercom.web`) can post `setMic` / read `micState`.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react-native'
import { useServer } from '../app/ServerProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, RADIUS } from '../theme/tokens.js'
import { DEFAULT_TARGET, type LiveViewHandle, type LiveViewProps } from './live-view-types.js'
import { buildPlayerEmbedConfig } from './embed-player-config.js'
import { coercePlayerHostMessage, type EmbedPlayerState, type PlayerCommand } from './embed-player-messages.js'
import { createEmbedChannel, registerEmbedChannel } from './embed-channel.js'
import { useEmbedIframe } from './use-embed-iframe.js'

export type { LiveViewHandle, LiveViewProps } from './live-view-types.js'

export const LiveView = forwardRef<LiveViewHandle, LiveViewProps>(function LiveView(
  { deviceId, target = DEFAULT_TARGET, muted = true, videoStyle, showStats = false, highlight },
  ref,
) {
  const { server, token } = useServer()
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [state, setState] = useState<EmbedPlayerState>('connecting')

  const serverUrl = server?.serverUrl ?? null

  const buildConfig = useCallback(
    () =>
      serverUrl
        ? buildPlayerEmbedConfig({
            serverUrl,
            token: token ?? '',
            deviceId,
            target,
            muted,
            stats: showStats,
            highlight,
          })
        : {},
    [serverUrl, token, deviceId, target, muted, showStats, highlight],
  )

  // Channel for the talk button (use-intercom.web): post commands to THIS iframe.
  const channelRef = useRef(createEmbedChannel())

  const onHostMessage = useCallback((data: unknown): void => {
    const msg = coercePlayerHostMessage(data)
    if (!msg) return
    if (msg.type === 'state') setState(msg.state)
    else if (msg.type === 'micState') channelRef.current.setMicState(msg.state)
  }, [])

  const { iframeRef, src, postCommand, reload } = useEmbedIframe({
    serverUrl,
    mode: 'player',
    buildConfig,
    onHostMessage,
  })

  // Wire the channel's sender to this iframe + register it for the device.
  useEffect(() => {
    const channel = createEmbedChannel((command: PlayerCommand) => postCommand(command))
    channelRef.current = channel
    const off = registerEmbedChannel(deviceId, channel)
    return off
  }, [deviceId, postCommand])

  // Push prop changes as commands (no reload).
  useEffect(() => postCommand({ kind: 'setMuted', value: muted }), [muted, postCommand])
  useEffect(() => postCommand({ kind: 'setTarget', value: target }), [target, postCommand])
  useEffect(() => postCommand({ kind: 'setStats', value: showStats }), [showStats, postCommand])

  useImperativeHandle(
    ref,
    () => ({
      startPip(): void {
        // Browser PiP can't reach a cross-origin iframe's <video>; no-op on web.
      },
      getStats: () => Promise.resolve(null),
    }),
    [],
  )

  const handleRetry = useCallback((): void => {
    setState('connecting')
    reload()
  }, [reload])

  if (!src) {
    return (
      <View style={[styles.container, { borderColor: colors.border }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.container, videoStyle, { borderColor: colors.border }]}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <iframe
        ref={iframeRef}
        src={src}
        title={`camera-${deviceId}`}
        allow="microphone; autoplay; fullscreen"
        style={{ width: '100%', height: '100%', border: 'none', background: '#000' }}
      />
      {state !== 'playing' && (
        <View style={styles.overlay} pointerEvents={state === 'error' ? 'auto' : 'none'}>
          {state === 'connecting' ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>{t('v2.live.connecting')}</Text>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
              <Pressable
                onPress={handleRetry}
                style={[styles.retryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={t('v2.live.retry')}
              >
                <RotateCw size={16} color={colors.foreground} />
                <Text style={[styles.retryLabel, { color: colors.foreground }]}>{t('v2.live.retry')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden', borderRadius: RADIUS.md },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  hint: { fontSize: 13, textAlign: 'center' },
  errorText: { fontSize: 13, textAlign: 'center' },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  retryLabel: { fontSize: 13, fontWeight: '600' },
})
```

- [ ] **Step 2: Type-check**

Run: `npm run ts-check`
Expected: no errors. (The `<iframe>` JSX is valid in a `.web.tsx` — `@types/react` provides the intrinsic element. If the RN JSX namespace shadows it, switch to `React.createElement('iframe', { ref: iframeRef, src, title: \`camera-${deviceId}\`, allow: 'microphone; autoplay; fullscreen', style: { width: '100%', height: '100%', border: 'none', background: '#000' } })`.)

- [ ] **Step 3: Run the full viewer test suite (no regressions)**

Run: `npm run test:v2`
Expected: all specs PASS.

- [ ] **Step 4: Commit**

```bash
git add srcV2/live/LiveView.web.tsx
git commit -m "feat(viewer): web LiveView via stream-broker embed iframe"
```

---

## Task 7: `GridLiveEmbed.web.tsx` + `use-intercom.web.ts`

**Files:**
- Create: `srcV2/grid-embed/GridLiveEmbed.web.tsx`
- Rewrite: `srcV2/live/use-intercom.web.ts`

- [ ] **Step 1: Create `GridLiveEmbed.web.tsx`**

Create `srcV2/grid-embed/GridLiveEmbed.web.tsx`. It mirrors the native
`GridLiveEmbed`'s props and uses the bridge. (Same prop interface — copy the
`GridLiveEmbedProps` shape from `GridLiveEmbed.tsx` so consumers are identical.)

```typescript
/**
 * GridLiveEmbed (web) — the shared multi-camera grid in an `<iframe>` loading the
 * stream-broker embed (`?mode=grid`). Same props/callbacks as the native
 * `GridLiveEmbed.tsx`; uses the web postMessage bridge instead of RN
 * injectedJavaScript. Reconnect self-heals on browser online/visibility events.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react-native'
import { useServer } from '../app/ServerProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import type { GridQuality, GridLayout } from '../store/grid-store.js'
import { buildGridEmbedConfig, type GridHighlightEmbedConfig } from './embed-config.js'
import { coerceGridHostMessage, type GridReportState, type TileRect } from './embed-messages.js'
import { useEmbedIframe } from '../live/use-embed-iframe.js'

interface GridLiveEmbedProps {
  readonly devices: readonly number[]
  readonly quality: GridQuality
  readonly layout: GridLayout
  readonly showName: boolean
  readonly audioOnIds: readonly number[]
  readonly pausedIds: readonly number[]
  readonly highlight?: GridHighlightEmbedConfig
  readonly activeOnly?: boolean
  readonly ptzIds?: readonly number[]
  readonly onTileTap?: (deviceId: number, rect: TileRect) => void
  readonly onTileLongPress?: (deviceId: number, rect: TileRect) => void
  readonly onTileOpen?: (deviceId: number) => void
  readonly onAudioToggle?: (deviceId: number) => void
  readonly onPauseToggle?: (deviceId: number) => void
  readonly onPtzOpen?: (deviceId: number) => void
  readonly onStateChange?: (state: GridReportState) => void
}

export function GridLiveEmbed(props: GridLiveEmbedProps) {
  const { devices, quality, layout, showName, audioOnIds, pausedIds, highlight, activeOnly, ptzIds } = props
  const { server, token } = useServer()
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [state, setState] = useState<GridReportState>('connecting')

  const serverUrl = server?.serverUrl ?? null

  const buildConfig = useCallback(
    () =>
      serverUrl
        ? buildGridEmbedConfig({
            serverUrl,
            token: token ?? '',
            deviceIds: devices,
            options: { showName, quality, layout },
            muted: true,
            paused: false,
            highlight,
            activeOnly,
            audioOnIds,
            pausedIds,
            ptzIds,
          })
        : {},
    [serverUrl, token, devices, showName, quality, layout, highlight, activeOnly, audioOnIds, pausedIds, ptzIds],
  )

  const onHostMessage = useCallback(
    (data: unknown): void => {
      const msg = coerceGridHostMessage(data)
      if (!msg) return
      switch (msg.type) {
        case 'state':
          setState(msg.state)
          props.onStateChange?.(msg.state)
          break
        case 'tileTap':
          props.onTileTap?.(msg.deviceId, msg.rect)
          break
        case 'tileLongPress':
          props.onTileLongPress?.(msg.deviceId, msg.rect)
          break
        case 'tileOpen':
          props.onTileOpen?.(msg.deviceId)
          break
        case 'audioToggle':
          props.onAudioToggle?.(msg.deviceId)
          break
        case 'pauseToggle':
          props.onPauseToggle?.(msg.deviceId)
          break
        case 'ptzOpen':
          props.onPtzOpen?.(msg.deviceId)
          break
        case 'layout':
          break
      }
    },
    [props],
  )

  const { iframeRef, src, postCommand, reload } = useEmbedIframe({
    serverUrl,
    mode: 'grid',
    buildConfig,
    onHostMessage,
  })

  // Push grid-wide option changes as commands (no reload).
  const audioKey = audioOnIds.join(',')
  const pausedKey = pausedIds.join(',')
  useEffect(() => postCommand({ kind: 'setAudioOn', value: audioOnIds }), [audioKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => postCommand({ kind: 'setPaused', value: pausedIds }), [pausedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => postCommand({ kind: 'setQuality', value: quality }), [quality, postCommand])
  useEffect(() => postCommand({ kind: 'setLayout', value: layout }), [layout, postCommand])
  useEffect(() => postCommand({ kind: 'setShowName', value: showName }), [showName, postCommand])
  useEffect(() => {
    if (highlight) postCommand({ kind: 'setHighlight', value: highlight })
  }, [highlight, postCommand])
  useEffect(() => postCommand({ kind: 'setActiveOnly', value: activeOnly ?? false }), [activeOnly, postCommand])

  // Self-heal on browser connectivity / tab visibility — reconnect (keep frames).
  useEffect(() => {
    const onOnline = (): void => postCommand({ kind: 'reconnect' })
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') postCommand({ kind: 'reconnect' })
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [postCommand])

  const handleRetry = useCallback((): void => {
    setState('connecting')
    reload()
  }, [reload])

  if (!src) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <iframe
        ref={iframeRef}
        src={src}
        title="camera-grid"
        allow="microphone; autoplay; fullscreen"
        style={{ width: '100%', height: '100%', border: 'none', background: '#000' }}
      />
      {state !== 'ready' && (
        <View style={styles.overlay} pointerEvents={state === 'error' ? 'auto' : 'none'}>
          {state === 'connecting' ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>{t('v2.live.connecting')}</Text>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
              <Pressable onPress={handleRetry} style={[styles.retryButton, { borderColor: colors.border }]}>
                <RotateCw size={16} color={colors.foreground} />
                <Text style={[styles.retryLabel, { color: colors.foreground }]}>{t('v2.live.retry')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  hint: { fontSize: 13, textAlign: 'center' },
  errorText: { fontSize: 13, textAlign: 'center' },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryLabel: { fontSize: 13, fontWeight: '600' },
})
```

- [ ] **Step 2: Rewrite `use-intercom.web.ts` to delegate to the channel**

Replace the entire contents of `srcV2/live/use-intercom.web.ts`:

```typescript
/**
 * useIntercom (web) — talk-back delegated to the player iframe. The single-camera
 * `LiveView.web` registers an `EmbedChannel` for the device; this hook posts
 * `setMic` and mirrors the embed's `micState`. The actual getUserMedia + WebRTC
 * runs INSIDE the embed (`EmbedPlayerPage`), so no react-native-webrtc here.
 */
import { useCallback, useEffect, useState } from 'react'
import type { IntercomController } from './use-intercom.js'
import { getEmbedChannel } from './embed-channel.js'
import type { MicState } from './embed-player-messages.js'

export function useIntercom(deviceId: number): IntercomController {
  const [micState, setMicState] = useState<MicState>('idle')

  useEffect(() => {
    const channel = getEmbedChannel(deviceId)
    if (!channel) return
    setMicState(channel.getMicState())
    return channel.subscribeMicState(setMicState)
  }, [deviceId])

  const toggle = useCallback(() => {
    const channel = getEmbedChannel(deviceId)
    if (!channel) return
    const next = channel.getMicState() === 'talking' || channel.getMicState() === 'starting'
    channel.postCommand({ kind: 'setMic', value: !next })
  }, [deviceId])

  return {
    talking: micState === 'talking',
    busy: micState === 'starting',
    error: micState === 'error' ? 'intercom error' : null,
    toggle,
  }
}
```

- [ ] **Step 3: Type-check + full test suite**

Run: `npm run ts-check`
Expected: no errors.
Run: `npm run test:v2`
Expected: all specs PASS.

- [ ] **Step 4: Commit**

```bash
git add srcV2/grid-embed/GridLiveEmbed.web.tsx srcV2/live/use-intercom.web.ts
git commit -m "feat(viewer): web GridLiveEmbed iframe + intercom delegation"
```

---

## Task 8: Desktop shell — persistent sidebar on wide web + fullscreen

**Files:**
- Modify: `srcV2/hooks/use-responsive.ts`
- Modify: `srcV2/navigation/TabsNavigator.tsx`
- Create: `srcV2/hooks/use-web-fullscreen.ts`
- Test: `srcV2/hooks/__tests__/use-responsive.spec.ts` (pure breakpoint helper)

- [ ] **Step 1: Write the failing test for a pure breakpoint helper**

Create `srcV2/hooks/__tests__/use-responsive.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { shouldShowSidebar } from '../use-responsive.js'

describe('shouldShowSidebar', () => {
  it('shows sidebar on a real tablet (shortest side >= 768)', () => {
    expect(shouldShowSidebar({ width: 1024, height: 768, isWeb: false })).toBe(true)
  })
  it('shows sidebar on phone-landscape (width > height, shortest side < 768)', () => {
    expect(shouldShowSidebar({ width: 932, height: 430, isWeb: false })).toBe(true)
  })
  it('hides sidebar on phone-portrait (native)', () => {
    expect(shouldShowSidebar({ width: 390, height: 844, isWeb: false })).toBe(false)
  })
  it('shows sidebar on wide web even when short (e.g. 1280x720 browser)', () => {
    expect(shouldShowSidebar({ width: 1280, height: 720, isWeb: true })).toBe(true)
  })
  it('keeps bottom nav on a narrow web window (phone-sized browser)', () => {
    expect(shouldShowSidebar({ width: 420, height: 800, isWeb: true })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/hooks/__tests__/use-responsive.spec.ts`
Expected: FAIL — `shouldShowSidebar` is not exported.

- [ ] **Step 3: Add the pure helper to `use-responsive.ts`**

In `srcV2/hooks/use-responsive.ts`, add (keep the existing `useIsTablet` /
`useIsMobileLandscape` / `useGridColumns` exactly as they are):

```typescript
/** Width (pt) at/above which a web window gets the persistent sidebar even when
 *  its height is short (a landscape laptop browser). */
const WEB_SIDEBAR_MIN_WIDTH = 900

interface SidebarInput {
  readonly width: number
  readonly height: number
  readonly isWeb: boolean
}

/** Pure rule for showing the side nav: a real tablet (shortest side >= 768), a
 *  phone in landscape, OR a wide web window. Unit-tested. */
export function shouldShowSidebar({ width, height, isWeb }: SidebarInput): boolean {
  const isTablet = Math.min(width, height) >= TABLET_MIN_SIDE
  const isPhoneLandscape = Math.min(width, height) < TABLET_MIN_SIDE && width > height
  const isWideWeb = isWeb && width >= WEB_SIDEBAR_MIN_WIDTH
  return isTablet || isPhoneLandscape || isWideWeb
}

/** Hook form: whether to show the side nav, and whether it should be the full
 *  labelled rail (vs the compact icon-only rail used in phone-landscape). */
export function useSidebarLayout(): { readonly showSidebar: boolean; readonly compact: boolean } {
  const { width, height } = useWindowDimensions()
  const isWeb = Platform.OS === 'web'
  const showSidebar = shouldShowSidebar({ width, height, isWeb })
  const isTablet = Math.min(width, height) >= TABLET_MIN_SIDE
  const isWideWeb = isWeb && width >= WEB_SIDEBAR_MIN_WIDTH
  // Compact (icon-only) only for phone-landscape; tablet + wide web use labels.
  const compact = showSidebar && !isTablet && !isWideWeb
  return { showSidebar, compact }
}
```

Add `import { Platform } from 'react-native'` to the file imports (alongside the
existing `useWindowDimensions` import).

- [ ] **Step 4: Use the new hook in `TabsNavigator.tsx`**

In `srcV2/navigation/TabsNavigator.tsx`, replace the responsive derivation
(lines ~49-56, the `const isTablet = useIsTablet(); const compact = useIsMobileLandscape();
const showSideNav = isTablet || compact; const showBottomNav = !showSideNav`):

```typescript
import { useSidebarLayout } from '../hooks/use-responsive.js'

// ...inside the component:
const { showSidebar: showSideNav, compact } = useSidebarLayout()
const showBottomNav = !showSideNav
```

(`railWidth` keeps using `compact ? 56 : 72`; the rest of the sidebar render is
unchanged — wide web now gets the full labelled rail.)

- [ ] **Step 5: Create the web fullscreen hook**

Create `srcV2/hooks/use-web-fullscreen.ts`:

```typescript
/**
 * Browser Fullscreen API hook (web). On native this is a harmless no-op (the
 * native fullscreen path uses ScreenOrientation elsewhere). Attach `ref` to the
 * container you want to fill (the iframe wrapper); call `toggle()` from the
 * fullscreen button.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'

export interface WebFullscreen {
  readonly ref: React.RefObject<unknown>
  readonly isFullscreen: boolean
  readonly toggle: () => void
}

export function useWebFullscreen(): WebFullscreen {
  const ref = useRef<unknown>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const onChange = (): void => setIsFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = useCallback((): void => {
    if (Platform.OS !== 'web') return
    const el = ref.current as Element | null
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else if (el && typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen()
    }
  }, [])

  return { ref, isFullscreen, toggle }
}
```

- [ ] **Step 6: Wire fullscreen into the camera-detail + grid fullscreen controls**

Read `srcV2/screens/CameraDetailScreen.tsx` and `srcV2/screens/GridViewScreen.tsx`
and find the existing fullscreen button handler (search for `fullscreen`, `Maximize`,
or `ScreenOrientation`). For the WEB path, call `useWebFullscreen()`'s `toggle()`
and attach its `ref` to the stream/grid container `View`. Keep the existing native
fullscreen behaviour under `Platform.OS !== 'web'`. Concretely, at the fullscreen
button's `onPress`, branch:

```typescript
const fs = useWebFullscreen()
// container View: <View ref={fs.ref as never} ...>
// button onPress: Platform.OS === 'web' ? fs.toggle() : <existing native handler>
```

(react-native-web forwards a DOM node to `ref` on a `View`, so `fs.ref` resolves
to the underlying element for `requestFullscreen`.)

- [ ] **Step 7: Type-check + full test suite**

Run: `npm run ts-check`
Expected: no errors.
Run: `npm run test:v2`
Expected: all specs PASS (including the new `shouldShowSidebar` tests).

- [ ] **Step 8: Commit**

```bash
git add srcV2/hooks/use-responsive.ts srcV2/hooks/use-web-fullscreen.ts srcV2/hooks/__tests__/use-responsive.spec.ts srcV2/navigation/TabsNavigator.tsx srcV2/screens/CameraDetailScreen.tsx srcV2/screens/GridViewScreen.tsx
git commit -m "feat(viewer): persistent sidebar on wide web + Fullscreen API"
```

---

## Task 9: End-to-end web verification

**Prerequisite:** Plan 1 (server embed) implemented AND deployed to the dev hub.

- [ ] **Step 1: Build the web bundle**

Run: `npm run build:web`
Expected: `expo export --platform web` produces `dist/` with no bundling errors.

- [ ] **Step 2: Serve + load the PWA against the hub**

Run: `npm run web` (Expo web dev server) OR serve `dist/` statically, and open it
in a browser pointed at a running hub (`https://localhost:4443` or the remote
`camstack.example.com`). Log in.

- [ ] **Step 3: Manual checklist (record results)**

- [ ] Open a camera detail → the `<iframe>` player shows live video (H265 decodes via the browser).
- [ ] Talk button → mic prompt → talk-back works; the button reflects `talking`.
- [ ] Open a grid → N tiles load in one iframe; tap a tile → navigates to camera detail.
- [ ] Grid control bar quality/layout/mute changes apply without reload.
- [ ] On a wide browser window the persistent labelled sidebar shows; bottom nav is gone.
- [ ] Fullscreen button on camera-detail and grid enters/exits browser fullscreen.
- [ ] Toggle the browser offline→online (DevTools) → the grid reconnects (keeps frames).

- [ ] **Step 4: Confirm no native regression**

Run: `npm run ts-check && npm run test:v2`
Expected: green. The native iOS path (`LiveViewWebView.tsx` / native `GridLiveEmbed.tsx`)
is unchanged except the Task 2 config extraction (covered by unit tests).

- [ ] **Step 5: Final commit (if Task 6 wiring touched any file not yet committed)**

```bash
git add -p
git commit -m "chore(viewer): web viewer end-to-end verification"
```

---

## Self-review checklist (run after writing the code)

- [ ] **Spec coverage:** iframe bridge ✓ Task 5; single-cam live ✓ Task 6; grid ✓ Task 7; intercom (both) ✓ Task 6+7 (player embed `setMic` from Plan 1, channel here); desktop shell + fullscreen ✓ Task 8; build:web + PWA ✓ Task 9.
- [ ] **Type consistency:** `PlayerCommand.kind` strings (`setMuted`/`setTarget`/`setStats`/`setMic`/`fit`/`reconnect`) match the player command listener in Plan 1 Task 6/7; `GridCommand.kind` strings match Plan 1 Task 5's grid listener.
- [ ] **No placeholders:** every new file has complete code; the only "locate it" step is Task 8 Step 6 (fullscreen wiring) which gives the exact hook API + branch — read the two named screens to attach it.
- [ ] **Metro resolution:** `.web.tsx`/`.web.ts` variants exist for `LiveView`, `GridLiveEmbed`, `use-intercom`; base files remain native.

## Notes / gotchas (carry into execution)

- The web `<iframe>` relies on CSS 100%×100% sizing + the embed's accurate browser `window.innerHeight` (no stale-rotation issue), so `fit` is NOT required on web (omitted).
- Web getStats returns `null` (the in-iframe stats overlay via `showStats` covers it) — the embed's RTCPeerConnection isn't reachable cross-origin.
- TLS/mixed-content: an https PWA loading an http hub or a self-signed cert is blocked by the browser (same constraint as WKWebView ATS) — use a trusted cert.
- The embed bundle must be the Plan-1 version deployed to the hub, or the handshake never completes (the page would wait for `embed-config` forever); until then web shows the connecting overlay.
- `npm run build:web` also feeds `build:web:embedded` (External hub) and `build:ha-addon` — those reuse the same app, so they inherit web streaming automatically (cross-origin iframe + postMessage works the same).
