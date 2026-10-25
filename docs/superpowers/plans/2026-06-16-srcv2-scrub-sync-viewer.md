# Recording Scrub Sync (Native) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the vertical timeline and the heatmap drive recorded-footage navigation through one shared scrub position — scroll/drag both produce a continuous live preview, taps seek, and the playhead reported by the embed moves the cursor on both surfaces.

**Architecture:** A new pure `scrub-controller` (reducer + echo-guard + throttle decision, unit-tested) is the single source of truth for `scrubbing / scrubEpoch / playheadEpoch`, owned by `CameraDetailScreen`. A new pure `timeline-geometry` module maps the vertical list's scroll offset ↔ epoch. `TheaterTimeline` gains timeline-source scrub/seek callbacks and renders its cursor + programmatic scroll from the shared position (echo-guarded so a programmatic scroll never re-emits a gesture). `RecordingPlayerWebView` already exposes the imperative handle and `onPosition`; we connect `onPosition` (currently dropped) into the controller. The native↔embed bridge vocabulary is unchanged.

**Tech Stack:** TypeScript 5.9; Expo / React Native; Zustand-free local reducer (`useReducer`); vitest (`srcV2/**/__tests__/**/*.spec.ts`, `environment: 'node'`). Relative imports use `.js` extensions. Logger: `log.debug/info/warn/error(scope, msg, data?)` from `srcV2/lib/logger.js`.

**Repo:** `camstack-viewer` only. This plan does NOT touch the embed/server — the embed engine is covered by the companion plan `camstack-server/docs/superpowers/plans/2026-06-16-recording-scrub-engine-prod.md`. The two plans are independent and may land in either order (the bridge protocol is unchanged).

**Run tests:** `npx vitest run <spec>` (lint is broken at the repo script level — use `npx eslint <files>`; type-check with `npm run ts-check`).

---

## Already in place (do NOT rebuild)

Verified by code audit on 2026-06-16:

- `HeatmapBar` already fires `onScrubStart` / `onScrubFraction` / `onScrubEnd` (drag) and `onSeekFraction` (tap) from its pan responder (`srcV2/components/camera/theater/HeatmapBar.tsx:127-147`).
- `TheaterTimeline` already accepts + forwards heatmap callbacks `onSeekToTime` / `onScrubStart` / `onScrubToTime` / `onScrubEnd`, snaps fractions via `nearestCoveredEdge`, and renders `coverage` from `useRecordingAvailability` (`TheaterTimeline.tsx:54-81, 213-258, 300-311`).
- `CameraDetailScreen` already owns `vodStartMs` + `recRef`, switches `<LiveView>`↔`<RecordingPlayerWebView>`, and routes heatmap callbacks to `recRef.scrubStart/scrubTo/scrubEnd` / `setVodStartMs` (`CameraDetailScreen.tsx:185-210, 420-527`).
- `RecordingPlayerWebView` exposes `RecordingPlayerHandle { seekTo, play, pause, scrubStart, scrubTo, scrubEnd }` and a prop `onPosition?: (epochMs) => void` that it already calls on inbound `{type:'position'}` — but `CameraDetailScreen` does not pass `onPosition`, so the playhead is dropped today (`RecordingPlayerWebView.tsx:25-32, 83-101`).
- `coverage.ts` exports `TimeRange`, `mergeRanges`, `isCovered`, `nearestCoveredEdge` (`srcV2/timeline/coverage.ts`).
- `mock-data.ts` exports `ZOOM_LEVELS` (`{rowMinutes, spanHours}[]`), `TIMELINE_ROW_HEIGHT = 34`, `TimelineRow { id, hourLabel, isFullHour, bars }`, `buildTimelineRowsPage(nowMs, zoomIndex, pageIndex)`, `snapTopTickMs`, `clampZoomIndex`.

**What is missing (this plan):** the shared `scrub-controller`, the `timeline-geometry` offset↔epoch math, a `tickMs` on each timeline row (so a row tap knows its epoch), wiring the vertical-list scroll/tap to the controller, rendering the cursor + programmatic scroll from the shared position, and connecting `onPosition` → playhead.

---

## File Structure

**New:**
- `srcV2/recording/scrub-controller.ts` — pure reducer + `shouldEcho` + `shouldEmit` + `cursorFractionFor` (unit-tested), plus a thin `useScrubController` hook.
- `srcV2/recording/__tests__/scrub-controller.spec.ts`
- `srcV2/components/camera/theater/timeline-geometry.ts` — `pxPerHour` / `offsetToEpoch` / `epochToOffset` (unit-tested).
- `srcV2/components/camera/theater/__tests__/timeline-geometry.spec.ts`

