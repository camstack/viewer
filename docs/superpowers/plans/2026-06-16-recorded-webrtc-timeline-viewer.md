# Recorded Playback over WebRTC — VIEWER Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **DEPENDENCY:** This plan consumes the server control protocol delivered by `camstack-server/docs/superpowers/plans/2026-06-16-recorded-webrtc-timeline-server.md`. The player embed must already expose `window.__camstackEmbed.playRecorded/seek/scrubCommit/scrubStart/scrubTo/scrubEnd/setRate/goLive` and forward `{type:'recState',state}` + `{type:'position',positionMs}` host messages. Do not start until the server plan's Task 11 passes on device.

**Goal:** Unify recorded playback onto the *same* live WebRTC surface — the timeline scroll/drag drives playback directly (no tap gate), seek never tears down the connection, and the screen shows one continuous surface (LIVE ↔ recorded clock) with a Go-Live pill and ±10 s jog. Retire the native HLS recording embed (keep it only as the web fallback).

**Architecture:** Today `CameraDetailScreen` swaps between `LiveView` (live) and `RecordingPlayerWebView` (HLS VOD) based on `vodStartMs`, and the `scrub-controller` gates all scrub→embed messages behind `vodActiveRef` (so scrolling the timeline in live mode does nothing). We collapse to a single `LiveView` (the WebView player embed) that handles both live and recorded via the server control channel. The timeline always drives the live surface: drag → `scrubStart/scrubTo` (embed-local WebCodecs canvas) → release → `scrubCommit` (server seeks the WebRTC stream); tap → `seek`; Go-Live → `goLive`. Playback state (`recState`/`position`) flows back from the embed to drive a status chip and the timeline cursor. `RecordingPlayerWebView` is removed from the native render path; the `*.web.tsx` HLS fallback stays.

**Tech Stack:** Expo ~54 / React Native 0.81 / React 19 / TypeScript 5.9. WebView player embed (iOS WebKit, HEVC). Tests: vitest (`npx vitest run`), `npm run ts-check`, `npx eslint <file>` (repo `npm run lint` is broken — lint per file). Native runtime: Metro app reload (NOT an embed deploy) to pick up changes.

**Repo:** `camstack-viewer` only. Paths below are relative to `/Users/alice/Documents/Git/camstack/camstack-viewer`.

---

## Pre-flight: orientation (read before Task 1)

- **Scrub controller:** `srcV2/recording/scrub-controller.ts` — pure `scrubReducer` over `ScrubState { scrubbing, scrubEpoch, playheadEpoch, lastSource }`; actions `begin|update|end|seek|playhead`; `shouldEmit(lastMs, now, 70)`; `cursorFractionFor(state, day)`; `useScrubController(recRef, vodActiveRef, onEnterVod)`. The hook currently bridges to a `RecordingPlayerHandle` (`recRef`) and **gates every call on `vodActiveRef.current`** — this gate is what we remove. Tests: `srcV2/recording/__tests__/scrub-controller.spec.ts`.
- **Camera screen:** `srcV2/screens/CameraDetailScreen.tsx` — holds `vodStartMs` state; renders `RecordingPlayerWebView` when `vodStartMs !== null`, else `PausedPoster`/`LiveView`; `vodActiveRef.current = vodStartMs !== null` (line ~196); VOD exit chip (lines ~485-496); wires `TheaterTimeline` gesture props to `scrub.*` (lines ~520-547).
- **Live surface:** `srcV2/live/LiveView.tsx` (dispatcher) → `LiveViewWebView.tsx` (iOS, the player embed in a WKWebView) / `LiveViewNative.tsx` (Android) / `LiveView.web.tsx` (web). `LiveViewHandle` (`srcV2/live/live-view-types.ts`) currently = `{ startPip(); getStats() }`. The embed host bridge: `injectJavaScript('window.__camstackEmbed.<fn>(...)')` out, `onMessage` in (`{type:'state'|'stats'}`).
- **Recording messages:** `srcV2/recording/recording-messages.ts` — `RecordingCommand` (`seekTo|play|pause|setRate|fit|scrubStart|scrubTo|scrubEnd`), `RecordingHostMessage` (`state|position|log`), `recordingCommandScript(cmd)`, `parseRecordingHostMessage(raw)`. We reuse the command/message shapes but route them through the **live** surface now.
- **Recording player (to retire on native):** `srcV2/live/RecordingPlayerWebView.tsx` — the standalone HLS VOD WebView. `RecordingPlayerHandle` = `{ seekTo, play, pause, scrubStart, scrubTo, scrubEnd }`.
- **Timeline:** `srcV2/components/camera/theater/TheaterTimeline.tsx` — gesture props `onSeekToTime`, `onScrubStart/onScrubToTime/onScrubEnd` (heatmap), `onTimelineScrubStart/To/End`, `onTimelineSeek`; state props `playheadEpoch`, `scrubEpoch`, `scrubbing`; status pill "● LIVE" / "↑ Go to live"; `nowMs = Date.now()`. Geometry: `timeline-geometry.ts` (`offsetToEpoch`/`epochToOffset`).

