# Cluster Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a magnifying-glass icon on each timeline cluster card that opens a full-screen detail modal showing every frame's full-frame snapshot grouped with all its detections and rich metadata (class, label, confidence, zones, track state, track id, time), plus a "seek to this moment" action.

**Architecture:** Pure frame-grouping helpers + parser (unit-tested) feed a TanStack-Query data hook that re-queries the cluster's window with `projection: 'full'`. Presentational components (modal, frame view, metadata list) render the result and reuse a newly-extracted shared media hook. The cluster card gains a lens icon that opens the modal; tap-to-seek is unchanged. Each frame view renders an empty reserved overlay layer so bounding boxes drop in later (deferred backend work) with no rewrite.

**Tech Stack:** React Native 0.81 / React 19 / TypeScript 5.9, Expo, `expo-image`, `lucide-react-native`, `@tanstack/react-query`, `react-i18next`, vitest (`npm run test:v2`).

**Spec:** `docs/superpowers/specs/2026-06-17-cluster-detail-view-design.md`

---

## Pre-flight (do once before Task 1)

- [ ] **Remove stale subagent worktrees** (they make vitest run duplicate test files and report phantom failures — see session notes):

```bash
cd /Users/alice/Documents/Git/camstack/camstack-viewer
git worktree list | grep 'agent-' | awk '{print $1}' | xargs -r -n1 git worktree remove --force
git worktree list
```
Expected: no `.claude/worktrees/agent-*` rows remain.

- [ ] **Confirm baseline is green:**

```bash
npm run test:v2 && npm run ts-check
```
Expected: tests pass, no type errors. (If type errors pre-exist unrelated to this work, note them and proceed.)

---

## File structure

**Create:**
- `srcV2/components/camera/theater/detail/cluster-detail.ts` — pure types + `toDetailDetection`, `groupEventsByFrame`, `summarizeCluster`.
- `srcV2/components/camera/theater/detail/__tests__/cluster-detail.spec.ts` — unit tests for the pure module.
- `srcV2/data/use-event-media.ts` — shared media-resolution hook extracted from `EventThumb`.
- `srcV2/components/camera/theater/detail/use-cluster-detail.ts` — data hook (full-projection query → frames).
- `srcV2/components/camera/theater/detail/DetectionMetaList.tsx` — per-frame detection metadata list.
- `srcV2/components/camera/theater/detail/DetailFrameView.tsx` — one frame: full-frame image + reserved overlay slot.
- `srcV2/components/camera/theater/detail/ClusterDetailModal.tsx` — the full-screen modal.

**Modify:**
- `srcV2/components/camera/theater/EventThumb.tsx` — consume `use-event-media`.
- `srcV2/components/camera/theater/ClusterCard.tsx` — add lens icon + `onOpenDetail` prop.
- `srcV2/components/camera/theater/TimelineScroller.tsx` — plumb `onClusterOpenDetail`.
- `srcV2/components/camera/theater/TheaterTimeline.tsx` — modal state + wiring (both engines) + render modal.
- `locales/en.json`, `locales/it.json` — modal strings under `v2.theater`.

---

## Task 1: Pure frame grouping — types + `groupEventsByFrame`

**Files:**
- Create: `srcV2/components/camera/theater/detail/cluster-detail.ts`
- Test: `srcV2/components/camera/theater/detail/__tests__/cluster-detail.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `srcV2/components/camera/theater/detail/__tests__/cluster-detail.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { groupEventsByFrame } from '../cluster-detail.js'
import type { DetailDetection } from '../cluster-detail.js'

function det(o: Partial<DetailDetection> & { id: string; timestamp: number }): DetailDetection {
  return { className: 'person', zones: [], ...o }
}