**Modified:**
- `srcV2/components/camera/theater/mock-data.ts` — add `tickMs: number` to `TimelineRow`; populate in the row builder.
- `srcV2/components/camera/theater/__tests__/mock-data.spec.ts` — assert `tickMs` is the absolute tick epoch.
- `srcV2/components/camera/theater/TimelineListRow.tsx` — make a row pressable → `onPressRow(tickMs)`.
- `srcV2/components/camera/theater/TheaterTimeline.tsx` — new props (`playheadEpoch`, `scrubEpoch`, `scrubbing`, timeline-source callbacks); cursor + programmatic scroll from shared position; scroll→scrub; row tap→seek.
- `srcV2/screens/CameraDetailScreen.tsx` — instantiate `useScrubController`, pass `onPosition`, route both surfaces through the controller.

---

## Task 1: `timeline-geometry` — offset ↔ epoch (pure)

The vertical list's page 0 is the live edge at the top (`topMs`); scrolling **down** (larger `offsetY`) goes **back** in time. Each zoom level fixes `rowMinutes` rows of height `TIMELINE_ROW_HEIGHT`, so `pxPerHour = (60 / rowMinutes) * rowHeight`.

**Files:**
- Create: `srcV2/components/camera/theater/timeline-geometry.ts`
- Test: `srcV2/components/camera/theater/__tests__/timeline-geometry.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { pxPerHour, offsetToEpoch, epochToOffset } from '../timeline-geometry.js'
import { ZOOM_LEVELS, TIMELINE_ROW_HEIGHT } from '../mock-data.js'

const TOP = 1_700_000_000_000 // arbitrary epoch ms

describe('pxPerHour', () => {
  it('derives px/hour from row minutes and row height', () => {
    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      const expected = (60 / ZOOM_LEVELS[z].rowMinutes) * TIMELINE_ROW_HEIGHT
      expect(pxPerHour(z)).toBeCloseTo(expected, 6)
    }
  })
  it('clamps out-of-range zoom indices', () => {
    expect(pxPerHour(-5)).toBe(pxPerHour(0))
    expect(pxPerHour(999)).toBe(pxPerHour(ZOOM_LEVELS.length - 1))
  })
})

describe('offsetToEpoch / epochToOffset', () => {
  it('offset 0 is the live edge (topMs)', () => {
    expect(offsetToEpoch(0, TOP, 2)).toBe(TOP)
  })
  it('scrolling down goes back in time', () => {
    const oneHourPx = pxPerHour(2)
    expect(offsetToEpoch(oneHourPx, TOP, 2)).toBe(TOP - 3_600_000)
  })
  it('round-trips epoch → offset → epoch', () => {
    const epoch = TOP - 5 * 3_600_000
    const off = epochToOffset(epoch, TOP, 2)
    expect(offsetToEpoch(off, TOP, 2)).toBe(epoch)
  })
  it('clamps offset to >= 0 for future epochs', () => {
    expect(epochToOffset(TOP + 3_600_000, TOP, 2)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run srcV2/components/camera/theater/__tests__/timeline-geometry.spec.ts`
Expected: FAIL — `Cannot find module '../timeline-geometry.js'`.

- [ ] **Step 3: Implement the module**

```typescript
import { ZOOM_LEVELS, TIMELINE_ROW_HEIGHT } from './mock-data.js'

const MS_PER_HOUR = 3_600_000

function clampZoom(zoomIndex: number): number {
  return Math.max(0, Math.min(ZOOM_LEVELS.length - 1, Math.trunc(zoomIndex)))
}

/** Vertical pixels that represent one hour at the given zoom level. */
export function pxPerHour(zoomIndex: number): number {
  const level = ZOOM_LEVELS[clampZoom(zoomIndex)]
  return (60 / level.rowMinutes) * TIMELINE_ROW_HEIGHT
}

/** Scroll offset (px from the top; 0 = live edge `topMs`) → epoch ms.
 *  Scrolling down (larger offset) goes back in time. */
export function offsetToEpoch(offsetY: number, topMs: number, zoomIndex: number): number {
  const hours = offsetY / pxPerHour(zoomIndex)
  return Math.round(topMs - hours * MS_PER_HOUR)
}

/** Inverse of {@link offsetToEpoch}; clamped to >= 0 (the live edge). */
export function epochToOffset(epochMs: number, topMs: number, zoomIndex: number): number {
  const hours = (topMs - epochMs) / MS_PER_HOUR
  return Math.max(0, hours * pxPerHour(zoomIndex))
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run srcV2/components/camera/theater/__tests__/timeline-geometry.spec.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git -C /Users/alice/Documents/Git/camstack/camstack-viewer add \
  srcV2/components/camera/theater/timeline-geometry.ts \
  srcV2/components/camera/theater/__tests__/timeline-geometry.spec.ts
git -C /Users/alice/Documents/Git/camstack/camstack-viewer commit -m "feat(timeline): add offset↔epoch geometry for vertical scrub"
```

