# Recording Playback (VOD) + Scrub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recorded-footage **continuous playback (HLS VOD)** and, later, **frame-accurate scrub** to the srcV2 camera-detail timeline, reusing the backend contracts in `camstack-server/docs/superpowers/specs/2026-06-15-viewer-recording-integration-notes.md` and the scrub design in `…/2026-06-13-viewer-scrub-client-design.md`.

**Architecture:** A single **hub-served recording embed** (`/addon/stream-broker/embed/?mode=recording`) loaded in a WKWebView is the playback/scrub *surface*; the viewer's **native RN timeline** (`TheaterTimeline`) is the *controller*, driving the embed via injected config + `injectJavaScript` commands and receiving state via `postMessage` — exactly the pattern already used by `LiveViewWebView`/the grid embed. Phase 1 ships VOD (HLS `<video>`); Phase 3 adds a WebCodecs `ScrubEngine` to the SAME embed page. The embed loads from the hub origin so the data-plane's relative, token-in-path HLS URLs resolve and WebCodecs runs in a secure context.

**Tech Stack:** TypeScript 5.9; server embed = React + Vite (in `camstack-server/packages/addon-pipeline/embed`); viewer = Expo/React Native + `react-native-webview`; tRPC client via `@camstack/sdk`; HLS = Safari/WKWebView native `<video>` (+ `hls.js` for web in Phase 1b); scrub = `mp4box.js` + WebCodecs (Phase 3). Tests = vitest (`npm run test:v2`).

**Sequencing (locked):** Phase 1 VOD → Phase 2 scrub de-risk spike (go/no-go) → Phase 3 ScrubEngine. **This document fully details Phase 1**; Phases 2–3 are a roadmap (each gets its own plan once Phase 1 lands / the spike reports).

**Repos touched (Phase 1):** `camstack-server` (embed page + route) and `camstack-viewer` (timeline data + WebView controller). Build/deploy the embed with `cd camstack-server/packages/addon-pipeline && npm run build && camstack deploy . --no-build --server https://localhost:4443` (rebuild `ui-library` first only if it changed — it does not here).

---

## Backend contract (already exists — do NOT add server caps)

```ts
recording.getPlaybackManifest({ deviceId, fromMs, toMs })
  → { deviceId, localMasterPath, playbackUrl: string|null, playbackEndpoints: string[] }   // playbackUrl null = no footage in range; token in URL path
recording.getAvailability({ deviceId, fromMs, toMs })
  → { deviceId, ranges: { profile: string, startMs: number, endMs: number }[] }            // gaps = no footage
recording.getDeviceConfig({ deviceId })
  → { …, mode: 'off' | 'events' | 'continuous' }                                           // authoritative; never infer
```
- HLS master is multi-variant (`high`=HEVC, `mid`/`low`=H.264); feed it as-is to the player. Segments are self-contained fMP4 `<startMs>-<durMs>.m4s` (absolute epoch start), 206-Range capable.
- Auth: data-plane is `access:'admin'`, token rides in the URL path of `playbackUrl`. The embed runs from the hub origin (same as the live embed) and uses the same auth the live WebRTC path uses (token in the injected config / SDK client).

---

## File Structure

**Server embed (`camstack-server/packages/addon-pipeline/embed/src/`):**
- Create `embed/embed-recording-config.ts` — zod schema + `readRecordingConfig()` for `window.__CAMSTACK_RECORDING__`.
- Create `pages/EmbedRecordingPage.tsx` — HLS `<video>` VOD player; host API `window.__camstackRecording`; posts state/position.
- Modify `EmbedApp.tsx` — route `?mode=recording` → `EmbedRecordingPage`.

**Viewer (`camstack-viewer/srcV2/`):**
- Create `recording/recording-messages.ts` (+ `__tests__/recording-messages.spec.ts`) — host↔embed contract (pure).
- Create `recording/recording-availability.ts` (+ test) — map `getAvailability` → merged `TimeRange[]` (reuse `timeline/coverage.ts`).
- Create `data/use-recording.ts` — `useRecordingAvailability`, `useRecordingMode` (tRPC hooks).
- Create `live/RecordingPlayerWebView.tsx` — the WKWebView controller (mirrors `LiveViewWebView`).
- Modify `grid-embed/embed-url.ts` — add `'recording'` to `EmbedMode`.
- Modify `components/camera/theater/TheaterTimeline.tsx` + `HeatmapBar.tsx` — feed real coverage; tap-covered-time → enter VOD.
- Modify `screens/CameraDetailScreen.tsx` — VOD mode state: swap the live surface for `RecordingPlayerWebView`, "return to live" control.