describe('groupEventsByFrame', () => {
  it('groups detections that share a timestamp into one frame', () => {
    const frames = groupEventsByFrame([
      det({ id: 'a', timestamp: 1000, className: 'person' }),
      det({ id: 'b', timestamp: 1000, className: 'car' }),
      det({ id: 'c', timestamp: 2000, className: 'dog' }),
    ])
    expect(frames).toHaveLength(2)
    // newest first
    expect(frames[0].timestamp).toBe(2000)
    expect(frames[1].timestamp).toBe(1000)
    expect(frames[1].detections.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('picks the first detection WITH media as the frame image', () => {
    const frames = groupEventsByFrame([
      det({ id: 'a', timestamp: 1000 }), // no media
      det({ id: 'b', timestamp: 1000, mediaUrl: 'https://x/b.jpg' }),
    ])
    expect(frames[0].imageDetectionId).toBe('b')
    expect(frames[0].imageMediaUrl).toBe('https://x/b.jpg')
  })

  it('leaves imageDetectionId undefined when no detection has media', () => {
    const frames = groupEventsByFrame([det({ id: 'a', timestamp: 1000 })])
    expect(frames[0].imageDetectionId).toBeUndefined()
    expect(frames[0].imageMediaUrl).toBeUndefined()
  })

  it('returns [] for empty input', () => {
    expect(groupEventsByFrame([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- cluster-detail`
Expected: FAIL — cannot find module `../cluster-detail.js`.

- [ ] **Step 3: Write minimal implementation**

Create `srcV2/components/camera/theater/detail/cluster-detail.ts`:

```typescript
/** Pure helpers for the cluster detail view. No React, no side-effects, no `any`. */

// ─── Types ────────────────────────────────────────────────────────────

/** A single detection enriched from the `projection: 'full'` object event. */
export interface DetailDetection {
  readonly id: string
  readonly timestamp: number
  readonly className: string
  readonly label?: string
  readonly confidence?: number
  readonly zones: readonly string[]
  readonly state?: string
  readonly trackId?: string
  readonly mediaUrl?: string
}

/** One inference frame = all detections that share an exact timestamp. */
export interface DetailFrame {
  readonly key: string
  readonly timestamp: number
  /** Detection whose media is shown for this frame (first with media). */
  readonly imageDetectionId?: string
  readonly imageMediaUrl?: string
  readonly detections: readonly DetailDetection[]
}

// ─── Grouping ─────────────────────────────────────────────────────────

/**
 * Group detections by exact `timestamp` (events from the same inference frame
 * share one timestamp + one snapshot). Frames are returned newest→oldest; each
 * frame's image is the first detection that carries a `mediaUrl`.
 */
export function groupEventsByFrame(
  detections: readonly DetailDetection[],
): DetailFrame[] {
  const byTs = new Map<number, DetailDetection[]>()
  for (const d of detections) {
    const bucket = byTs.get(d.timestamp)
    if (bucket) bucket.push(d)
    else byTs.set(d.timestamp, [d])
  }

  const timestamps = [...byTs.keys()].sort((a, b) => b - a) // newest first
  return timestamps.map((ts) => {
    const group = byTs.get(ts) ?? []
    const withMedia = group.find((d) => Boolean(d.mediaUrl))
    return {
      key: String(ts),
      timestamp: ts,
      imageDetectionId: withMedia?.id,
      imageMediaUrl: withMedia?.mediaUrl,
      detections: group,
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- cluster-detail`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add srcV2/components/camera/theater/detail/cluster-detail.ts srcV2/components/camera/theater/detail/__tests__/cluster-detail.spec.ts
git commit -m "feat(theater): pure groupEventsByFrame for cluster detail"
```

---

## Task 2: Pure `toDetailDetection` parser + `summarizeCluster`

**Files:**
- Modify: `srcV2/components/camera/theater/detail/cluster-detail.ts`
- Test: `srcV2/components/camera/theater/detail/__tests__/cluster-detail.spec.ts`

- [ ] **Step 1: Write the failing test** (append to the existing spec file)

```typescript
import { toDetailDetection, summarizeCluster } from '../cluster-detail.js'

describe('toDetailDetection', () => {
  it('parses a full-projection row', () => {
    const d = toDetailDetection({
      id: 'e1', timestamp: 1000, className: 'person', label: 'mario',
      confidence: 0.83, zones: ['driveway', 'gate'], state: 'entered',
      trackId: 't1', mediaUrl: 'https://x/e1.jpg',
    })
    expect(d).not.toBeNull()
    expect(d).toEqual({
      id: 'e1', timestamp: 1000, className: 'person', label: 'mario',
      confidence: 0.83, zones: ['driveway', 'gate'], state: 'entered',
      trackId: 't1', mediaUrl: 'https://x/e1.jpg',
    })
  })

  it('defaults zones to [] and drops non-string zone entries', () => {
    const d = toDetailDetection({ id: 'e2', timestamp: 1, className: 'car', zones: ['a', 5, null] })
    expect(d?.zones).toEqual(['a'])
  })

  it('returns null for malformed rows', () => {
    expect(toDetailDetection({ timestamp: 1, className: 'x' })).toBeNull()
    expect(toDetailDetection(null)).toBeNull()
    expect(toDetailDetection({ id: 'e', timestamp: 'no', className: 'x' })).toBeNull()
  })
})

describe('summarizeCluster', () => {
  it('summarizes distinct classes, count, and span', () => {
    const frames = groupEventsByFrame([
      det({ id: 'a', timestamp: 1000, className: 'person' }),
      det({ id: 'b', timestamp: 1000, className: 'car' }),
      det({ id: 'c', timestamp: 3000, className: 'person' }),
    ])
    const s = summarizeCluster(frames)
    expect(s.classes).toEqual(['person', 'car'])
    expect(s.detectionCount).toBe(3)
    expect(s.startMs).toBe(1000)
    expect(s.endMs).toBe(3000)
  })

  it('handles empty frames', () => {
    expect(summarizeCluster([])).toEqual({ classes: [], detectionCount: 0, startMs: 0, endMs: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:v2 -- cluster-detail`
Expected: FAIL — `toDetailDetection`/`summarizeCluster` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `cluster-detail.ts`)

```typescript
// ─── Parsing ──────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse one `projection:'full'` getObjectEvents row into a DetailDetection. */
export function toDetailDetection(row: unknown): DetailDetection | null {
  if (!isRecord(row)) return null
  if (typeof row.id !== 'string' || row.id.length === 0) return null
  if (typeof row.timestamp !== 'number') return null
  if (typeof row.className !== 'string' || row.className.length === 0) return null

  const zones = Array.isArray(row.zones)
    ? row.zones.filter((z): z is string => typeof z === 'string')
    : []

  return {
    id: row.id,
    timestamp: row.timestamp,
    className: row.className,
    label: typeof row.label === 'string' ? row.label : undefined,
    confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
    zones,
    state: typeof row.state === 'string' ? row.state : undefined,
    trackId: typeof row.trackId === 'string' ? row.trackId : undefined,
    mediaUrl: typeof row.mediaUrl === 'string' ? row.mediaUrl : undefined,
  }
}

// ─── Summary ──────────────────────────────────────────────────────────

export interface ClusterSummary {
  readonly classes: readonly string[]
  readonly detectionCount: number
  readonly startMs: number
  readonly endMs: number
}

/** Distinct classes (first-seen order), total detections, and time span. */
export function summarizeCluster(frames: readonly DetailFrame[]): ClusterSummary {
  const classes: string[] = []
  let detectionCount = 0
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY

  for (const f of frames) {
    for (const d of f.detections) {
      detectionCount += 1
      if (!classes.includes(d.className)) classes.push(d.className)
      if (d.timestamp < startMs) startMs = d.timestamp
      if (d.timestamp > endMs) endMs = d.timestamp
    }
  }

  if (detectionCount === 0) return { classes: [], detectionCount: 0, startMs: 0, endMs: 0 }
  return { classes, detectionCount, startMs, endMs }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- cluster-detail`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add srcV2/components/camera/theater/detail/cluster-detail.ts srcV2/components/camera/theater/detail/__tests__/cluster-detail.spec.ts
git commit -m "feat(theater): toDetailDetection parser + summarizeCluster"
```

---

## Task 3: Extract shared `useEventMedia` hook

**Files:**
- Create: `srcV2/data/use-event-media.ts`
- Modify: `srcV2/components/camera/theater/EventThumb.tsx`

- [ ] **Step 1: Create the hook**

Create `srcV2/data/use-event-media.ts`:

```typescript
/**
 * useEventMedia — resolve a displayable image URI for a pipeline-analytics
 * event, with the same priority chain used across the theater UI:
 *   1. `mediaUrl` (served with a Bearer header — caller attaches it).
 *   2. On image error / missing url: `getEventMedia(eventId)` → first base64 →
 *      `data:` URI.
 *   3. Caller renders its own icon fallback when `failed` is true and no uri.
 *
 * Returns the resolved `uri`, an `onError` callback to trigger the fallback
 * fetch, and `failed` (all sources exhausted). Never throws.
 */

import { useCallback, useState } from 'react'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'

export interface EventMedia {
  /** Best available URI (data: fallback once fetched, else the raw mediaUrl). */
  readonly uri: string | null
  /** Whether the current `uri` is a `data:` URI (no auth header needed). */
  readonly isData: boolean
  /** All sources exhausted — caller should show an icon. */
  readonly failed: boolean
  /** Call from <Image onError>. Triggers the base64 fallback fetch. */
  readonly onError: () => void
}

function extractBase64(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const first: unknown = raw[0]
  if (!isRecord(first)) return null
  const b64 = first.base64
  if (typeof b64 !== 'string' || b64.length === 0) return null
  return b64
}

export function useEventMedia(eventId: string, mediaUrl?: string): EventMedia {
  const { controller } = useConnection()
  const [fallbackUri, setFallbackUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [fetching, setFetching] = useState(false)

  const fetchFallback = useCallback(async (): Promise<void> => {
    if (fetching) return
    setFetching(true)
    try {
      const system = controller.getSystem()
      if (!system) { setFailed(true); return }
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'getEventMedia',
        { eventId },
      )
      const b64 = extractBase64(raw)
      if (b64) setFallbackUri(`data:image/jpeg;base64,${b64}`)
      else setFailed(true)
    } catch {
      setFailed(true)
    }
  }, [controller, eventId, fetching])

  const onError = useCallback((): void => { void fetchFallback() }, [fetchFallback])

  const uri: string | null = fallbackUri ?? mediaUrl ?? null
  const isData = uri !== null && uri.startsWith('data:')

  return { uri, isData, failed: failed && fallbackUri === null, onError }
}
```

- [ ] **Step 2: Refactor `EventThumb.tsx` to consume it**

In `srcV2/components/camera/theater/EventThumb.tsx`, replace the inline state machine. Change the imports block (lines 18-27) to:

```typescript
import React, { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { User, Car, Dog, Bird, HelpCircle } from 'lucide-react-native'

import { useServer } from '../../../app/ServerProvider.js'
import { useEventMedia } from '../../../data/use-event-media.js'
import { colorForEventType } from './event-highlights.js'
import type { ObjectEvent } from './event-cluster.js'
```

Delete the `extractBase64` helper (now in the hook). Replace the component body (from `export const EventThumb = memo(...)` to its closing `})`) with:

```typescript
export const EventThumb = memo(function EventThumb({
  event,
  width,
  height,
}: EventThumbProps) {
  const { token } = useServer()
  const { uri, isData, failed, onError } = useEventMedia(event.id, event.mediaUrl)

  const accentColor = colorForEventType(event.className)
  const Icon = iconForClass(event.className)
  const sizeStyle = { width, height }

  const headers: Record<string, string> | undefined =
    token && uri && !isData ? { Authorization: `Bearer ${token}` } : undefined

  if (failed || uri === null) {
    const iconSize = Math.min(width, height) * 0.45
    return (
      <View
        style={[styles.container, sizeStyle, styles.iconContainer, { backgroundColor: accentColor + '1A' }]}
      >
        <Icon size={iconSize} color={accentColor} />
      </View>
    )
  }

  return (
    <View style={[styles.container, sizeStyle]}>
      <Image
        source={headers ? { uri, headers } : { uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        onError={onError}
      />
    </View>
  )
})
```

(Keep `iconForClass`, `EventThumbProps`, and `styles` as they are. Remove the now-unused `useConnection`, `capQuery`, `isRecord` imports.)

- [ ] **Step 3: Verify types + existing tests**

Run: `npm run ts-check && npm run test:v2`
Expected: no type errors; all tests still pass (EventThumb is presentational — no behavioral change).

- [ ] **Step 4: Commit**

```bash
git add srcV2/data/use-event-media.ts srcV2/components/camera/theater/EventThumb.tsx
git commit -m "refactor(theater): extract useEventMedia shared hook"
```

---

## Task 4: `useClusterDetail` data hook

**Files:**
- Create: `srcV2/components/camera/theater/detail/use-cluster-detail.ts`

- [ ] **Step 1: Create the hook**

Create `srcV2/components/camera/theater/detail/use-cluster-detail.ts`:

```typescript
/**
 * useClusterDetail — load the full-projection detections for a cluster's time
 * window and group them into frames for the detail modal.
 *
 * Defensive: disabled when `cluster` is null or not connected; on query error
 * it falls back to building frames from the cluster's existing slim events
 * (reduced metadata) so the gallery still renders.
 */

import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../../../../connection/ConnectionProvider.js'
import { capQuery } from '../../../../data/cap-query.js'
import { log } from '../../../../lib/logger.js'
import {
  groupEventsByFrame,
  toDetailDetection,
  type DetailDetection,
  type DetailFrame,
} from './cluster-detail.js'
import type { PositionedCluster } from '../event-cluster.js'

export interface ClusterDetailResult {
  readonly frames: DetailFrame[]
  readonly loading: boolean
}

/** Build slim DetailDetections from a cluster's existing events (fallback). */
function framesFromSlim(cluster: PositionedCluster): DetailFrame[] {
  const slim: DetailDetection[] = cluster.events.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    className: e.className,
    label: e.label,
    confidence: e.confidence,
    zones: [],
    mediaUrl: e.mediaUrl,
  }))
  return groupEventsByFrame(slim)
}

export function useClusterDetail(
  deviceId: number,
  cluster: PositionedCluster | null,
): ClusterDetailResult {
  const { controller, state } = useConnection()

  const query = useQuery<DetailFrame[]>({
    queryKey: ['v2', 'analytics', 'cluster-detail', deviceId, cluster?.id ?? 'none'],
    enabled: state === 'connected' && cluster !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<DetailFrame[]> => {
      if (cluster === null) return []
      const system = controller.getSystem()
      if (!system) return framesFromSlim(cluster)
      try {
        const raw = await capQuery(
          system.trpcClient as Record<string, unknown>,
          'pipelineAnalytics',
          'getObjectEvents',
          {
            deviceId,
            since: cluster.startMs,
            until: cluster.endMs,
            limit: 1000,
            projection: 'full',
          },
        )
        if (!Array.isArray(raw)) return framesFromSlim(cluster)
        const detections: DetailDetection[] = []
        for (const row of raw) {
          const d = toDetailDetection(row)
          if (d !== null) detections.push(d)
        }
        if (detections.length === 0) return framesFromSlim(cluster)
        log.info('theater:detail', 'cluster-detail', {
          deviceId, clusterId: cluster.id, detections: detections.length,
        })
        return groupEventsByFrame(detections)
      } catch (err) {
        log.warn('theater:detail', 'full query failed; slim fallback', { error: String(err) })
        return framesFromSlim(cluster)
      }
    },
  })

  return { frames: query.data ?? [], loading: query.isLoading }
}
```

- [ ] **Step 2: Verify types**

Run: `npm run ts-check`
Expected: no type errors. (If the relative depth `../../../../` is wrong, fix to match — the file is 4 levels under `srcV2/`: `components/camera/theater/detail/`.)

- [ ] **Step 3: Commit**

```bash
git add srcV2/components/camera/theater/detail/use-cluster-detail.ts
git commit -m "feat(theater): useClusterDetail full-projection data hook"
```

---

## Task 5: `DetectionMetaList` component

**Files:**
- Create: `srcV2/components/camera/theater/detail/DetectionMetaList.tsx`

- [ ] **Step 1: Create the component**

Create `srcV2/components/camera/theater/detail/DetectionMetaList.tsx`:

```typescript
/**
 * DetectionMetaList — renders the metadata for every detection on a frame:
 * class icon + colored name, optional sub-label, confidence %, zone chips, and
 * track state. Presentational; no data fetching.
 */

import React, { memo } from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { User, Car, Dog, Bird, HelpCircle } from 'lucide-react-native'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { colorForEventType } from '../event-highlights.js'
import type { DetailDetection } from './cluster-detail.js'

type IconComponent = React.ComponentType<{ size: number; color: string }>

function iconForClass(className: string): IconComponent {
  const lower = className.toLowerCase()
  if (lower === 'person' || lower === 'face') return User
  if (['car', 'truck', 'bus', 'vehicle', 'motorcycle', 'bicycle'].includes(lower)) return Car
  if (lower === 'dog' || lower === 'cat' || lower === 'animal') return Dog
  if (lower === 'bird') return Bird
  return HelpCircle
}

export interface DetectionMetaListProps {
  readonly detections: readonly DetailDetection[]
}

export const DetectionMetaList = memo(function DetectionMetaList({
  detections,
}: DetectionMetaListProps) {
  const { colors } = useTheme()

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {detections.map((d) => {
        const color = colorForEventType(d.className)
        const Icon = iconForClass(d.className)
        const pct = typeof d.confidence === 'number' ? `${Math.round(d.confidence * 100)}%` : null
        return (
          <View key={d.id} style={[styles.row, { borderColor: colors.border }]}>
            <View style={[styles.iconBox, { backgroundColor: color + '1A' }]}>
              <Icon size={16} color={color} />
            </View>
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text style={[styles.className, { color: colors.foreground }]}>{d.className}</Text>
                {d.label ? (
                  <Text style={[styles.label, { color: colors.foregroundMuted }]}>· {d.label}</Text>
                ) : null}
                {pct ? <Text style={[styles.conf, { color }]}>{pct}</Text> : null}
              </View>
              {(d.zones.length > 0 || d.state) ? (
                <View style={styles.chipsRow}>
                  {d.state ? (
                    <View style={[styles.chip, { borderColor: colors.border }]}>
                      <Text style={[styles.chipText, { color: colors.foregroundMuted }]}>{d.state}</Text>
                    </View>
                  ) : null}
                  {d.zones.map((z) => (
                    <View key={z} style={[styles.chip, { borderColor: color + '66', backgroundColor: color + '14' }]}>
                      <Text style={[styles.chipText, { color }]}>{z}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        )
      })}
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  listContent: { gap: SPACING.xs, paddingVertical: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBox: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  className: { fontSize: 14, fontWeight: '600' },
  label: { fontSize: 13 },
  conf: { fontSize: 12, fontWeight: '700', marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { paddingHorizontal: SPACING.xs + 1, paddingVertical: 1, borderRadius: RADIUS.sm, borderWidth: 1 },
  chipText: { fontSize: 10, fontWeight: '600' },
})
```

- [ ] **Step 2: Verify types**

Run: `npm run ts-check`
Expected: no type errors. (If `colors.border` is not on the theme palette, replace with the nearest token used elsewhere in theater, e.g. `colors.foregroundSubtle` — grep `useTheme` palette keys to confirm.)

- [ ] **Step 3: Commit**

```bash
git add srcV2/components/camera/theater/detail/DetectionMetaList.tsx
git commit -m "feat(theater): DetectionMetaList detail metadata component"
```

---

## Task 6: `DetailFrameView` component (image + reserved overlay)

**Files:**
- Create: `srcV2/components/camera/theater/detail/DetailFrameView.tsx`

- [ ] **Step 1: Create the component**

Create `srcV2/components/camera/theater/detail/DetailFrameView.tsx`:

```typescript
/**
 * DetailFrameView — one frame in the detail pager: the full-frame snapshot
 * (via useEventMedia) rendered "contain", plus a reserved, empty overlay layer
 * sized to the rendered image. The overlay is where bounding boxes will be
 * drawn once the backend persists detection-frame dimensions (deferred — see
 * the design doc's "Deferred backend plan"). It draws nothing today.
 */

import React, { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { ImageOff } from 'lucide-react-native'
import { useServer } from '../../../../app/ServerProvider.js'
import { useEventMedia } from '../../../../data/use-event-media.js'
import { useTheme } from '../../../theme/theme-provider.js'
import type { DetailFrame } from './cluster-detail.js'

export interface DetailFrameViewProps {
  readonly frame: DetailFrame
  readonly width: number
  readonly height: number
}

export const DetailFrameView = memo(function DetailFrameView({
  frame,
  width,
  height,
}: DetailFrameViewProps) {
  const { token } = useServer()
  const { colors } = useTheme()
  const { uri, isData, failed, onError } = useEventMedia(
    frame.imageDetectionId ?? frame.key,
    frame.imageMediaUrl,
  )

  const headers: Record<string, string> | undefined =
    token && uri && !isData ? { Authorization: `Bearer ${token}` } : undefined

  const hasImage = uri !== null && !failed

  return (
    <View style={[styles.container, { width, height }]}>
      {hasImage ? (
        <Image
          source={headers ? { uri, headers } : { uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
          onError={onError}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <ImageOff size={40} color={colors.foregroundSubtle} />
        </View>
      )}

      {/* Reserved overlay layer for future bounding boxes — draws nothing yet. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} />
    </View>
  )
})

const styles = StyleSheet.create({
  container: { backgroundColor: '#000', overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
})
```

- [ ] **Step 2: Verify types**

Run: `npm run ts-check`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add srcV2/components/camera/theater/detail/DetailFrameView.tsx
git commit -m "feat(theater): DetailFrameView with reserved bbox overlay slot"
```

---

## Task 7: `ClusterDetailModal` component

**Files:**
- Create: `srcV2/components/camera/theater/detail/ClusterDetailModal.tsx`

- [ ] **Step 1: Create the component**

Create `srcV2/components/camera/theater/detail/ClusterDetailModal.tsx`:

```typescript
/**
 * ClusterDetailModal — full-screen detail for one cluster: a swipeable pager of
 * full-frame snapshots (one per inference frame), the per-frame detection
 * metadata, and a "go to this moment" action. Renders only when `cluster` is
 * non-null.
 */

import React, { memo, useCallback, useState } from 'react'
import {
  Modal, View, Text, Pressable, StyleSheet, FlatList,
  type NativeSyntheticEvent, type NativeScrollEvent, type ListRenderItemInfo,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X, Crosshair } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { useClusterDetail } from './use-cluster-detail.js'
import { summarizeCluster, type DetailFrame } from './cluster-detail.js'
import { DetailFrameView } from './DetailFrameView.js'
import { DetectionMetaList } from './DetectionMetaList.js'
import type { PositionedCluster } from '../event-cluster.js'

export interface ClusterDetailModalProps {
  readonly deviceId: number
  readonly cluster: PositionedCluster | null
  readonly onSeek: (epochMs: number) => void
  readonly onClose: () => void
}

function formatHHMMSS(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export const ClusterDetailModal = memo(function ClusterDetailModal({
  deviceId,
  cluster,
  onSeek,
  onClose,
}: ClusterDetailModalProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { frames } = useClusterDetail(deviceId, cluster)

  const [pagerWidth, setPagerWidth] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pagerWidth <= 0) return
      const idx = Math.round(e.nativeEvent.contentOffset.x / pagerWidth)
      setActiveIndex(Math.max(0, Math.min(idx, frames.length - 1)))
    },
    [pagerWidth, frames.length],
  )

  const PAGER_HEIGHT = 240
  const renderFrame = useCallback(
    ({ item }: ListRenderItemInfo<DetailFrame>) => (
      <DetailFrameView frame={item} width={pagerWidth} height={PAGER_HEIGHT} />
    ),
    [pagerWidth],
  )

  const visible = cluster !== null
  const summary = summarizeCluster(frames)
  const active = frames[activeIndex]

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.background + 'F2', paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {summary.startMs > 0 ? formatHHMMSS(summary.startMs) : ''}
              {summary.endMs > summary.startMs ? ` – ${formatHHMMSS(summary.endMs)}` : ''}
            </Text>
            <Text style={[styles.subtitle, { color: colors.foregroundMuted }]}>
              {t('v2.theater.detailCount', { frames: frames.length, count: summary.detectionCount })}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={[styles.iconBtn, { backgroundColor: colors.surface }]}>
            <X size={20} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Pager */}
        <View
          style={[styles.pager, { height: PAGER_HEIGHT }]}
          onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0) setPagerWidth(w) }}
        >
          {pagerWidth > 0 && frames.length > 0 ? (
            <FlatList
              data={frames}
              keyExtractor={(f) => f.key}
              renderItem={renderFrame}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={{ color: colors.foregroundMuted }}>{t('v2.theater.detailEmpty')}</Text>
            </View>
          )}
        </View>

        {/* Page indicator */}
        {frames.length > 1 ? (
          <Text style={[styles.pageCounter, { color: colors.foregroundMuted }]}>
            {activeIndex + 1}/{frames.length}
          </Text>
        ) : null}

        {/* Metadata for the active frame */}
        <View style={styles.meta}>
          {active ? <DetectionMetaList detections={active.detections} /> : null}
        </View>

        {/* Footer action */}
        <Pressable
          onPress={() => { if (active) onSeek(active.timestamp) }}
          style={[styles.seekBtn, { backgroundColor: colors.accent, marginBottom: insets.bottom + SPACING.md }]}
        >
          <Crosshair size={18} color={colors.background} />
          <Text style={[styles.seekText, { color: colors.background }]}>{t('v2.theater.detailSeek')}</Text>
        </Pressable>
      </View>
    </Modal>
  )
})

const styles = StyleSheet.create({
  backdrop: { flex: 1, paddingHorizontal: SPACING.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm },
  headerText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  subtitle: { fontSize: 12, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  pager: { borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: '#000' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pageCounter: { textAlign: 'center', fontSize: 11, marginTop: SPACING.xs, fontVariant: ['tabular-nums'] },
  meta: { flex: 1, marginTop: SPACING.sm },
  seekBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.sm + 2, borderRadius: RADIUS.md },
  seekText: { fontSize: 15, fontWeight: '700' },
})
```

- [ ] **Step 2: Verify types**

Run: `npm run ts-check`
Expected: no type errors. (Confirm the theme palette has `colors.accent`; if not, grep the theater files for the highlight/accent token name and substitute. Confirm `react-native-safe-area-context` is a dependency — it is used elsewhere in the app.)

- [ ] **Step 3: Commit**

```bash
git add srcV2/components/camera/theater/detail/ClusterDetailModal.tsx
git commit -m "feat(theater): ClusterDetailModal full-screen detail view"
```

---

## Task 8: Add the lens icon to `ClusterCard`

**Files:**
- Modify: `srcV2/components/camera/theater/ClusterCard.tsx`

- [ ] **Step 1: Add the `onOpenDetail` prop**

In `ClusterCardProps` (lines 41-46), add the optional prop:

```typescript
export interface ClusterCardProps {
  readonly cluster: PositionedCluster
  readonly width: number
  readonly selected?: boolean
  readonly onPress: () => void
  readonly onOpenDetail?: () => void
}
```

Add `onOpenDetail` to the destructured params in the component signature (line 70-75):

```typescript
export const ClusterCard = memo(function ClusterCard({
  cluster,
  width,
  selected = false,
  onPress,
  onOpenDetail,
}: ClusterCardProps) {
```

- [ ] **Step 2: Import the lens icon**

Change the lucide import (line 32) to add `Search`:

```typescript
import { ChevronLeft, ChevronRight, Search } from 'lucide-react-native'
```

- [ ] **Step 3: Render the lens button**

Inside the card, just before the `{/* ── Events dot (top-right) ── */}` block (around line 245), add:

```typescript
      {/* ── Detail (lens) button, top-left ─────────────────────────── */}
      {onOpenDetail ? (
        <Pressable
          style={[styles.lensBtn, { backgroundColor: colors.background + 'CC' }]}
          onPress={onOpenDetail}
          hitSlop={8}
        >
          <Search size={12} color={colors.foreground} />
        </Pressable>
      ) : null}
```

Add the `lensBtn` style to the `StyleSheet.create` block (next to `eventsDot`):

```typescript
  lensBtn: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    width: 20,
    height: 20,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
```

> Note: the lens `Pressable` is nested inside the card `Pressable`. In RN the inner Pressable becomes the touch responder, so tapping the lens fires `onOpenDetail` WITHOUT firing the card's `onPress` (seek). Verify on-device.

- [ ] **Step 4: Verify types**

Run: `npm run ts-check`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add srcV2/components/camera/theater/ClusterCard.tsx
git commit -m "feat(theater): lens icon on ClusterCard to open detail"
```

---

## Task 9: Plumb `onClusterOpenDetail` through `TimelineScroller`

**Files:**
- Modify: `srcV2/components/camera/theater/TimelineScroller.tsx`

- [ ] **Step 1: Add the prop to `TimelineScrollerProps`**

In `TimelineScrollerProps` (around line 52-64), after `onClusterPress`, add:

```typescript
  /** Open the detail modal for a cluster (lens icon). */
  readonly onClusterOpenDetail?: (cluster: PositionedCluster) => void
```

- [ ] **Step 2: Destructure it**

Add `onClusterOpenDetail` to the destructured props (near line 110, alongside `onClusterPress`).

- [ ] **Step 3: Pass it to `ClusterCard`**

In the cluster map (around line 176-179), update the `ClusterCard`:

```typescript
            <ClusterCard
              cluster={cluster}
              width={cardWidth}
              onPress={() => { onClusterPress(cluster) }}
              onOpenDetail={onClusterOpenDetail ? () => { onClusterOpenDetail(cluster) } : undefined}
            />
```

- [ ] **Step 4: Verify types**

Run: `npm run ts-check`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add srcV2/components/camera/theater/TimelineScroller.tsx
git commit -m "feat(theater): plumb onClusterOpenDetail through TimelineScroller"
```

---

## Task 10: Wire modal state + both engines in `TheaterTimeline`

**Files:**
- Modify: `srcV2/components/camera/theater/TheaterTimeline.tsx`

- [ ] **Step 1: Import the modal**

Add near the `ClusterCard` import (line 67):

```typescript
import { ClusterDetailModal } from './detail/ClusterDetailModal.js'
```

- [ ] **Step 2: Add modal state + handlers**

Near the other `useState`/`useRef` hooks (after `navLockUntilRef`, ~line 410), add:

```typescript
  const [detailCluster, setDetailCluster] = useState<PositionedCluster | null>(null)

  const openClusterDetail = useCallback((cluster: PositionedCluster): void => {
    setDetailCluster(cluster)
  }, [])

  const onDetailSeek = useCallback((epochMs: number): void => {
    navLockUntilRef.current = Date.now() + 2500
    props.onTimelineSeek?.(epochMs)
    setDetailCluster(null)
  }, [props])
```

(Ensure `useState` and `useCallback` are already imported from `react` — they are used elsewhere in this file.)

- [ ] **Step 3: Pass `onClusterOpenDetail` to the scroller engine**

In the `<TimelineScroller>` JSX (around line 683), add the prop after `onClusterPress`:

```typescript
            onClusterPress={onClusterTap}
            onClusterOpenDetail={openClusterDetail}
```

- [ ] **Step 4: Pass `onOpenDetail` to the FlashList-overlay `ClusterCard`**

In the overlay map's `<ClusterCard>` (around line 723-727), add the prop:

```typescript
                    <ClusterCard
                      cluster={c}
                      width={cardWidth}
                      onPress={() => { props.onTimelineSeek?.(c.representative.timestamp) }}
                      onOpenDetail={() => { openClusterDetail(c) }}
                    />
```

- [ ] **Step 5: Render the modal**

At the end of the component's returned JSX, just before the outermost closing tag, add:

```typescript
      <ClusterDetailModal
        deviceId={props.deviceId}
        cluster={detailCluster}
        onSeek={onDetailSeek}
        onClose={() => setDetailCluster(null)}
      />
```

(If the root element is a single `<View>…</View>`, place this as its last child. If the root is a fragment, place it before the closing `</>`.)

- [ ] **Step 6: Verify types + lint + full test run**

```bash
git worktree list | grep 'agent-' | awk '{print $1}' | xargs -r -n1 git worktree remove --force
npm run ts-check && npm run lint && npm run test:v2
```
Expected: no type errors, lint clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add srcV2/components/camera/theater/TheaterTimeline.tsx
git commit -m "feat(theater): wire cluster detail modal into both timeline engines"
```

---

## Task 11: i18n strings

**Files:**
- Modify: `locales/en.json`, `locales/it.json`

- [ ] **Step 1: Add keys to `locales/en.json`**

In the `v2.theater` object (starts at line ~686), add these keys (mind trailing commas):

```json
      "detailCount": "{{frames}} frames · {{count}} detections",
      "detailEmpty": "No detail images for this moment",
      "detailSeek": "Go to this moment"
```

- [ ] **Step 2: Add the same keys to `locales/it.json`**

In its `v2.theater` object add:

```json
      "detailCount": "{{frames}} frame · {{count}} rilevamenti",
      "detailEmpty": "Nessuna immagine di dettaglio per questo istante",
      "detailSeek": "Vai a questo momento"
```

- [ ] **Step 3: Verify JSON is valid + types**

```bash
node -e "JSON.parse(require('fs').readFileSync('locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('locales/it.json','utf8')); console.log('locales OK')"
npm run ts-check
```
Expected: `locales OK`, no type errors.

- [ ] **Step 4: Commit**

```bash
git add locales/en.json locales/it.json
git commit -m "feat(theater): i18n strings for cluster detail modal"
```

---

## Final verification

- [ ] **Clean worktrees + full gate:**

```bash
git worktree list | grep 'agent-' | awk '{print $1}' | xargs -r -n1 git worktree remove --force
npm run test:v2 && npm run ts-check && npm run lint
```
Expected: all green.

- [ ] **On-device manual checks (Metro reload — no deploy needed for the viewer):**
  - Tapping a cluster card still **seeks + holds** (nav-lock) — unchanged.
  - The **lens icon** opens the modal without seeking.
  - The modal shows **full-frame snapshots** (one per frame), swipeable, with a page counter.
  - The metadata list shows **class, label, confidence %, zones, state** (full projection). If the server returns slim, it degrades gracefully (class/label/time only).
  - Frames with multiple detections show **one image with all detections listed**.
  - **"Vai a questo momento"** seeks the timeline and closes the modal.
  - Watch the server log for `theater:detail cluster-detail { detections }` (viewer logs ship as `source:app`).

---

## Self-review notes (coverage vs spec)

- Gallery of all images grouped by frame → Tasks 1, 4, 6, 7. ✅
- Rich metadata needing no frame dims (class/label/confidence/zones/state/trackId/time) → Tasks 2, 5, 7. ✅
- Shared media chain extraction → Task 3. ✅
- Reserved overlay slot for future boxes → Task 6. ✅
- Lens icon opens modal; tap=seek unchanged → Tasks 8, 9, 10. ✅
- Seek action inside modal → Task 7 + Task 10 (`onDetailSeek` reuses nav-lock). ✅
- Defensive slim fallback → Task 4. ✅
- i18n → Task 11. ✅
- Out of scope this cycle (correctly absent): bbox overlays, trajectory retrace, importance filter, clip linking — deferred backend plan stays in the spec.