---

## Task 2: `scrub-controller` — shared-position reducer (pure)

**Files:**
- Create: `srcV2/recording/scrub-controller.ts`
- Test: `srcV2/recording/__tests__/scrub-controller.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import {
  initialScrubState,
  scrubReducer,
  shouldEcho,
  shouldEmit,
  cursorFractionFor,
} from '../scrub-controller.js'

describe('scrubReducer', () => {
  it('begin sets scrubbing + records the source', () => {
    const s = scrubReducer(initialScrubState, { type: 'begin', source: 'heatmap' })
    expect(s.scrubbing).toBe(true)
    expect(s.lastSource).toBe('heatmap')
  })
  it('update sets scrubEpoch + source while scrubbing', () => {
    const s = scrubReducer(
      { ...initialScrubState, scrubbing: true },
      { type: 'update', epoch: 1000, source: 'timeline' },
    )
    expect(s.scrubEpoch).toBe(1000)
    expect(s.lastSource).toBe('timeline')
  })
  it('end clears scrubbing, promotes epoch to playhead, keeps source', () => {
    const s = scrubReducer(
      { ...initialScrubState, scrubbing: true, scrubEpoch: 1000, lastSource: 'heatmap' },
      { type: 'end', epoch: 1200, source: 'heatmap' },
    )
    expect(s.scrubbing).toBe(false)
    expect(s.scrubEpoch).toBeNull()
    expect(s.playheadEpoch).toBe(1200)
    expect(s.lastSource).toBe('heatmap')
  })
  it('seek sets playhead + source without scrubbing', () => {
    const s = scrubReducer(initialScrubState, { type: 'seek', epoch: 500, source: 'timeline' })
    expect(s.scrubbing).toBe(false)
    expect(s.playheadEpoch).toBe(500)
    expect(s.lastSource).toBe('timeline')
  })
  it('playhead from the embed does NOT change lastSource (no gesture)', () => {
    const s = scrubReducer(
      { ...initialScrubState, lastSource: 'heatmap' },
      { type: 'playhead', epoch: 9000 },
    )
    expect(s.playheadEpoch).toBe(9000)
    expect(s.lastSource).toBe('heatmap')
  })
  it('playhead is ignored while scrubbing (scrub target wins)', () => {
    const s = scrubReducer(
      { ...initialScrubState, scrubbing: true, scrubEpoch: 1000 },
      { type: 'playhead', epoch: 9000 },
    )
    expect(s.playheadEpoch).toBeNull()
  })
})

describe('shouldEcho', () => {
  it('a surface must not re-emit when it is the current source', () => {
    const s = { ...initialScrubState, lastSource: 'timeline' as const }
    expect(shouldEcho(s, 'timeline')).toBe(false)
    expect(shouldEcho(s, 'heatmap')).toBe(true)
  })
})

describe('shouldEmit', () => {
  it('coalesces emits to the throttle window', () => {
    expect(shouldEmit(1000, 1000 + 70)).toBe(true)
    expect(shouldEmit(1000, 1000 + 30)).toBe(false)
  })
})

describe('cursorFractionFor', () => {
  it('uses scrubEpoch while scrubbing, else playheadEpoch', () => {
    const day = { from: 0, to: 100 }
    expect(cursorFractionFor({ ...initialScrubState, scrubbing: true, scrubEpoch: 25 }, day)).toBeCloseTo(0.25)
    expect(cursorFractionFor({ ...initialScrubState, playheadEpoch: 80 }, day)).toBeCloseTo(0.8)
  })
  it('returns null when there is no position', () => {
    expect(cursorFractionFor(initialScrubState, { from: 0, to: 100 })).toBeNull()
  })
  it('clamps to [0,1] and guards a zero-width day', () => {
    const day = { from: 0, to: 100 }
    expect(cursorFractionFor({ ...initialScrubState, playheadEpoch: 200 }, day)).toBe(1)
    expect(cursorFractionFor({ ...initialScrubState, playheadEpoch: -5 }, day)).toBe(0)
    expect(cursorFractionFor({ ...initialScrubState, playheadEpoch: 50 }, { from: 0, to: 0 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run srcV2/recording/__tests__/scrub-controller.spec.ts`