**Verify loop:**
```bash
cd /Users/alice/Documents/Git/camstack/camstack-viewer
npm run ts-check
npx vitest run
npx eslint srcV2/<changed-file>        # per file; npm run lint is broken
# native: reload the Metro app (r in Metro, or shake → Reload) — no embed deploy needed for RN changes
```

---

## File Structure (what gets created / modified)

- Create `srcV2/recording/playback-status.ts` — pure status-chip derivation (LIVE vs clock).
- Create `srcV2/live/live-control-map.ts` — pure map from a unified `PlaybackCommand` to the embed host-bridge call (the injected `window.__camstackEmbed.*` script).
- Modify `srcV2/live/live-view-types.ts` — extend `LiveViewHandle` with recorded-control methods; extend `LiveViewProps` with `onPlaybackState`/`onPosition`.
- Modify `srcV2/live/LiveViewWebView.tsx` — implement the new handle methods (inject control) + parse `recState`/`position` host messages.
- Modify `srcV2/recording/scrub-controller.ts` — drop the `vodActiveRef` gate; bridge to a generic `PlaybackControlSink` that is always active.
- Modify `srcV2/screens/CameraDetailScreen.tsx` — single surface, remove `RecordingPlayerWebView` mount + `vodStartMs` swap, wire timeline → `liveRef` control, status chip + Go-Live pill, ±10 s jog.
- Modify `srcV2/live/LiveViewNative.tsx` (Android) + `LiveView.web.tsx` (web) — accept the extended handle (Android: same embed-less path can no-op recorded control for v1 OR route through the embed; web: keep HLS fallback).
- Retire from native render path: `srcV2/live/RecordingPlayerWebView.tsx` (kept on disk for the web fallback only).

---

## Task 1: Playback-status derivation (pure)

The status chip shows **LIVE** when live, else the playhead clock (e.g. "12:47:03"). Pure function — easy TDD.

**Files:**
- Create: `srcV2/recording/playback-status.ts`
- Test: `srcV2/recording/__tests__/playback-status.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { derivePlaybackStatus } from '../playback-status'

describe('derivePlaybackStatus', () => {
  it('shows LIVE when mode is live', () => {
    expect(derivePlaybackStatus({ mode: 'live', playheadEpoch: null })).toEqual({ isLive: true, label: 'LIVE', showGoLive: false })
  })
  it('shows the playhead clock when playing/paused', () => {
    const epoch = new Date('2026-06-16T12:47:03Z').getTime()
    const r = derivePlaybackStatus({ mode: 'playing', playheadEpoch: epoch })
    expect(r.isLive).toBe(false)
    expect(r.showGoLive).toBe(true)
    expect(r.label).toMatch(/47:03$/) // HH:MM:SS, local tz; assert the m:s tail
  })
  it('falls back to LOADING label when recorded but no playhead yet', () => {
    expect(derivePlaybackStatus({ mode: 'loading', playheadEpoch: null })).toEqual({ isLive: false, label: '…', showGoLive: true })
  })
  it('shows a gap label when in a no-footage region', () => {
    expect(derivePlaybackStatus({ mode: 'gap', playheadEpoch: null }).label).toBe('No footage')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/recording/__tests__/playback-status.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type PlaybackMode = 'live' | 'loading' | 'playing' | 'paused' | 'gap' | 'error'

export interface PlaybackStatusInput {
  readonly mode: PlaybackMode
  readonly playheadEpoch: number | null
}

export interface PlaybackStatus {
  readonly isLive: boolean
  readonly label: string
  readonly showGoLive: boolean
}

function clock(epochMs: number): string {
  const d = new Date(epochMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function derivePlaybackStatus(input: PlaybackStatusInput): PlaybackStatus {
  if (input.mode === 'live') return { isLive: true, label: 'LIVE', showGoLive: false }
  if (input.mode === 'gap') return { isLive: false, label: 'No footage', showGoLive: true }
  if (input.mode === 'error') return { isLive: false, label: 'Error', showGoLive: true }
  if (input.playheadEpoch == null) return { isLive: false, label: '…', showGoLive: true }
  return { isLive: false, label: clock(input.playheadEpoch), showGoLive: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run srcV2/recording/__tests__/playback-status.spec.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add srcV2/recording/playback-status.ts srcV2/recording/__tests__/playback-status.spec.ts
git commit -m "feat(viewer): pure playback-status chip derivation"
```