---

## Phase 1 — Continuous VOD playback (HLS)

**Phase-1 deliverable (testable):** On a camera with footage, tapping a covered time on the camera-detail timeline plays recorded HLS from that instant in a hub-served WebView; play/pause works; tapping another covered time re-seeks; a LIVE control returns to the live stream. Timeline coverage bands reflect real `getAvailability` (not mock).

### Task 1: Recording embed config (server, pure)

**Files:**
- Create: `camstack-server/packages/addon-pipeline/embed/src/embed/embed-recording-config.ts`

- [ ] **Step 1: Write the config module**

```ts
import { z } from 'zod'

/** Injected as window.__CAMSTACK_RECORDING__ before the page loads (host-set). */
export const recordingConfigSchema = z.object({
  serverUrl: z.string().min(1),
  token: z.string().min(1),
  deviceId: z.number().int().nonnegative(),
  /** Initial playback start (epoch ms). 0 ⇒ idle until the host seeks. */
  startMs: z.number().int().nonnegative().optional(),
})

export type RecordingConfig = z.infer<typeof recordingConfigSchema>

export type RecordingConfigResult =
  | { readonly ok: true; readonly config: RecordingConfig }
  | { readonly ok: false; readonly error: string }

export function parseRecordingConfig(raw: unknown): RecordingConfigResult {
  if (raw === undefined || raw === null) return { ok: false, error: 'config is required' }
  const parsed = recordingConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') }
  }
  return { ok: true, config: parsed.data }
}

export function readRecordingConfig(): RecordingConfigResult {
  const raw = (window as unknown as { __CAMSTACK_RECORDING__?: unknown }).__CAMSTACK_RECORDING__
  if (raw === undefined || raw === null) return { ok: false, error: 'window.__CAMSTACK_RECORDING__ is not set' }
  return parseRecordingConfig(raw)
}
```

- [ ] **Step 2: Type-check**

Run: `cd camstack-server/packages/addon-pipeline && npx tsc -p embed/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git -C camstack-server add packages/addon-pipeline/embed/src/embed/embed-recording-config.ts
git -C camstack-server commit -m "feat(embed): recording-mode config reader"
```

### Task 2: Recording embed page (server) — HLS VOD player + host API

**Files:**
- Create: `camstack-server/packages/addon-pipeline/embed/src/pages/EmbedRecordingPage.tsx`

**Window epoch↔media mapping (the rule the page uses):** the page loads a master for `[fromMs, fromMs + WINDOW_MS]`; `<video>.currentTime` is media-relative, so the playhead epoch = `fromMs + currentTime*1000`. Each `seekTo(epochMs)` reloads a fresh master at `fromMs = epochMs` (coarse seek — frame-exact is Phase 3).

- [ ] **Step 1: Write the page**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSystem, type System } from '@camstack/sdk'
import { readRecordingConfig, type RecordingConfig } from '../embed/embed-recording-config'

/** A 6h window per loaded master keeps playlists small; re-seek loads a new one. */
const WINDOW_MS = 6 * 60 * 60 * 1000

type RecState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

interface RecMessage {
  readonly type: 'state' | 'position'
  readonly state?: RecState
  readonly message?: string
  /** Playhead in epoch ms (for the host timeline cursor). */
  readonly positionMs?: number
}

declare global {
  interface Window {
    __CAMSTACK_RECORDING__?: unknown
    __camstackRecording?: {
      seekTo: (epochMs: number) => void
      play: () => void
      pause: () => void
      setRate: (rate: number) => void
      fit: (w: number, h: number) => void
    }
    ReactNativeWebView?: { postMessage: (m: string) => void }
  }
}

function post(msg: RecMessage): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg))
}

interface PlayerProps {
  readonly system: System
  readonly config: RecordingConfig
}