Expected: FAIL — `Cannot find module '../scrub-controller.js'`.

- [ ] **Step 3: Implement the pure core**

```typescript
export type ScrubSource = 'timeline' | 'heatmap'

export interface ScrubState {
  readonly scrubbing: boolean
  readonly scrubEpoch: number | null
  readonly playheadEpoch: number | null
  readonly lastSource: ScrubSource | null
}

export const initialScrubState: ScrubState = {
  scrubbing: false,
  scrubEpoch: null,
  playheadEpoch: null,
  lastSource: null,
}

export type ScrubAction =
  | { readonly type: 'begin'; readonly source: ScrubSource }
  | { readonly type: 'update'; readonly epoch: number; readonly source: ScrubSource }
  | { readonly type: 'end'; readonly epoch: number; readonly source: ScrubSource }
  | { readonly type: 'seek'; readonly epoch: number; readonly source: ScrubSource }
  | { readonly type: 'playhead'; readonly epoch: number }

export function scrubReducer(state: ScrubState, action: ScrubAction): ScrubState {
  switch (action.type) {
    case 'begin':
      return { ...state, scrubbing: true, lastSource: action.source }
    case 'update':
      return { ...state, scrubbing: true, scrubEpoch: action.epoch, lastSource: action.source }
    case 'end':
      return {
        ...state,
        scrubbing: false,
        scrubEpoch: null,
        playheadEpoch: action.epoch,
        lastSource: action.source,
      }
    case 'seek':
      return {
        ...state,
        scrubbing: false,
        scrubEpoch: null,
        playheadEpoch: action.epoch,
        lastSource: action.source,
      }
    case 'playhead':
      // Reported by the embed; ignored mid-scrub so the drag target wins. Never
      // changes lastSource (no surface produced it → no echo suppression).
      if (state.scrubbing) return state
      return { ...state, playheadEpoch: action.epoch }
    default:
      return state
  }
}

/** Echo guard: a surface re-rendering from state must NOT re-emit a gesture when
 *  it was itself the source of the current value (prevents scroll→state→scroll). */
export function shouldEcho(state: ScrubState, surface: ScrubSource): boolean {
  return state.lastSource !== surface
}

/** Throttle decision for continuous `update` emits (default ~70ms ≈ 14fps bridge). */
export function shouldEmit(lastEmitMs: number, now: number, throttleMs = 70): boolean {
  return now - lastEmitMs >= throttleMs
}

/** The active cursor position (scrub target while scrubbing, else playhead) as a
 *  0..1 fraction across the day window. Null when there is no position or the
 *  window is degenerate. */
export function cursorFractionFor(
  state: ScrubState,
  day: { readonly from: number; readonly to: number },
): number | null {
  const epoch = state.scrubbing ? state.scrubEpoch : state.playheadEpoch
  if (epoch === null) return null
  const span = day.to - day.from
  if (span <= 0) return null
  return Math.min(1, Math.max(0, (epoch - day.from) / span))
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run srcV2/recording/__tests__/scrub-controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the thin hook (no new test — integration-verified)**

Append to `srcV2/recording/scrub-controller.ts`:

```typescript
import { useCallback, useReducer, useRef } from 'react'
import type { RecordingPlayerHandle } from '../live/RecordingPlayerWebView.js'
import { log } from '../lib/logger.js'

export interface ScrubController {
  readonly state: ScrubState
  readonly beginScrub: (source: ScrubSource) => void
  readonly updateScrub: (epoch: number, source: ScrubSource) => void
  readonly endScrub: (epoch: number, source: ScrubSource) => void
  readonly seek: (epoch: number, source: ScrubSource) => void
  readonly setPlayhead: (epoch: number) => void
}

/** Owns the shared scrub position and bridges it to the recording embed.
 *  `recRef` is the imperative handle of the mounted <RecordingPlayerWebView>;
 *  `onEnterVod` is called when a gesture should switch a live view into VOD. */