---

## Task 2: Unified playback-command → embed bridge map (pure)

Map a single `PlaybackCommand` union to the exact `window.__camstackEmbed.*` injection string. Pure and testable; the actual `injectJavaScript` happens in Task 3.

**Files:**
- Create: `srcV2/live/live-control-map.ts`
- Test: `srcV2/live/__tests__/live-control-map.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { playbackCommandToScript } from '../live-control-map'

describe('playbackCommandToScript', () => {
  it('emits playRecorded', () => {
    expect(playbackCommandToScript({ kind: 'playRecorded', deviceId: 99, epochMs: 6000, profile: 'mid' }))
      .toContain('window.__camstackEmbed.playRecorded(99,6000,"mid")')
  })
  it('emits seek and scrubCommit', () => {
    expect(playbackCommandToScript({ kind: 'seek', epochMs: 6000 })).toContain('window.__camstackEmbed.seek(6000)')
    expect(playbackCommandToScript({ kind: 'scrubCommit', epochMs: 6000 })).toContain('window.__camstackEmbed.scrubCommit(6000)')
  })
  it('emits drag commands (embed-local WebCodecs)', () => {
    expect(playbackCommandToScript({ kind: 'scrubStart' })).toContain('window.__camstackEmbed.scrubStart()')
    expect(playbackCommandToScript({ kind: 'scrubTo', epochMs: 6000 })).toContain('window.__camstackEmbed.scrubTo(6000)')
    expect(playbackCommandToScript({ kind: 'scrubEnd', epochMs: 6000 })).toContain('window.__camstackEmbed.scrubEnd(6000)')
  })
  it('emits setRate and goLive', () => {
    expect(playbackCommandToScript({ kind: 'setRate', rate: 0 })).toContain('window.__camstackEmbed.setRate(0)')
    expect(playbackCommandToScript({ kind: 'goLive' })).toContain('window.__camstackEmbed.goLive()')
  })
  it('always returns a trailing true; for the WebView injection contract', () => {
    expect(playbackCommandToScript({ kind: 'goLive' }).trim().endsWith('true;')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/live/__tests__/live-control-map.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type PlaybackCommand =
  | { kind: 'playRecorded'; deviceId: number; epochMs: number; profile: string }
  | { kind: 'seek'; epochMs: number }
  | { kind: 'scrubStart' }
  | { kind: 'scrubTo'; epochMs: number }
  | { kind: 'scrubEnd'; epochMs: number }
  | { kind: 'scrubCommit'; epochMs: number }
  | { kind: 'setRate'; rate: 0 | 1 }
  | { kind: 'goLive' }

/** Build the JS to inject into the player WebView. Trailing `true;` is the RN WebView injection contract. */
export function playbackCommandToScript(cmd: PlaybackCommand): string {
  const call = ((): string => {
    switch (cmd.kind) {
      case 'playRecorded': return `window.__camstackEmbed.playRecorded(${cmd.deviceId},${cmd.epochMs},${JSON.stringify(cmd.profile)})`
      case 'seek': return `window.__camstackEmbed.seek(${cmd.epochMs})`
      case 'scrubStart': return `window.__camstackEmbed.scrubStart()`
      case 'scrubTo': return `window.__camstackEmbed.scrubTo(${cmd.epochMs})`
      case 'scrubEnd': return `window.__camstackEmbed.scrubEnd(${cmd.epochMs})`
      case 'scrubCommit': return `window.__camstackEmbed.scrubCommit(${cmd.epochMs})`
      case 'setRate': return `window.__camstackEmbed.setRate(${cmd.rate})`
      case 'goLive': return `window.__camstackEmbed.goLive()`
    }
  })()
  return `try{${call}}catch(e){}; true;`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run srcV2/live/__tests__/live-control-map.spec.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add srcV2/live/live-control-map.ts srcV2/live/__tests__/live-control-map.spec.ts
git commit -m "feat(viewer): pure playback-command -> embed injection map"
```

