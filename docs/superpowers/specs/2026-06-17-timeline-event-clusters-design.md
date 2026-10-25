# Timeline Event Clusters + Activity Bars — Design (Cycle 2)

**Date:** 2026-06-17
**Repo:** `camstack-viewer` (viewer-only this cycle; no backend changes)
**Branch:** `feat/recorded-webrtc-timeline`
**Status:** Approved direction (user authorized autonomous build → working prototype)

## Goal

Replace the thin event "ticks" on the theater vertical timeline with real detection
**clusters as cards** (V1-fidelity carousel + indicators, camstack-styled), and
restore **right-side activity bars** (recording, motion, audio) with **two
switchable visual variants** (Lanes + Ribbon). Clicking a cluster seeks playback to
that moment. Clustering is dynamic (zoom-driven, no overlap, configurable gap/size).

## Locked decisions

- **Cluster data source:** `pipeline-analytics.getObjectEvents` (downstream pipeline
  detections — real `className`, `label`, `confidence`, `mediaUrl`), NOT the poorer
  `events.getEvents`.
- **Take ALL events** for now (importance filter deferred). Pills show every distinct
  detection class in the cluster.
- **Representative (first image) priority:** `label` (sub-label) → person → vehicle →
  animal. The priority order is a **configurable global setting**.
- **Dynamic clustering by zoom** in pixel-space: a card has a height (`sizePercent`),
  adjacent clusters keep a `gapPercent` gap → no overlap. Both percentages are
  **global settings**.
- **Activity bars this cycle:** recording + motion + audio. **Pipeline-activity
  (watching→active) deferred** (needs a backend persist hook — separate cycle).
- **Two activity variants:** `lanes` (3 parallel bars) and `ribbon` (one layered lane:
  fill=recording, glow=motion, edge-wave=audio, dots=detections). Switch via a
  **global setting**.
- **Cluster click → seek** to the representative event's timestamp (reuses the
  existing `onTimelineSeek` path).
- **No backend work** this cycle: all data is already queryable.

## Data sources (all via the viewer's defensive `capQuery` proxy + recording)

`pipeline-analytics` is a device-scoped cap reached as `trpcClient.pipelineAnalytics`
(camelCase), same structural access as `recording`:

- `getObjectEvents({ deviceId, since, until, limit, projection: 'slim' })`
  → `ObjectEvent[]` `{ id, timestamp, className, label?, confidence?, mediaUrl?, mediaKey? }`
- `getEventDensity({ deviceId, since, until, bucketMs })`
  → `[{ bucketStart, motion, object, audio }]` (counts/bucket) — drives the **motion**
  bar intensity.
- `getAudioEvents({ deviceId, since, until, limit })`
  → `AudioEvent[]` `{ timestamp, rms, dbfs, classification? }` — drives the **audio**
  level bar (bucket by max dbfs).
- `recording.getAvailability({ deviceId, fromMs, toMs })` → ranges — **recording** bar
  (already wired as `useRecordingAvailability`).
- Event media: each object event carries `mediaUrl` (a data-plane URL); render it with
  the auth Bearer header. Fallback: `getEventMedia({ eventId })` → `MediaFile[]`
  (`base64`) → data URI.

## Architecture (units, each independently testable)

### 1. Data hooks (`srcV2/data/`)
- `use-object-events.ts` → `useObjectEvents(deviceId, fromMs, toMs)` : `ObjectEvent[]`
  (defensive `capQuery('pipelineAnalytics','getObjectEvents', …)`; `[]` on error).
- `use-timeline-activity.ts` → `useTimelineActivity(deviceId, fromMs, toMs)` :
  `ActivityModel` = `{ recording: Range[], motion: Bucket[], audio: Bucket[] }`
  where `Range = {startMs,endMs}`, `Bucket = {startMs,endMs,intensity /*0..1*/}`.
  Motion intensity from density counts (normalized); audio intensity from dbfs
  (normalized into 0..1 over a sensible floor/ceil, e.g. -60..0 dBFS).

### 2. Pure clustering (`srcV2/components/camera/theater/event-cluster.ts`)
- Types: `ObjectEvent`, `PositionedCluster` `{ id, events, representative, classes,
  labels, startMs, endMs, topPx, heightPx }`.
- `clusterByZoom(events, { topMs, zoomIndex, sizePx, gapPx })` → `PositionedCluster[]`:
  sort events newest→oldest; convert each to px via `epochToOffset`; greedily group
  events whose px falls within `[clusterTopPx, clusterTopPx + sizePx + gapPx)`; start a
  new cluster past that. Guarantees no-overlap + gap. `heightPx = sizePx`.