export function useScrubController(
  recRef: React.RefObject<RecordingPlayerHandle | null>,
  vodActiveRef: React.RefObject<boolean>,
  onEnterVod: (epoch: number) => void,
): ScrubController {
  const [state, dispatch] = useReducer(scrubReducer, initialScrubState)
  const lastEmitRef = useRef(0)

  const beginScrub = useCallback(
    (source: ScrubSource) => {
      dispatch({ type: 'begin', source })
      if (vodActiveRef.current) recRef.current?.scrubStart()
    },
    [recRef, vodActiveRef],
  )

  const updateScrub = useCallback(
    (epoch: number, source: ScrubSource) => {
      dispatch({ type: 'update', epoch, source })
      const now = Date.now()
      if (!shouldEmit(lastEmitRef.current, now)) return
      lastEmitRef.current = now
      if (vodActiveRef.current) recRef.current?.scrubTo(epoch)
    },
    [recRef, vodActiveRef],
  )

  const endScrub = useCallback(
    (epoch: number, source: ScrubSource) => {
      dispatch({ type: 'end', epoch, source })
      log.debug('scrub:ctrl', 'endScrub', { epoch, source, vod: vodActiveRef.current })
      if (vodActiveRef.current) recRef.current?.scrubEnd(epoch)
      // In live mode a drag/scroll just parks the shared position; it does not
      // auto-enter VOD (that is the deliberate tap-to-seek path).
    },
    [recRef, vodActiveRef],
  )

  const seek = useCallback(
    (epoch: number, source: ScrubSource) => {
      dispatch({ type: 'seek', epoch, source })
      log.debug('scrub:ctrl', 'seek', { epoch, source, vod: vodActiveRef.current })
      if (vodActiveRef.current) recRef.current?.seekTo(epoch)
      else onEnterVod(epoch)
    },
    [recRef, vodActiveRef, onEnterVod],
  )

  const setPlayhead = useCallback((epoch: number) => dispatch({ type: 'playhead', epoch }), [])

  return { state, beginScrub, updateScrub, endScrub, seek, setPlayhead }
}
```

- [ ] **Step 6: Type-check + commit**

Run: `npm run ts-check`
Expected: no new errors.

```bash
git -C /Users/alice/Documents/Git/camstack/camstack-viewer add \
  srcV2/recording/scrub-controller.ts \
  srcV2/recording/__tests__/scrub-controller.spec.ts
git -C /Users/alice/Documents/Git/camstack/camstack-viewer commit -m "feat(recording): add shared scrub-controller (reducer + echo guard + throttle)"
```

---

## Task 3: timeline rows carry their tick epoch

A row tap must know its absolute epoch. Add `tickMs` to `TimelineRow` and populate it where the builder already computes the tick for the `id`.

**Files:**
- Modify: `srcV2/components/camera/theater/mock-data.ts`
- Test: `srcV2/components/camera/theater/__tests__/mock-data.spec.ts`

- [ ] **Step 1: Write the failing test (append to the existing spec)**

```typescript
import { buildTimelineRowsPage } from '../mock-data.js'

describe('TimelineRow.tickMs', () => {
  it('exposes the absolute tick epoch encoded in the row id', () => {
    const now = new Date()
    now.setHours(19, 23, 0, 0)
    const rows = buildTimelineRowsPage(now.getTime(), 2, 0)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(typeof r.tickMs).toBe('number')
      expect(r.id).toBe(`row-${r.tickMs}`)
    }
  })
  it('ticks descend (top row is the most recent)', () => {
    const now = new Date()
    now.setHours(19, 23, 0, 0)
    const rows = buildTimelineRowsPage(now.getTime(), 2, 0)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].tickMs).toBeLessThan(rows[i - 1].tickMs)
    }
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run srcV2/components/camera/theater/__tests__/mock-data.spec.ts`
Expected: FAIL — `tickMs` is `undefined` / property missing on the row type.

- [ ] **Step 3: Add `tickMs` to the interface and the builder**

In `srcV2/components/camera/theater/mock-data.ts`, extend the interface:

```typescript
export interface TimelineRow {
  readonly id: string
  readonly tickMs: number
  readonly hourLabel: string
  readonly isFullHour: boolean
  readonly bars: readonly TimelineBar[]
}
```

Then, in the row constructor inside the builder (the place that currently builds `id: \`row-${tickMs}\``), add the field. The existing object literal looks like:

```typescript
    rows.push({
      id: `row-${tickMs}`,
      hourLabel,
      isFullHour,
      bars,
    })
```

Change it to:

```typescript
    rows.push({
      id: `row-${tickMs}`,
      tickMs,
      hourLabel,
      isFullHour,
      bars,
    })
```

> If the local variable holding the tick is not named `tickMs`, use whichever number the `id` template literal already interpolates — they must be the same value.

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run srcV2/components/camera/theater/__tests__/mock-data.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/alice/Documents/Git/camstack/camstack-viewer add \
  srcV2/components/camera/theater/mock-data.ts \
  srcV2/components/camera/theater/__tests__/mock-data.spec.ts