---

## Task 3: Extend the live surface handle + WebView bridge

Add recorded-control methods to `LiveViewHandle` and `onPlaybackState`/`onPosition` to `LiveViewProps`; implement them in `LiveViewWebView` by injecting `playbackCommandToScript(...)` and parsing the new host messages.

**Files:**
- Modify: `srcV2/live/live-view-types.ts`
- Modify: `srcV2/live/LiveViewWebView.tsx`
- Modify: `srcV2/live/LiveViewNative.tsx`, `srcV2/live/LiveView.web.tsx` (satisfy the type; Android/web can no-op recorded control for v1 — see Task 7)
- Test: `srcV2/live/__tests__/live-view-types.spec.ts` (contract test on the handle method set, optional but cheap)

- [ ] **Step 1: Extend the types**

In `srcV2/live/live-view-types.ts`:

```ts
import type { PlaybackMode } from '../recording/playback-status'

export interface LiveViewHandle {
  startPip(): void
  getStats(): Promise<StreamStats | null>
  // recorded-playback control (routed to the player embed control channel)
  playRecorded(epochMs: number, profile: string): void
  seek(epochMs: number): void
  scrubStart(): void
  scrubTo(epochMs: number): void
  scrubEnd(epochMs: number): void
  setRate(rate: 0 | 1): void
  goLive(): void
}

export interface LiveViewProps {
  // ...existing props...
  readonly onPlaybackState?: (mode: PlaybackMode) => void
  readonly onPosition?: (epochMs: number) => void
}
```

- [ ] **Step 2: Write the failing test (handle contract)**

```ts
import { describe, it, expect } from 'vitest'
import { LIVE_VIEW_HANDLE_METHODS } from '../live-view-types'

describe('LiveViewHandle contract', () => {
  it('declares the recorded-control methods', () => {
    expect(LIVE_VIEW_HANDLE_METHODS).toEqual(
      expect.arrayContaining(['playRecorded', 'seek', 'scrubStart', 'scrubTo', 'scrubEnd', 'setRate', 'goLive']),
    )
  })
})
```

Add the constant to `live-view-types.ts`:
```ts
export const LIVE_VIEW_HANDLE_METHODS = ['startPip', 'getStats', 'playRecorded', 'seek', 'scrubStart', 'scrubTo', 'scrubEnd', 'setRate', 'goLive'] as const
```

- [ ] **Step 3: Run test to verify it fails then passes**

Run: `npx vitest run srcV2/live/__tests__/live-view-types.spec.ts`
Expected: FAIL (constant missing) → after adding the constant, PASS.

- [ ] **Step 4: Implement in `LiveViewWebView`**

In `LiveViewWebView.tsx`, expose the handle via `useImperativeHandle` and inject control:

```ts
import { playbackCommandToScript } from './live-control-map'
import { parseRecordingHostMessage } from '../recording/recording-messages'

const inject = useCallback((cmd: Parameters<typeof playbackCommandToScript>[0]) => {
  webRef.current?.injectJavaScript(playbackCommandToScript(cmd))
}, [])

useImperativeHandle(ref, () => ({
  startPip: () => { /* existing */ },
  getStats: () => { /* existing */ },
  playRecorded: (epochMs, profile) => inject({ kind: 'playRecorded', deviceId, epochMs, profile }),
  seek: (epochMs) => inject({ kind: 'seek', epochMs }),
  scrubStart: () => inject({ kind: 'scrubStart' }),
  scrubTo: (epochMs) => inject({ kind: 'scrubTo', epochMs }),
  scrubEnd: (epochMs) => inject({ kind: 'scrubEnd', epochMs }),
  setRate: (rate) => inject({ kind: 'setRate', rate }),
  goLive: () => inject({ kind: 'goLive' }),
}), [deviceId, inject])
```

Extend the existing `onMessage` handler to parse the recorded host messages (the embed forwards `{type:'recState',state}` and `{type:'position',positionMs}` per the server plan Task 10):

```ts
const onMessage = useCallback((e: WebViewMessageEvent) => {
  const raw = e.nativeEvent.data
  // existing live state/stats handling first...
  const rec = parseRecordingHostMessage(raw)
  if (rec?.type === 'position') { props.onPosition?.(rec.positionMs); return }
  // map the embed's recState into PlaybackMode for the host:
  try {
    const m = JSON.parse(raw)
    if (m?.type === 'recState') { props.onPlaybackState?.(mapRecState(m.state)); return }
  } catch { /* ignore */ }
}, [props])

function mapRecState(s: string): PlaybackMode {
  switch (s) {
    case 'live': return 'live'
    case 'loading': return 'loading'
    case 'playing': return 'playing'
    case 'paused': return 'paused'
    case 'gap': return 'gap'
    default: return 'error'
  }
}
```