- `pickRepresentative(events, priority)` → the event matching the highest-priority rule
  (`label` present → class person → vehicle/car → animal → fallback newest).
- `clusterClasses(events)` → distinct `className`s (for pills), `clusterLabels` →
  distinct labels.
- `sizePx`/`gapPx` derived from the configurable percents against a base
  (`sizePx = sizePercent% * pxPerHour(zoom)` capped to a min; `gapPx = gapPercent% * sizePx`).

### 3. Cluster card (`srcV2/components/camera/theater/ClusterCard.tsx`)
Port V1 `NeonClusterCard` compact, camstack-themed. Preserve: left neon border (class
color), thumbnail **carousel** (one image per event, horizontal snap ScrollView),
**+N** badge, **class pills** (distinct classes), **time** label, **page counter**
(N/M while carousel open), **carousel toggle** button, **clip/recorded dot**, selected
state. `onPress` → seek to `representative.timestamp`. Images via `EventThumb`.

### 4. Event thumbnail (`srcV2/components/camera/theater/EventThumb.tsx`)
`<EventThumb event />`: renders `event.mediaUrl` with the auth header; on error/missing,
fetches `getEventMedia(event.id)` → first `MediaFile.base64` → `data:` URI; final
fallback = a class icon. Memoized.

### 5. Activity model + two renderers
- `activity-bars.ts` (pure): normalization helpers + `motionWindows`/`audioLevels`
  bucketers (tested).
- `ActivityLanes.tsx`: three thin vertical lanes (recording fill, motion blocks, audio
  level), time-aligned, positioned by `epochToOffset`.
- `ActivityRibbon.tsx`: one lane layering recording fill + motion glow + audio edge-wave
  + detection dots.
- Both consume `ActivityModel` + the same geometry; chosen by the settings variant.

### 6. Settings (`srcV2/store/settings-store.ts` + a Settings screen section)
Add `clusters: ClusterPreferences` to `AppSettings`:
```
interface ClusterPreferences {
  gapPercent: number          // default 10
  sizePercent: number         // default 60  (% of pxPerHour → card height)
  activityVariant: 'lanes' | 'ribbon'   // default 'lanes'
  repPriority: readonly string[]         // default ['label','person','vehicle','animal']
}
```
Follow the existing reducer + zustand + `useSettings` pattern; persist + defensive
parse. Add a "Timeline" section in the settings screen to edit them (sliders for the
two %s, a segmented control for the variant, a reorderable/list for priority — minimal
controls acceptable for the prototype).

### 7. Timeline integration (`TheaterTimeline.tsx`)
- **Remove** the event tick layer (`eventTickLayer` + `eventsToListHighlights` usage).
- Track `scrollOffsetY` from the existing `handleScroll`.
- Add a **content-anchored overlay** (`pointerEvents="box-none"`, translated by
  `-scrollOffsetY`) rendering, windowed to the visible epoch range (+margin):
  - the **cluster cards** (positioned `top = cluster.topPx - scrollOffsetY`), tappable;
  - the **activity bars** (Lanes or Ribbon per settings) down the right edge.
- Feed clusters from `useObjectEvents` + `clusterByZoom(...)`; activity from
  `useTimelineActivity`. Card `onPress → props.onTimelineSeek(representative.timestamp)`.
- Keep all existing scroll/scrub/live-edge/auto-follow behavior intact (the overlay is
  `box-none`; only cards capture touches).

## Edge cases
- No events / not connected → empty clusters + empty activity (timeline still scrolls).
- Missing `mediaUrl` → base64 fallback → icon. Never blocks the card.
- Zoom change → `sizePx`/`gapPx` recompute → re-cluster (memoized on
  events+zoom+settings).
- Overlap is mathematically prevented by the gap in `clusterByZoom`.

## Testing
- Pure unit tests (vitest `node`): `clusterByZoom` (grouping, no-overlap, gap, zoom
  sensitivity), `pickRepresentative` (priority order incl. label-first), activity
  bucketers (motion intensity normalization, audio dBFS→0..1), settings reducer.
- Components (`ClusterCard`, `EventThumb`, `ActivityLanes`, `ActivityRibbon`) are thin
  presentational shells — verified manually (no RN render harness), logic lives in the
  tested pure helpers.

## Out of scope (later cycles)
Importance filter; pipeline-activity bar (needs backend persist + query); event-detail
screen; clip linking; the full V1 carousel modal. Clicking a cluster only seeks.