git -C /Users/alice/Documents/Git/camstack/camstack-viewer commit -m "feat(timeline): expose tickMs epoch on timeline rows"
```

---

## Task 4: make a timeline row pressable

**Files:**
- Modify: `srcV2/components/camera/theater/TimelineListRow.tsx`

- [ ] **Step 1: Read the current file**

Run: `sed -n '1,200p' srcV2/components/camera/theater/TimelineListRow.tsx` (open it) and locate the component props + the outer container element.

- [ ] **Step 2: Add an optional press handler**

Add to the props interface:

```typescript
  readonly onPressRow?: (tickMs: number) => void
```

Wrap the row's outer container in a `Pressable` (import `Pressable` from `react-native`) that calls `onPressRow?.(row.tickMs)`. Keep all existing styles on the inner content; the `Pressable` only adds the tap target:

```tsx
<Pressable onPress={onPressRow ? () => onPressRow(row.tickMs) : undefined}>
  {/* existing row content unchanged */}
</Pressable>
```

> If the row data prop is not named `row`, use the existing name and read `.tickMs` from it.

- [ ] **Step 3: Type-check**

Run: `npm run ts-check`
Expected: no new errors. (No unit test — covered by the integration manual test in Task 7.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/alice/Documents/Git/camstack/camstack-viewer add \
  srcV2/components/camera/theater/TimelineListRow.tsx
git -C /Users/alice/Documents/Git/camstack/camstack-viewer commit -m "feat(timeline): make timeline rows pressable for tap-to-seek"
```

---

## Task 5: TheaterTimeline — cursor + scroll-scrub + tap-seek from the shared position

**Files:**
- Modify: `srcV2/components/camera/theater/TheaterTimeline.tsx`

- [ ] **Step 1: Extend the props interface** (after the existing heatmap callbacks at `TheaterTimelineProps`):

```typescript
  /** Shared position from the controller (drives cursor + programmatic scroll). */
  readonly playheadEpoch?: number | null
  readonly scrubEpoch?: number | null
  readonly scrubbing?: boolean
  /** Vertical-timeline-sourced gestures (distinct source for the echo guard). */
  readonly onTimelineScrubStart?: () => void
  readonly onTimelineScrubTo?: (epochMs: number) => void
  readonly onTimelineScrubEnd?: (epochMs: number) => void
  readonly onTimelineSeek?: (epochMs: number) => void
```

- [ ] **Step 2: Import the geometry helper** at the top of the file:

```typescript
import { offsetToEpoch, epochToOffset } from './timeline-geometry.js'
```

- [ ] **Step 3: Drive the cursor from the shared position.** Replace the existing line:

```typescript
  const cursorFraction = useMemo(() => heatmapCursorFraction(nowMs), [nowMs])
```

with a version computed **after** `dayWindow` is defined. Move this `useMemo` to immediately below the `dayWindow` declaration (around `TheaterTimeline.tsx:207`) and change it to:

```typescript
  const cursorFraction = useMemo(() => {
    const epoch = props.scrubbing ? props.scrubEpoch ?? null : props.playheadEpoch ?? null
    if (epoch === null) return heatmapCursorFraction(nowMs)
    const span = dayWindow.to - dayWindow.from
    if (span <= 0) return 0
    return Math.min(1, Math.max(0, (epoch - dayWindow.from) / span))
  }, [props.scrubbing, props.scrubEpoch, props.playheadEpoch, dayWindow, nowMs])
```

- [ ] **Step 4: Add an echo-guard ref + extend `handleScroll`.** Add near `listRef`:

```typescript
  const programmaticScrollRef = useRef(false)
  const scrubbingScrollRef = useRef(false)
  const scrollSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

Replace `handleScroll` (`TheaterTimeline.tsx:179-187`) with:

```typescript
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = e.nativeEvent.contentOffset.y
      // Skip emits caused by our own programmatic scroll (echo guard).
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false
        return
      }
      const now = Date.now()
      if (now - lastScrollEvalRef.current < SCROLL_THROTTLE_MS) return
      lastScrollEvalRef.current = now

      const atLiveEdge = offsetY <= LIVE_EDGE_THRESHOLD_PX
      setIsLive((prev) => (prev === atLiveEdge ? prev : atLiveEdge))

      // Drive the shared scrub position from the scroll offset.
      const epoch = offsetToEpoch(offsetY, topMs, zoomIndex)
      const snapped = nearestCoveredEdge(epoch, coverage)
      if (snapped === null) return
      if (!scrubbingScrollRef.current) {
        scrubbingScrollRef.current = true
        props.onTimelineScrubStart?.()
      }
      props.onTimelineScrubTo?.(snapped)

      // Settle: end the scroll-scrub shortly after the last scroll event.
      if (scrollSettleRef.current) clearTimeout(scrollSettleRef.current)
      scrollSettleRef.current = setTimeout(() => {
        scrubbingScrollRef.current = false
        props.onTimelineScrubEnd?.(snapped)
      }, 160)
    },
    [topMs, zoomIndex, coverage, props],
  )