- [ ] **Step 5: Satisfy Android + web variants**

In `LiveViewNative.tsx` and `LiveView.web.tsx`, add the new handle methods. For v1, Android native and web can route recorded control through the embed if they use it, or no-op with a `__DEV__` warn if they do not (the recorded surface targets iOS WebView first per the spec). Keep types satisfied:

```ts
useImperativeHandle(ref, () => ({
  startPip: () => {/*…*/}, getStats: () => {/*…*/},
  playRecorded: () => {}, seek: () => {}, scrubStart: () => {}, scrubTo: () => {},
  scrubEnd: () => {}, setRate: () => {}, goLive: () => {},
}), [])
```

> Web keeps the existing HLS recording fallback (`RecordingPlayerWebView` / `LiveView.web.tsx`) — do not delete it. Task 7 confirms the web path.

- [ ] **Step 6: Type-check + lint + commit**

Run:
```bash
npm run ts-check
npx eslint srcV2/live/LiveViewWebView.tsx srcV2/live/live-view-types.ts
npx vitest run srcV2/live/__tests__/live-view-types.spec.ts
```
Expected: clean; PASS.

```bash
git add srcV2/live/live-view-types.ts srcV2/live/LiveViewWebView.tsx srcV2/live/LiveViewNative.tsx srcV2/live/LiveView.web.tsx srcV2/live/__tests__/live-view-types.spec.ts
git commit -m "feat(viewer): recorded-control methods + state/position callbacks on the live surface"
```

---

## Task 4: Remove the `vodActiveRef` gate from the scrub controller

Re-target the controller's bridge from `RecordingPlayerHandle` (gated) to a generic, always-active `PlaybackControlSink`, so a scrub gesture **always** drives preview + commit — no tap required.

**Files:**
- Modify: `srcV2/recording/scrub-controller.ts`
- Test: `srcV2/recording/__tests__/scrub-controller.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react-hooks' // or the repo's hook-test util
import { useScrubController } from '../scrub-controller'

function makeSink() {
  return { scrubStart: vi.fn(), scrubTo: vi.fn(), scrubCommit: vi.fn(), seek: vi.fn() }
}

describe('useScrubController (ungated)', () => {
  it('drives the sink on a drag even when never entering VOD via tap', () => {
    const sink = makeSink()
    const { result } = renderHook(() => useScrubController(sink))
    act(() => result.current.beginScrub('timeline'))
    act(() => result.current.updateScrub(6000, 'timeline'))
    act(() => result.current.endScrub(6000, 'timeline'))
    expect(sink.scrubStart).toHaveBeenCalled()
    expect(sink.scrubTo).toHaveBeenCalledWith(6000)
    expect(sink.scrubCommit).toHaveBeenCalledWith(6000)   // release commits the seek — no gate
  })
  it('a tap issues a direct seek', () => {
    const sink = makeSink()
    const { result } = renderHook(() => useScrubController(sink))
    act(() => result.current.seek(6000, 'heatmap'))
    expect(sink.seek).toHaveBeenCalledWith(6000)
  })
})
```

> Use whatever hook-test utility the repo already uses (check existing `__tests__` for `renderHook`). If none, extract the bridge logic into a pure `makeScrubBridge(sink)` function and test that directly without rendering — preferred, since the reducer is already pure.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run srcV2/recording/__tests__/scrub-controller.spec.ts`
Expected: FAIL — the hook signature still takes `(recRef, vodActiveRef, onEnterVod)`.

- [ ] **Step 3: Refactor the hook signature + bridge**

Replace the gated bridge with a sink interface. Keep `scrubReducer`, `shouldEmit`, `cursorFractionFor` untouched.

```ts
export interface PlaybackControlSink {
  scrubStart(): void
  scrubTo(epochMs: number): void
  scrubCommit(epochMs: number): void
  seek(epochMs: number): void
}