function RecordingPlayer({ system, config }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // The epoch start of the currently-loaded master (for position mapping).
  const windowStartRef = useRef<number>(0)
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight })

  // Load + play a master covering [epochMs, epochMs+WINDOW_MS]; map media→epoch.
  const loadAt = useMemo(() => async (epochMs: number): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    post({ type: 'state', state: 'loading' })
    try {
      const manifest = await system.trpcClient.recording.getPlaybackManifest.query({
        deviceId: config.deviceId,
        fromMs: epochMs,
        toMs: epochMs + WINDOW_MS,
      })
      if (!manifest?.playbackUrl) {
        post({ type: 'state', state: 'error', message: 'no footage' })
        return
      }
      windowStartRef.current = epochMs
      video.src = manifest.playbackUrl // Safari/WKWebView native HLS (multi-variant)
      video.currentTime = 0
      await video.play().catch(() => {})
    } catch (err) {
      post({ type: 'state', state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [system, config.deviceId])

  // Expose the host control surface + report playback state.
  useEffect(() => {
    window.__camstackRecording = {
      seekTo: (epochMs) => { void loadAt(epochMs) },
      play: () => { void videoRef.current?.play().catch(() => {}) },
      pause: () => videoRef.current?.pause(),
      setRate: (rate) => { if (videoRef.current) videoRef.current.playbackRate = rate },
      fit: (w, h) => setBox({ w, h }),
    }
    if (config.startMs && config.startMs > 0) void loadAt(config.startMs)
    return () => { if (window.__camstackRecording) delete window.__camstackRecording }
  }, [loadAt, config.startMs])

  return (
    <div style={{ position: 'fixed', left: 0, top: 0, width: box.w, height: box.h, background: '#000' }}>
      <video
        ref={videoRef}
        playsInline
        controls={false}
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
        onPlaying={() => post({ type: 'state', state: 'playing' })}
        onPause={() => post({ type: 'state', state: 'paused' })}
        onEnded={() => post({ type: 'state', state: 'ended' })}
        onError={() => post({ type: 'state', state: 'error', message: 'video error' })}
        onTimeUpdate={(e) => post({ type: 'position', positionMs: windowStartRef.current + e.currentTarget.currentTime * 1000 })}
      />
    </div>
  )
}

export function EmbedRecordingPage() {
  const result = useMemo(() => readRecordingConfig(), [])
  const built = useMemo(() => {
    if (!result.ok) return null
    return createSystem({ serverUrl: result.config.serverUrl, token: result.config.token })
  }, [result])
  useEffect(() => () => built?.close(), [built])

  if (!result.ok) { post({ type: 'state', state: 'error', message: result.error }); return null }
  if (!built) { post({ type: 'state', state: 'error', message: 'init failed' }); return null }
  return <RecordingPlayer system={built} config={result.config} />
}
```

- [ ] **Step 2: Type-check** — `cd camstack-server/packages/addon-pipeline && npx tsc -p embed/tsconfig.json` → exit 0.

- [ ] **Step 3: Commit**

```bash
git -C camstack-server add packages/addon-pipeline/embed/src/pages/EmbedRecordingPage.tsx
git -C camstack-server commit -m "feat(embed): recording-mode HLS VOD player page"
```

### Task 3: Route `?mode=recording` (server)

**Files:**
- Modify: `camstack-server/packages/addon-pipeline/embed/src/EmbedApp.tsx`

- [ ] **Step 1: Add the route**

```tsx
import { EmbedGridPage } from './pages/EmbedGridPage'
import { EmbedPlayerPage } from './pages/EmbedPlayerPage'
import { EmbedRecordingPage } from './pages/EmbedRecordingPage'

export function EmbedApp() {
  const mode = new URLSearchParams(location.search).get('mode') ?? 'grid'
  if (mode === 'player') return <EmbedPlayerPage />
  if (mode === 'recording') return <EmbedRecordingPage />
  return <EmbedGridPage />
}
```

- [ ] **Step 2: Build the embed** — `cd camstack-server/packages/addon-pipeline && npm run build` → built; grep the bundle: `grep -c "__CAMSTACK_RECORDING__" embed-dist/assets/index-*.js` → ≥ 1.

- [ ] **Step 3: Deploy + health** — `camstack deploy . --no-build --server https://localhost:4443` → `Hub healthy`.

- [ ] **Step 4: Commit**

```bash
git -C camstack-server add packages/addon-pipeline/embed/src/EmbedApp.tsx
git -C camstack-server commit -m "feat(embed): route ?mode=recording to the VOD player"
```

### Task 4: Viewer host↔embed message contract (pure, TDD)

**Files:**
- Create: `camstack-viewer/srcV2/recording/recording-messages.ts`
- Test: `camstack-viewer/srcV2/recording/__tests__/recording-messages.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseRecordingHostMessage, recordingCommandScript } from '../recording-messages.js'

describe('parseRecordingHostMessage', () => {
  it('parses a state message', () => {
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'state', state: 'playing' })))
      .toEqual({ type: 'state', state: 'playing' })
  })
  it('parses a position message', () => {
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'position', positionMs: 1234 })))
      .toEqual({ type: 'position', positionMs: 1234 })
  })
  it('returns null for junk / unknown', () => {
    expect(parseRecordingHostMessage('not json')).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'nope' }))).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'state', state: 'bogus' }))).toBeNull()
  })
})

describe('recordingCommandScript', () => {
  it('serializes each command to a window.__camstackRecording call ending in true;', () => {
    expect(recordingCommandScript({ kind: 'seekTo', epochMs: 1700000000000 }))
      .toContain('window.__camstackRecording')
    expect(recordingCommandScript({ kind: 'seekTo', epochMs: 1700000000000 })).toContain('seekTo(1700000000000)')
    expect(recordingCommandScript({ kind: 'play' })).toContain('play()')
    expect(recordingCommandScript({ kind: 'pause' })).toContain('pause()')
    expect(recordingCommandScript({ kind: 'setRate', rate: 2 })).toContain('setRate(2)')
    expect(recordingCommandScript({ kind: 'fit', w: 800, h: 600 })).toContain('fit(800, 600)')
    expect(recordingCommandScript({ kind: 'play' }).trim().endsWith('true;')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** — `cd camstack-viewer && npx vitest run srcV2/recording/__tests__/recording-messages.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/** Page↔host contract for the recording embed (mirrors grid embed-messages). */
export type RecordingReportState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export type RecordingHostMessage =
  | { readonly type: 'state'; readonly state: RecordingReportState; readonly message?: string }
  | { readonly type: 'position'; readonly positionMs: number }

const STATES: readonly RecordingReportState[] = ['idle', 'loading', 'playing', 'paused', 'ended', 'error']

export function parseRecordingHostMessage(raw: string): RecordingHostMessage | null {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return null }
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>
  if (m.type === 'state') {
    if (typeof m.state !== 'string' || !STATES.includes(m.state as RecordingReportState)) return null
    const state = m.state as RecordingReportState
    return typeof m.message === 'string' ? { type: 'state', state, message: m.message } : { type: 'state', state }
  }
  if (m.type === 'position') {
    if (typeof m.positionMs !== 'number') return null
    return { type: 'position', positionMs: m.positionMs }
  }
  return null
}

export type RecordingCommand =
  | { readonly kind: 'seekTo'; readonly epochMs: number }
  | { readonly kind: 'play' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'setRate'; readonly rate: number }
  | { readonly kind: 'fit'; readonly w: number; readonly h: number }

export function recordingCommandScript(cmd: RecordingCommand): string {
  const api = 'window.__camstackRecording'
  const call =
    cmd.kind === 'seekTo' ? `${api}.seekTo(${cmd.epochMs})`
    : cmd.kind === 'play' ? `${api}.play()`
    : cmd.kind === 'pause' ? `${api}.pause()`
    : cmd.kind === 'setRate' ? `${api}.setRate(${cmd.rate})`
    : `${api}.fit(${cmd.w}, ${cmd.h})`
  return `${api} && ${call}; true;`
}
```

- [ ] **Step 4: Run it — expect PASS** — `npx vitest run srcV2/recording/__tests__/recording-messages.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git -C camstack-viewer add srcV2/recording/recording-messages.ts srcV2/recording/__tests__/recording-messages.spec.ts
git -C camstack-viewer commit -m "feat(recording): host<->embed message contract"
```

### Task 5: Availability → merged coverage (pure, TDD)

**Files:**
- Create: `camstack-viewer/srcV2/recording/recording-availability.ts`
- Test: `camstack-viewer/srcV2/recording/__tests__/recording-availability.spec.ts`

Reuses `srcV2/timeline/coverage.ts` (`mergeRanges`, `TimeRange`) — already unit-tested.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { availabilityToCoverage } from '../recording-availability.js'

describe('availabilityToCoverage', () => {
  it('merges per-profile ranges into one sorted non-overlapping coverage', () => {
    const ranges = [
      { profile: 'high', startMs: 0, endMs: 100 },
      { profile: 'low', startMs: 90, endMs: 200 },   // overlaps high → merge
      { profile: 'low', startMs: 300, endMs: 400 },  // disjoint
    ]
    expect(availabilityToCoverage(ranges)).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 300, endMs: 400 },
    ])
  })
  it('returns [] for empty input', () => {
    expect(availabilityToCoverage([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** — `npx vitest run srcV2/recording/__tests__/recording-availability.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { mergeRanges, type TimeRange } from '../timeline/coverage.js'

/** A per-profile availability span as returned by recording.getAvailability. */
export interface AvailabilitySpan {
  readonly profile: string
  readonly startMs: number
  readonly endMs: number
}

/** Flatten per-profile spans into a single merged, sorted, non-overlapping
 *  coverage set for the timeline ("has footage" bands). Profile is irrelevant
 *  for coverage — any profile present means footage exists. */
export function availabilityToCoverage(spans: readonly AvailabilitySpan[]): TimeRange[] {
  return mergeRanges(spans.map((s) => ({ startMs: s.startMs, endMs: s.endMs })))
}
```

> If `mergeRanges` is not exported from `timeline/coverage.ts`, export it (it is referenced by the existing `coverage.spec.ts`, so it already is). Confirm the `TimeRange` shape is `{ startMs, endMs }`.

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git -C camstack-viewer add srcV2/recording/recording-availability.ts srcV2/recording/__tests__/recording-availability.spec.ts
git -C camstack-viewer commit -m "feat(recording): availability -> merged timeline coverage"
```

### Task 6: Recording data hooks (viewer)

**Files:**
- Create: `camstack-viewer/srcV2/data/use-recording.ts`

- [ ] **Step 1: Implement the hooks**

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { availabilityToCoverage, type AvailabilitySpan } from '../recording/recording-availability.js'
import type { TimeRange } from '../timeline/coverage.js'

export type RecordingMode = 'off' | 'events' | 'continuous'

/** Merged "has footage" coverage for [fromMs,toMs]; [] when none / not connected. */
export function useRecordingAvailability(
  deviceId: number, fromMs: number, toMs: number, enabled: boolean,
): UseQueryResult<TimeRange[]> {
  const { controller, state } = useConnection()
  return useQuery<TimeRange[]>({
    queryKey: ['v2', 'recording', 'availability', deviceId, fromMs, toMs],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      try {
        const res = await system.trpcClient.recording.getAvailability.query({ deviceId, fromMs, toMs })
        const spans = (res?.ranges ?? []) as AvailabilitySpan[]
        return availabilityToCoverage(spans)
      } catch { return [] }
    },
  })
}