```

> `nearestCoveredEdge` is already imported in this file (used by `fractionToEpoch`). `topMs` and `zoomIndex` are already in scope. `SCROLL_THROTTLE_MS`, `LIVE_EDGE_THRESHOLD_PX`, `lastScrollEvalRef`, `setIsLive` already exist.

- [ ] **Step 5: Programmatic scroll when the OTHER surface moves the position.** Add an effect after `handleGoToLive`:

```typescript
  // Follow the shared position with a programmatic scroll, but only when the
  // change did NOT originate from the timeline itself (echo-guarded) and we are
  // not actively scroll-scrubbing.
  useEffect(() => {
    if (scrubbingScrollRef.current) return
    const epoch = props.scrubbing ? props.scrubEpoch ?? null : props.playheadEpoch ?? null
    if (epoch === null) return
    const offset = epochToOffset(epoch, topMs, zoomIndex)
    programmaticScrollRef.current = true
    listRef.current?.scrollToOffset({ offset, animated: false })
  }, [props.scrubbing, props.scrubEpoch, props.playheadEpoch, topMs, zoomIndex])
```

- [ ] **Step 6: Wire row tap → seek.** Find the FlashList `renderItem` (around `TheaterTimeline.tsx:336-346`) that renders `TimelineListRow` and pass the press handler:

```tsx
        renderItem={({ item }) => (
          <TimelineListRow
            row={item}
            onPressRow={props.onTimelineSeek}
          />
        )}
```

> Keep any other props `TimelineListRow` already receives in `renderItem`; only add `onPressRow`. If `renderItem` is defined as a `useCallback` elsewhere, add `onPressRow={props.onTimelineSeek}` there and include `props.onTimelineSeek` in its dependency array.

- [ ] **Step 7: Type-check**

Run: `npm run ts-check`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git -C /Users/alice/Documents/Git/camstack/camstack-viewer add \
  srcV2/components/camera/theater/TheaterTimeline.tsx
git -C /Users/alice/Documents/Git/camstack/camstack-viewer commit -m "feat(timeline): scroll-scrub, tap-seek, and shared-position cursor"
```

---

## Task 6: CameraDetailScreen — controller as single source of truth + connect onPosition

**Files:**
- Modify: `srcV2/screens/CameraDetailScreen.tsx`

- [ ] **Step 1: Import the controller**

```typescript
import { useScrubController } from '../recording/scrub-controller.js'
```

- [ ] **Step 2: Replace the ad-hoc scrub callbacks with the controller.** The current block (`CameraDetailScreen.tsx:185-210`) defines `vodStartMs`, `recRef`, `onSeekToTime`, `onExitVod`, `vodActiveRef`, `onScrubStart`, `onScrubToTime`, `onScrubEnd`. Keep `vodStartMs`, `recRef`, `onExitVod`, and `vodActiveRef`; replace the per-callback handlers with the controller:

```typescript
  const [vodStartMs, setVodStartMs] = useState<number | null>(null)
  const recRef = useRef<RecordingPlayerHandle>(null)
  const onExitVod = useCallback(() => setVodStartMs(null), [])

  const vodActiveRef = useRef(false)
  vodActiveRef.current = vodStartMs !== null

  const onEnterVod = useCallback((epoch: number) => setVodStartMs(epoch), [])
  const scrub = useScrubController(recRef, vodActiveRef, onEnterVod)
```

- [ ] **Step 3: Pass `onPosition` to the WebView.** In the JSX where `<RecordingPlayerWebView>` is rendered (`CameraDetailScreen.tsx:438-444`), add the position callback:

```tsx
        <RecordingPlayerWebView
          ref={recRef}
          deviceId={deviceId}
          startMs={vodStartMs}
          onPosition={scrub.setPlayhead}
        />
```

- [ ] **Step 4: Route both surfaces through the controller.** In the `<TheaterTimeline>` props (`CameraDetailScreen.tsx:547-550`), replace the four heatmap callbacks and add the shared-position + timeline-source props:

```tsx
          onSeekToTime={(epoch) => scrub.seek(epoch, 'heatmap')}
          onScrubStart={() => scrub.beginScrub('heatmap')}
          onScrubToTime={(epoch) => scrub.updateScrub(epoch, 'heatmap')}
          onScrubEnd={(epoch) => scrub.endScrub(epoch, 'heatmap')}
          playheadEpoch={scrub.state.playheadEpoch}
          scrubEpoch={scrub.state.scrubEpoch}
          scrubbing={scrub.state.scrubbing}
          onTimelineScrubStart={() => scrub.beginScrub('timeline')}
          onTimelineScrubTo={(epoch) => scrub.updateScrub(epoch, 'timeline')}
          onTimelineScrubEnd={(epoch) => scrub.endScrub(epoch, 'timeline')}
          onTimelineSeek={(epoch) => scrub.seek(epoch, 'timeline')}
```

> Note: `seek('heatmap')` replaces the old `onSeekToTime` that called `setVodStartMs`/`recRef.seekTo` directly — the controller now performs `recRef.seekTo` (when VOD active) or `onEnterVod` (when live) internally, so behavior is preserved.

- [ ] **Step 5: Type-check**

Run: `npm run ts-check`
Expected: no new errors. Confirm there are no remaining references to the removed `onScrubStart`/`onScrubToTime`/`onScrubEnd` `useCallback`s.

- [ ] **Step 6: Commit**

```bash
git -C /Users/alice/Documents/Git/camstack/camstack-viewer add \
  srcV2/screens/CameraDetailScreen.tsx
git -C /Users/alice/Documents/Git/camstack/camstack-viewer commit -m "feat(recording): drive scrub from shared controller + connect onPosition"
```

---

## Task 7: Manual verification (logging-driven, device 99)

No automated E2E exists for the WebView path; verify on device with debug logging.

- [ ] **Step 1:** In the app: Settings → Advanced → enable **Debug mode**. Open camera **device 99** (only device with footage).

- [ ] **Step 2:** Tap the heatmap → expect VOD to enter and reach `playing`. Watch the hub log:

Run on the server host:
```bash
grep '"source":"app"' /Users/alice/Documents/Git/camstack/camstack-server/server/backend/camstack-data/logs/camstack-$(date +%F).log | tail -40
```
Expected: `rec:host mount` → `rec:state loading` → `rec:state playing`; then `rec:position` advancing; `scrub:ctrl seek {source:'heatmap'}`.

- [ ] **Step 3:** Drag the heatmap → expect `scrub:ctrl` updates throttled to ~70ms and the embed `embed:scrub segmentAt/decoded/drawn` with no `AbortError` storm. The vertical timeline should scroll to follow (programmatic, no feedback loop).

- [ ] **Step 4:** Scroll the vertical timeline → expect `onTimelineScrubTo` → embed preview updates and the heatmap cursor follows. On scroll-settle expect a single `endScrub {source:'timeline'}`.

- [ ] **Step 5:** Tap a timeline row → expect `seek {source:'timeline'}` and VOD repositions to that row's `tickMs`.

- [ ] **Step 6:** Confirm the cursor on both surfaces tracks `rec:position` after settle (playhead follows playback). Record any anomalies (e.g. `w:0 h:0`, one-tick freeze) — those are addressed by the companion embed plan.

- [ ] **Step 7 (optional):** If everything checks out, this branch is ready to merge — invoke the `superpowers:finishing-a-development-branch` skill.

---

## Self-review notes (spec coverage)

- Spec §A (`scrub-controller`: scrubEpoch/scrubbing/playhead, echo guard, throttle, pure reducers) → **Task 2**.
- Spec §B (vertical timeline geometry offset↔epoch, scroll→updateScrub, tap-to-seek, programmatic scroll echo-guarded) → **Tasks 1, 3, 4, 5**.
- Spec §C (heatmap drag→updateScrub, tap→seek, cursor from playhead/scrubEpoch, coverage backdrop) → **Tasks 5, 6** (heatmap gesture wiring already exists; only the cursor + controller routing are new).
- Spec §E partial (connect `onPosition` end-to-end → `playheadEpoch`) → **Task 6**. The embed-side VOD settle / `w:0 h:0` fixes are in the companion server plan.
- Spec "Testing → Unit: timeline-geometry round-trip, scrub-controller reducers (echo guard, throttle decision)" → **Tasks 1, 2**.
- Out-of-scope items (server thumbnails, frame-exact scrub, moving timeline into WebView) — not implemented, as required.