export function useScrubController(sink: PlaybackControlSink): ScrubController {
  const [state, dispatch] = useReducer(scrubReducer, initialScrubState)
  const lastEmitRef = useRef(0)

  const beginScrub = useCallback((source: ScrubSource) => {
    dispatch({ type: 'begin', source })
    sink.scrubStart() // always — no vodActiveRef gate
  }, [sink])

  const updateScrub = useCallback((epoch: number, source: ScrubSource) => {
    dispatch({ type: 'update', epoch, source })
    const now = Date.now()
    if (shouldEmit(lastEmitRef.current, now)) {
      lastEmitRef.current = now
      sink.scrubTo(epoch)
    }
  }, [sink])

  const endScrub = useCallback((epoch: number, source: ScrubSource) => {
    dispatch({ type: 'end', epoch, source })
    sink.scrubCommit(epoch) // release => commit the WebRTC seek
  }, [sink])

  const seek = useCallback((epoch: number, source: ScrubSource) => {
    dispatch({ type: 'seek', epoch, source })
    sink.seek(epoch)
  }, [sink])

  const setPlayhead = useCallback((epoch: number) => dispatch({ type: 'playhead', epoch }), [])

  return { state, beginScrub, updateScrub, endScrub, seek, setPlayhead }
}
```

Remove `vodActiveRef`/`onEnterVod` from `ScrubController` and the hook. Delete the now-dead `RecordingPlayerHandle` import if unused.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run srcV2/recording/__tests__/scrub-controller.spec.ts`
Expected: PASS (existing reducer/throttle/cursor tests + the 2 new ones).

- [ ] **Step 5: Type-check + lint + commit**