/** Authoritative recorder mode (never inferred from rules). */
export function useRecordingMode(deviceId: number, enabled: boolean): UseQueryResult<RecordingMode> {
  const { controller, state } = useConnection()
  return useQuery<RecordingMode>({
    queryKey: ['v2', 'recording', 'mode', deviceId],
    enabled: enabled && state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return 'off'
      try {
        const cfg = await system.trpcClient.recording.getDeviceConfig.query({ deviceId })
        const mode = (cfg as { mode?: string } | null)?.mode
        return mode === 'continuous' || mode === 'events' ? mode : 'off'
      } catch { return 'off' }
    },
  })
}
```

- [ ] **Step 2: Type-check** — `cd camstack-viewer && npm run ts-check` → exit 0. (If `recording` is missing on `trpcClient`'s type, the SDK types need regen against `feat/recording-modes-and-videoclips`; note it and proceed — the calls are structurally correct.)

- [ ] **Step 3: Commit**

```bash
git -C camstack-viewer add srcV2/data/use-recording.ts
git -C camstack-viewer commit -m "feat(recording): availability + mode tRPC hooks"
```

### Task 7: `EmbedMode` adds `recording` (viewer)

**Files:**
- Modify: `camstack-viewer/srcV2/grid-embed/embed-url.ts`

- [ ] **Step 1: Extend the union**

```ts
export type EmbedMode = 'grid' | 'player' | 'recording'
```
(No other change — `buildGridEmbedUrl(serverUrl, 'recording')` now type-checks; it returns `…/embed/?mode=recording`.)

- [ ] **Step 2: Type-check** — `npm run ts-check` → exit 0.

- [ ] **Step 3: Commit**

```bash
git -C camstack-viewer add srcV2/grid-embed/embed-url.ts
git -C camstack-viewer commit -m "feat(recording): add 'recording' embed mode to the url builder"
```

### Task 8: `RecordingPlayerWebView` (viewer controller)

**Files:**
- Create: `camstack-viewer/srcV2/live/RecordingPlayerWebView.tsx`

Mirror `LiveViewWebView`: load `buildGridEmbedUrl(serverUrl, 'recording')`, inject `window.__CAMSTACK_RECORDING__`, drive via `recordingCommandScript`, parse `postMessage` via `parseRecordingHostMessage`. Expose an imperative handle (`seekTo/play/pause`) and `onState`/`onPosition` callbacks.

- [ ] **Step 1: Implement**

```tsx
import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useServer } from '../app/ServerProvider.js'
import { buildGridEmbedUrl } from '../grid-embed/embed-url.js'
import {
  parseRecordingHostMessage,
  recordingCommandScript,
  type RecordingReportState,
} from '../recording/recording-messages.js'