Run: `npm run ts-check && npx eslint srcV2/recording/scrub-controller.ts`
Expected: clean (CameraDetailScreen will not yet compile against the new signature — fixed in Task 5; if ts-check fails only on CameraDetailScreen, that's expected and resolved next task).

```bash
git add srcV2/recording/scrub-controller.ts srcV2/recording/__tests__/scrub-controller.spec.ts
git commit -m "feat(viewer): ungate scrub controller — timeline always drives playback"
```

---

## Task 5: Unify `CameraDetailScreen` onto one surface

Collapse the live/VOD swap into a single `LiveView`. Drive control through `liveRef` (the extended handle). Track playback mode + playhead from the surface callbacks. Replace the VOD exit chip with the status chip + Go-Live pill. Remove `RecordingPlayerWebView` from the native render path.

**Files:**
- Modify: `srcV2/screens/CameraDetailScreen.tsx`
- Test: covered by the pure units (Tasks 1, 2, 4) + device verification (Task 8). Add a small pure helper test only if new logic warrants it.

- [ ] **Step 1: Replace VOD state with playback mode + playhead**

Remove `vodStartMs`, `vodActiveRef`, `onEnterVod`, `onExitVod`, `recRef`. Add:

```ts
const liveRef = useRef<LiveViewHandle>(null)
const [mode, setMode] = useState<PlaybackMode>('live')
const [playheadEpoch, setPlayheadEpoch] = useState<number | null>(null)

const sink: PlaybackControlSink = useMemo(() => ({
  scrubStart: () => liveRef.current?.scrubStart(),
  scrubTo: (epochMs) => liveRef.current?.scrubTo(epochMs),
  scrubCommit: (epochMs) => liveRef.current?.scrubCommit?.(epochMs) ?? liveRef.current?.seek(epochMs),
  seek: (epochMs) => liveRef.current?.seek(epochMs),
}), [])
const scrub = useScrubController(sink)
```

> `scrubCommit` and `seek` both map to a server seek; expose `scrubCommit` on the handle (Task 3 adds `scrubCommit` via the embed) OR alias it to `seek`. Keep one. The line above tolerates either.

- [ ] **Step 2: Render a single surface**

Replace the `vodStartMs !== null ? <RecordingPlayerWebView/> : ... : <LiveView/>` block with just:

```tsx
<LiveView
  ref={liveRef}
  deviceId={deviceId}
  muted={muted}
  target={liveTarget}
  showStats={statsOn && useWebViewPlayer}
  highlight={useWebViewPlayer ? embedHighlight : undefined}
  onPlaybackState={setMode}
  onPosition={(epochMs) => { setPlayheadEpoch(epochMs); scrub.setPlayhead(epochMs) }}
/>
```

- [ ] **Step 3: Status chip + Go-Live pill**

```tsx
const status = derivePlaybackStatus({ mode, playheadEpoch })
// in the overlay:
<StatusChip live={status.isLive} label={status.label} />
{status.showGoLive && (
  <Pressable onPress={() => { liveRef.current?.goLive(); setMode('live'); setPlayheadEpoch(null) }}>
    <Text>● Go Live</Text>
  </Pressable>
)}
```

Reuse the existing chip/pill styles from the old VOD exit chip (lines ~485-496) — repurpose, don't invent new visuals.

- [ ] **Step 4: Timeline wiring (unchanged gesture props, new cursor source)**

The `TheaterTimeline` gesture props already point at `scrub.*` (lines ~520-547) — keep them. Feed the cursor from the controller state:

```tsx
<TheaterTimeline
  /* …existing toolbar props… */
  onSeekToTime={(epoch) => scrub.seek(epoch, 'heatmap')}
  onScrubStart={() => scrub.beginScrub('heatmap')}
  onScrubToTime={(epoch) => scrub.updateScrub(epoch, 'heatmap')}
  onScrubEnd={(epoch) => scrub.endScrub(epoch, 'heatmap')}
  onTimelineScrubStart={() => scrub.beginScrub('timeline')}
  onTimelineScrubTo={(epoch) => scrub.updateScrub(epoch, 'timeline')}
  onTimelineScrubEnd={(epoch) => scrub.endScrub(epoch, 'timeline')}
  onTimelineSeek={(epoch) => scrub.seek(epoch, 'timeline')}
  playheadEpoch={scrub.state.playheadEpoch}
  scrubEpoch={scrub.state.scrubEpoch}
  scrubbing={scrub.state.scrubbing}
/>
```

The first scroll/tap away from the live edge now issues `scrubCommit`/`seek`, which the embed turns into `playRecorded`/`seek` on the server (server Task 8 treats `seek` while in live mode as entering recorded). No explicit `playRecorded` call is needed from the screen, but if a cleaner first-entry is desired, call `liveRef.current?.playRecorded(epoch, 'mid')` on the first `seek` while `mode==='live'`.

- [ ] **Step 5: Remove the native RecordingPlayerWebView import**

Delete the `import RecordingPlayerWebView` and its usage from `CameraDetailScreen.tsx`. Leave the file on disk (web fallback, Task 7).

- [ ] **Step 6: Type-check + lint**

Run:
```bash
npm run ts-check
npx eslint srcV2/screens/CameraDetailScreen.tsx
npx vitest run
```
Expected: ts-check clean (the Task 4 cross-file error is now resolved); full vitest suite green.

- [ ] **Step 7: Commit**

```bash
git add srcV2/screens/CameraDetailScreen.tsx
git commit -m "feat(viewer): unify camera detail onto one WebRTC surface, no tap gate"
```

---

## Task 6: ±10 s jog FAB

Adopt External hub's relative jog (in v1 per the spec gate). Two buttons that issue `seek(playhead ± 10000)`.

**Files:**
- Modify: `srcV2/screens/CameraDetailScreen.tsx` (or the existing `TimelineFabControls` if jog belongs there)
- Test: pure clamp helper in `srcV2/recording/playback-status.ts` or a small `jog.ts`

- [ ] **Step 1: Write the failing test**

Add to `playback-status.spec.ts` (or a new `jog.spec.ts`):

```ts
import { jogTarget } from '../playback-status'

describe('jogTarget', () => {
  it('adds/subtracts 10s from the current playhead', () => {
    expect(jogTarget(100000, +1)).toBe(110000)
    expect(jogTarget(100000, -1)).toBe(90000)
  })
  it('returns null when there is no playhead (live)', () => {
    expect(jogTarget(null, +1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run + implement**

Run (FAIL): `npx vitest run srcV2/recording/__tests__/playback-status.spec.ts`

Add to `playback-status.ts`:
```ts
export const JOG_MS = 10_000
export function jogTarget(playheadEpoch: number | null, dir: 1 | -1): number | null {
  if (playheadEpoch == null) return null
  return playheadEpoch + dir * JOG_MS
}
```

- [ ] **Step 3: Wire the FAB**

In the screen overlay (only shown when `!status.isLive`):
```tsx
{!status.isLive && (
  <View style={styles.jogRow}>
    <Pressable onPress={() => { const t = jogTarget(playheadEpoch, -1); if (t != null) liveRef.current?.seek(t) }}><Text>−10s</Text></Pressable>
    <Pressable onPress={() => { const t = jogTarget(playheadEpoch, +1); if (t != null) liveRef.current?.seek(t) }}><Text>+10s</Text></Pressable>
  </View>
)}
```

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run srcV2/recording/__tests__/playback-status.spec.ts && npm run ts-check && npx eslint srcV2/screens/CameraDetailScreen.tsx`
Expected: PASS + clean.

```bash
git add srcV2/recording/playback-status.ts srcV2/recording/__tests__/playback-status.spec.ts srcV2/screens/CameraDetailScreen.tsx
git commit -m "feat(viewer): ±10s jog on the recorded playhead"
```

---

## Task 7: Confirm the web HLS fallback is unaffected

The native path now uses the WebRTC surface for recorded. The web build keeps the HLS recording fallback. Confirm web still type-checks/builds and the `*.web.tsx` files still mount the HLS player.

**Files:**
- Inspect: `srcV2/live/LiveView.web.tsx`, `srcV2/live/RecordingPlayerWebView.tsx` (web usage)
- No code change unless the type extension (Task 3) broke the web variant.

- [ ] **Step 1: Type-check the web entry**

Run: `npm run ts-check` (covers all platforms) and the web build if present:
```bash
npm run build:web 2>/dev/null || echo "no build:web script — skip"
```
Expected: clean. If the web `LiveViewHandle` impl is missing new methods, add no-op/HLS-routed stubs (Task 3 Step 5).

- [ ] **Step 2: Commit (only if web stubs were added)**

```bash
git add srcV2/live/LiveView.web.tsx
git commit -m "chore(viewer): keep web HLS recording fallback compatible with extended handle"
```

---

## Task 8: Device verification (cam 99, Metro reload)

No new code unless a defect surfaces. Native changes need a **Metro app reload** (not an embed deploy). The server plan must be deployed first.

- [ ] **Step 1: Reload the app, open camera 99**

Reload Metro. Open device 99 → expect **LIVE** immediately (unchanged).

- [ ] **Step 2: Scroll the timeline in (former) live mode**

Scroll the vertical timeline back. Expect: status chip flips to the scrubbed clock; the WebCodecs canvas preview updates as you drag (served by the embed, no tap needed — this is the bug the redesign fixes); on release, recorded WebRTC playback renders the landed time within ~150–300 ms; the canvas hides on the first real frame. **No `w:0 h:0`.**

- [ ] **Step 3: Tap-seek, pause/resume, jog, Go-Live**

- Tap a covered heatmap point → direct seek.
- Pause/Play FAB → `setRate(0|1)`.
- −10s / +10s → playhead jumps.
- Go-Live pill → returns to the live edge; chip shows LIVE.

- [ ] **Step 4: Confirm no regression to live**

Multi-client: while this device plays recorded, a second viewer (or the admin UI) on the same camera keeps **live** uninterrupted (the server isolation invariant). Backgrounding/foregrounding still self-heals the live connection.

- [ ] **Step 5: Capture results in the session file**

Record: scrub frame latency, seek-commit → first frame latency, any `w:0 h:0` occurrences (expect none), PLI behavior. Note deferrals (Android/web recorded control, `setProfile`).

---

## Self-Review (run after writing all tasks — completed)

- **Spec coverage (viewer side):** unified surface (one WebRTC player, no HLS embed on native) → T3/T5; timeline drives `scrubCommit`/`seek`/`goLive`/`position` with no `vodActiveRef` gate → T4/T5; WebCodecs drag preview kept (embed-local, driven by `scrubStart`/`scrubTo`) → T2/T3; status chip LIVE-vs-clock + Go-Live pill → T1/T5; ±10 s jog (v1, per gate) → T6; web HLS fallback retained → T7; device verification incl. no `w:0 h:0` + isolation → T8. `setProfile`/quality switch and Android/web recorded control are explicit v1 deferrals (spec: default profile mid, iOS WebView first).
- **Type consistency:** `PlaybackMode` (T1) is the single mode type used by `LiveViewProps.onPlaybackState` (T3) and `CameraDetailScreen` (T5). `PlaybackCommand` (T2) is the injection union; `LiveViewHandle` method names (T3) match the `sink` mapping (T5). `PlaybackControlSink` (T4) method names (`scrubStart/scrubTo/scrubCommit/seek`) match the screen's sink (T5).
- **Placeholders:** none — every code step has concrete code; the one residual (hook-test utility availability) is flagged with the preferred pure-function fallback.

---

## Notes

- The viewer is NATIVE (Metro) — reload the app to pick up these changes; do NOT deploy an embed for RN-only edits. Embed changes belong to the server plan.
- Recordings/control are validated against cam 99. Public device URL `https://camstack.example.com` may cache embed assets — hard-reload after a server embed deploy.