export interface RecordingPlayerHandle {
  seekTo: (epochMs: number) => void
  play: () => void
  pause: () => void
}

interface RecordingPlayerWebViewProps {
  readonly deviceId: number
  /** Initial playhead (epoch ms); the page auto-seeks here on load. */
  readonly startMs: number
  readonly onState?: (state: RecordingReportState, message?: string) => void
  readonly onPosition?: (epochMs: number) => void
}

export const RecordingPlayerWebView = forwardRef<RecordingPlayerHandle, RecordingPlayerWebViewProps>(
  function RecordingPlayerWebView({ deviceId, startMs, onState, onPosition }, ref) {
    const { server, token } = useServer()
    const webViewRef = useRef<WebView>(null)
    const serverUrl = server?.serverUrl ?? null

    const inject = useCallback((js: string) => { webViewRef.current?.injectJavaScript(js) }, [])
    useImperativeHandle(ref, () => ({
      seekTo: (epochMs) => inject(recordingCommandScript({ kind: 'seekTo', epochMs })),
      play: () => inject(recordingCommandScript({ kind: 'play' })),
      pause: () => inject(recordingCommandScript({ kind: 'pause' })),
    }), [inject])

    const frameRef = useRef<{ w: number; h: number } | null>(null)
    const applyFrame = useCallback(() => {
      const f = frameRef.current
      if (f) inject(recordingCommandScript({ kind: 'fit', w: f.w, h: f.h }))
    }, [inject])
    const onLayout = useCallback((e: LayoutChangeEvent) => {
      const w = Math.round(e.nativeEvent.layout.width)
      const h = Math.round(e.nativeEvent.layout.height)
      const prev = frameRef.current
      if (prev && prev.w === w && prev.h === h) return
      frameRef.current = { w, h }
      applyFrame()
    }, [applyFrame])

    const onMessage = useCallback((e: WebViewMessageEvent) => {
      const msg = parseRecordingHostMessage(e.nativeEvent.data)
      if (!msg) return
      if (msg.type === 'state') onState?.(msg.state, msg.message)
      else onPosition?.(msg.positionMs)
    }, [onState, onPosition])

    if (!serverUrl) return <View style={styles.fill} />

    const injectedBefore = `window.__CAMSTACK_RECORDING__ = ${JSON.stringify({
      serverUrl, token: token ?? '', deviceId, startMs,
    })}; true;`

    return (
      <View style={styles.fill} onLayout={onLayout}>
        <WebView
          ref={webViewRef}
          source={{ uri: buildGridEmbedUrl(serverUrl, 'recording') }}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={injectedBefore}
          onMessage={onMessage}
          onLoadEnd={applyFrame}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          style={styles.fill}
          containerStyle={styles.fill}
        />
      </View>
    )
  },
)

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: '#000' } })
```

- [ ] **Step 2: Type-check** — `npm run ts-check` → exit 0. (Confirm `useServer()` exposes `{ server, token }` as in `LiveViewWebView`/`GridLiveEmbed`.)

- [ ] **Step 3: Commit**

```bash
git -C camstack-viewer add srcV2/live/RecordingPlayerWebView.tsx
git -C camstack-viewer commit -m "feat(recording): WKWebView VOD player controller"
```

### Task 9: Wire real coverage into the timeline

**Files:**
- Modify: `camstack-viewer/srcV2/components/camera/theater/TheaterTimeline.tsx`
- Modify: `camstack-viewer/srcV2/components/camera/theater/HeatmapBar.tsx`

- [ ] **Step 1: Fetch coverage for the visible day** — in `TheaterTimeline`, alongside the existing `useEvents(deviceId, dayWindow.from, dayWindow.to)`, add:

```tsx
import { useRecordingAvailability } from '../../../data/use-recording.js'
// inside the component, reusing the existing dayWindow:
const { data: coverage = [] } = useRecordingAvailability(deviceId, dayWindow.from, dayWindow.to, true)
```

- [ ] **Step 2: Pass coverage to `HeatmapBar`** — replace the mock `recorded` backdrop source. Add a `coverage: readonly { startMs: number; endMs: number }[]` prop to `HeatmapBar` and render the dark "has footage" band from it (map each range to `left%/width%` over the day window) instead of `mock-data`'s `recorded`. Keep the motion/audio bins + event ticks unchanged.

```tsx
// HeatmapBar props add:
readonly coverage?: readonly { readonly startMs: number; readonly endMs: number }[]
readonly dayStartMs: number
readonly dayEndMs: number
// render (over the existing backdrop layer):
{(coverage ?? []).map((r, i) => {
  const span = dayEndMs - dayStartMs
  const left = ((r.startMs - dayStartMs) / span) * 100
  const width = ((r.endMs - r.startMs) / span) * 100
  return <View key={i} style={[styles.coverageBand, { left: `${left}%`, width: `${width}%` }]} />
})}
```
Add `coverageBand` to the HeatmapBar stylesheet (e.g. `{ position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(120,30,30,0.55)' }`).

- [ ] **Step 3: Type-check + tests** — `npm run ts-check` → exit 0; `npm run test:v2` → all pass (the `mock-data` tests still pass; coverage is additive). Update `mock-data` usages so `recorded` is no longer read by `HeatmapBar` (leave the generator for the other mock bins).

- [ ] **Step 4: Commit**

```bash
git -C camstack-viewer add srcV2/components/camera/theater/TheaterTimeline.tsx srcV2/components/camera/theater/HeatmapBar.tsx
git -C camstack-viewer commit -m "feat(recording): real getAvailability coverage on the timeline"
```

### Task 10: VOD mode in camera detail (tap-to-play / return-to-live)

**Files:**
- Modify: `camstack-viewer/srcV2/screens/CameraDetailScreen.tsx`
- Modify: `camstack-viewer/srcV2/components/camera/theater/TheaterTimeline.tsx`

- [ ] **Step 1: Add a `onSeekToTime` callback up from the timeline** — `TheaterTimeline` already maps scroll/rows to time. Add a prop `onSeekToTime?: (epochMs: number) => void` and call it when the user taps a covered time (a row tap, or a tap on the `HeatmapBar` mapped to epoch via `dayStart + fraction*span`). Only fire when the tapped time is within `coverage` (use `isCovered` from `timeline/coverage.ts`; snap to `nearestCoveredEdge` otherwise).

- [ ] **Step 2: VOD state in `CameraDetailScreen`**

```tsx
import { RecordingPlayerWebView, type RecordingPlayerHandle } from '../live/RecordingPlayerWebView.js'
// state:
const [vodStartMs, setVodStartMs] = useState<number | null>(null) // null = live
const recRef = useRef<RecordingPlayerHandle>(null)
```

- [ ] **Step 3: Swap the surface** — in the video-box render, when `vodStartMs !== null` render `<RecordingPlayerWebView ref={recRef} deviceId={deviceId} startMs={vodStartMs} onState={…} />` INSTEAD of the live surface; otherwise render the live surface unchanged. Pass `onSeekToTime={(ms) => { vodStartMs === null ? setVodStartMs(ms) : recRef.current?.seekTo(ms) }}` into `TheaterTimeline`.

- [ ] **Step 4: Return-to-live** — the timeline already has a "● LIVE / ↑ Go to live" affordance; wire its press to `setVodStartMs(null)` (back to the live surface). Keep the existing live `isLive` scroll logic for the list.

- [ ] **Step 5: Type-check + build** — `npm run ts-check` → 0; `npm run test:v2` → pass.

- [ ] **Step 6: Device verify (manual, against the hub)** — on a camera with footage: tap a covered time → recorded HLS plays from there; tap another covered time → re-seeks; pause/play works; "Go to live" returns to the live stream; an uncovered tap snaps to the nearest covered edge (or shows "no footage").

- [ ] **Step 7: Commit**

```bash
git -C camstack-viewer add srcV2/screens/CameraDetailScreen.tsx srcV2/components/camera/theater/TheaterTimeline.tsx
git -C camstack-viewer commit -m "feat(recording): VOD playback from the timeline (tap-to-play, return-to-live)"
```

### Task 11: Phase-1 verification pass

- [ ] **Step 1:** `cd camstack-viewer && npm run ts-check && npm run test:v2` → ts clean, all tests pass.
- [ ] **Step 2:** `cd camstack-server/packages/addon-pipeline && npx tsc -p embed/tsconfig.json && npm run build && camstack deploy . --no-build --server https://localhost:4443` → tsc 0, built, **Hub healthy**.
- [ ] **Step 3:** Confirm the served bundle has the recording page: `curl -sk https://localhost:4443/addon/stream-broker/embed/?mode=recording` returns the embed HTML (200).
- [ ] **Step 4:** Device-retest the Task-10 Step-6 checklist on the iOS dev build.

---

## Roadmap — Phase 2 & 3 (separate plans, gated by sequencing)

These are **not** execution-ready tasks here — each gets its own detailed plan. Documented so the architecture is locked.

### Phase 2 — Scrub de-risk spike (go/no-go) — *own plan*
Re-target the existing `2026-06-13-srcv2-ios-scrub-spike.md` to the **chosen architecture (WebCodecs in the hub embed)**, not the native `AVAssetImageGenerator` path. Build a throwaway `?mode=recording&spike=1` (or a `_spike` page) that, given a real `low.m3u8` window: mp4box-demuxes one `.m4s` → `VideoDecoderConfig` + chunks; `VideoDecoder.isConfigSupported` on WKWebView ≥ 16.4; coarse keyframe-jump render latency; exact decode-forward latency (≤ ~1 GOP); 60s memory flat. **GO** ⇒ Phase 3; **NO-GO** ⇒ fall back to native `AVAssetImageGenerator` or coarse-only `<video>` seek. Record findings in the spike doc.

### Phase 3 — `ScrubEngine` in the recording embed — *own plan*
Per `2026-06-13-viewer-scrub-client-design.md` §4, add to `EmbedRecordingPage` a WebCodecs scrub path that activates during a drag and hands back to the HLS `<video>` on release:
- `TimelineModel` (epoch↔segment index from `low.m3u8`), `SegmentSource` (206 Range-fetch + LRU + prefetch N±1), `Demuxer` (mp4box), `DecoderPool` (reuse across contiguous same-config segments), `ScrubQueue` (latest-wins, rAF-coalesced), `Renderer` (`VideoFrame`→canvas, `close()` always).
- Two-tier: coarse keyframe-jump during drag (~GOP granularity) + exact decode-forward on settle.
- Host commands extend `recording-messages.ts`: `scrubStart`, `scrubTo(epochMs)`, `scrubEnd` → on `scrubEnd` resume HLS `<video>` at the settled epoch (no black flash: keep the last canvas frame until `<video>` paints — reuse the Phase-1 retained-frame idea).
- Endpoint failover (LAN→relay via `orderedPlaybackEndpoints`), gap handling, segment-not-finalized clamp, `isConfigSupported` fallback.

### Out of scope here (future plan)
**Clips / Eventi** (`videoclips` cap, §4 of the integration notes) — list + thumbnails + `getClipPlayback` feeding the SAME `EmbedRecordingPage`. Independent of VOD/scrub; its own plan.

---

## Self-Review

**Spec coverage (vs `2026-06-15-viewer-recording-integration-notes.md`):**
- §0 transport (hub origin, token-in-path) → embed loads from hub origin (Task 2/8); ✓
- §1 continuous VOD HLS + getPlaybackManifest → Tasks 2, 8, 10; ✓
- §1 getAvailability coverage → Tasks 5, 6, 9; ✓
- §2 mode (getDeviceConfig.mode) → Task 6 `useRecordingMode` (consumed for 24h-vs-Eventi emphasis; Eventi UI is the deferred clips plan); ✓ (read wired; UI emphasis lands with clips)
- §3 scrub (low + WebCodecs) → Phase 2/3 roadmap (sequenced after VOD); ✓ deferred by design
- §4 clips/Eventi → explicitly deferred to its own plan; ✓
- §5 player integration (HLS shared by VOD + clips; timeline; mode-aware) → Phase 1 builds the shared HLS surface + timeline; clips reuse it later; ✓
- §6 live-verify → Task 11 + Task 10 Step 6; ✓

**Placeholder scan:** every code step carries full code. Roadmap (Phase 2/3) is explicitly labelled non-execution-ready, not task-stubs. ✓

**Type consistency:** `RecordingReportState` / `RecordingHostMessage` / `RecordingCommand` names match across `recording-messages.ts` (Task 4), `RecordingPlayerWebView` (Task 8), and the embed page's local `RecState`/`RecMessage` (the embed and viewer are separate bundles — the embed need not import the viewer types, but the string values MUST match: `idle|loading|playing|paused|ended|error` and command shapes `seekTo/play/pause/setRate/fit`). Verified identical. `TimeRange = { startMs, endMs }` used consistently (Tasks 5, 6, 9). ✓

**Known follow-up:** SDK `trpcClient.recording.*` / the `videoclips` cap require the hub running `feat/recording-modes-and-videoclips` + a regen of `@camstack/sdk` types in the viewer; flagged in Task 6 Step 2.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-15-srcv2-recording-playback-scrub-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task with review between tasks; fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Phase 1 is execution-ready now; Phase 2 (spike) and Phase 3 (ScrubEngine) get their own plans, in that order.
