# Cluster Detail View — Design

**Date:** 2026-06-17
**Repo:** `camstack-viewer` (viewer-only this cycle; **no backend changes** — bbox/trajectory deferred, see "Deferred backend plan")
**Branch:** `feat/recorded-webrtc-timeline`
**Status:** Approved direction (Option B). User authorized autonomous build → working prototype, review together.

## Goal

Let the user **enlarge a detection cluster** from the theater timeline into a full-screen
**detail view** that shows **all the cluster's images** (the full-frame snapshots already
stored per event) plus **rich per-detection metadata** (class, sub-label, confidence,
zones, track state, track id, time). Frames that carry multiple detections are shown once
with all their detections listed.

This cycle is a **gallery + metadata** slice only. **Bounding-box overlays** and the
**per-track trajectory retrace** are intentionally NOT in this cycle — they depend on
backend data we do not persist yet (see "Deferred backend plan"). The detail view is
designed so those overlays drop into reserved slots later without a rewrite.

## Why no boxes / trajectory now (the binding constraint)

- A stored `ObjectEvent` carries `bbox` in **detection-frame pixel coordinates**, but the
  producer (`addon-post-analysis` `frame-processor.ts`) never writes `frameWidth/frameHeight`
  onto the event (the schema field and the DB column both exist, but stay null). The
  displayed image is the **device snapshot** at a *different* resolution, so a box cannot be
  scaled onto it correctly without the detection-frame dimensions.
- `Track.positions[]` (the trajectory) are pixel coords with the same missing-dimension gap,
  and there is no stored full-frame "canvas" for a completed track (track snapshots are
  crops).
- Backend is busy with other work, so both gaps are deferred. This cycle uses only fields
  that need no frame dimensions.

## Locked decisions

- **Trigger:** a dedicated **magnifying-glass (lens) icon button** on the cluster card opens
  the detail modal. Tapping the card body itself is **unchanged** — it still seeks + holds
  (nav-lock). The modal also offers a **"Vai a questo momento"** action (seek + close) for
  convenience.
- **Data source:** the same `pipelineAnalytics.getObjectEvents`, re-queried for the cluster's
  time window with **`projection: 'full'`** when the modal opens — this adds `confidence`,
  `zones`, `state`, `trackId`, `label`. The slim timeline query is unchanged.
- **Images:** reuse the existing media-resolution chain (`mediaUrl` + Bearer header →
  `getEventMedia(eventId)` base64 fallback → class icon). Extracted into a shared hook so the
  card thumbnail and the detail full-image share one implementation.
- **Frame grouping:** events emitted from the same inference frame share an identical
  `timestamp` (one `FrameResult`) and an identical snapshot image. The detail view groups
  events by `timestamp` into **frames**, shows the image once, and lists every detection on
  that frame. This is exactly the shape a future bbox overlay needs (one image, N boxes).
- **No new backend calls** beyond the full-projection `getObjectEvents` (already supported).
- **Reserved overlay slot:** each frame view renders an empty, absolutely-positioned overlay
  layer above the image. This cycle it draws nothing; the backend follow-up fills it with
  boxes. No structural change required later.

## Data sources

`pipeline-analytics` is reached as `trpcClient.pipelineAnalytics` via the viewer's defensive
`capQuery` proxy (same access pattern as the timeline clusters).

- `getObjectEvents({ deviceId, since, until, limit, projection: 'full' })` →
  `ObjectEvent[]` `{ id, timestamp, className, label?, confidence?, zones?, state?, trackId?,
  mediaKey?, mediaUrl? }` (the full projection; `bbox`/`frameWidth`/`frameHeight` are returned
  but **ignored this cycle**).
- `getEventMedia({ eventId })` → `MediaFile[]` (`base64`) — fallback when `mediaUrl` fails.
- (Already in the timeline: slim `getObjectEvents` for clustering — untouched.)

## Architecture (units, each independently testable)

### 1. Pure frame grouping (`srcV2/components/camera/theater/detail/cluster-detail.ts`)
- Types: `DetailDetection` `{ id, className, label?, confidence?, zones, state?, trackId? }`,
  `DetailFrame` `{ key, timestamp, imageEventId?, detections: DetailDetection[] }`.
- `groupEventsByFrame(events): DetailFrame[]` — group full-projection events by `timestamp`
  (newest→oldest), pick the first event with media as `imageEventId`, collect all detections.
- `summarizeCluster(frames)` — distinct classes, total detection count, time span (for the
  header). Pure, fully unit-tested.

### 2. Shared media hook (`srcV2/data/use-event-media.ts`)
- Extract the `mediaUrl` + Bearer / `getEventMedia` base64 fallback logic currently inlined in
  `EventThumb.tsx` into `useEventMedia(eventId, mediaUrl?)` → `{ uri?, loading, failed }`.
- Refactor `EventThumb.tsx` to consume it (no behavior change — keeps its icon fallback).
- The detail full-image uses the same hook → identical auth/fallback semantics.

### 3. Detail data hook (`srcV2/components/camera/theater/detail/use-cluster-detail.ts`)
- `useClusterDetail(deviceId, cluster)` → `{ frames: DetailFrame[], loading }`.
- On open, `capQuery('pipelineAnalytics','getObjectEvents', { deviceId, since: cluster.startMs,
  until: cluster.endMs, projection: 'full' })`; `groupEventsByFrame` the result. Defensive:
  falls back to the slim `cluster.events` (no zones/confidence) if the full query fails, so the
  gallery still renders.

### 4. Detail modal (`srcV2/components/camera/theater/detail/ClusterDetailModal.tsx`)
- Full-screen RN `Modal` (camstack-themed), props `{ deviceId, cluster, onSeek, onClose }`.
- **Header:** time range, class-summary pills, detection count, close button.
- **Frame pager:** horizontal swipe across `frames` (FlatList paging or a snap ScrollView),
  one `DetailFrameView` per frame; a thumbnail strip / dots for position.
- **Metadata panel:** `DetectionMetaList` for the current frame.
- **Footer:** "Vai a questo momento" (`onSeek(frame.timestamp)` + close).

### 5. Frame view (`srcV2/components/camera/theater/detail/DetailFrameView.tsx`)
- `<DetailFrameView frame />`: full-frame image via `useEventMedia(frame.imageEventId)` with
  `expo-image` (`contentFit="contain"`), `onLoad` captures the rendered image rect.
- Renders a **reserved overlay layer** (`pointerEvents="none"`, sized to the rendered image
  rect) — empty this cycle, the bbox host later.

### 6. Detection metadata list (`srcV2/components/camera/theater/detail/DetectionMetaList.tsx`)
- Per detection: class icon (reuse `iconForClass`) + color (`colorForEventType`), `label`,
  `confidence` as %, `zones` chips, `state` chip. Presentational.

### 7. Timeline integration (`TheaterTimeline.tsx` + `ClusterCard.tsx`)
- Add modal state (`detailCluster: PositionedCluster | null`).
- `ClusterCard` keeps `onPress` = seek (unchanged); add a **magnifying-glass icon button**
  (e.g. lucide `Search`/`ZoomIn`, top corner of the card) with its own `onPressIn`/`onPress`
  that `stopPropagation`-equivalent opens the detail (calls a new `onOpenDetail(cluster)`
  prop) without triggering the card's seek.
- Render `<ClusterDetailModal>` when `detailCluster` is set; `onSeek` reuses the existing
  `onTimelineSeek` + nav-lock path; `onClose` clears state. All scroll/scrub/live-edge
  behavior is unchanged (modal is an overlay).

## Edge cases
- Full-projection query fails → fall back to slim `cluster.events` (gallery still renders,
  metadata reduced). Never blocks.
- Frame with no media on any event → image area shows the class icon; metadata still lists
  detections.
- Single-event cluster → single-frame modal (pager degenerates to one page).
- Modal open while the timeline auto-follows / goes live → modal is independent; closing
  returns to the live timeline state.

## Testing
- Pure unit tests (vitest `node`): `groupEventsByFrame` (grouping by timestamp, media pick,
  newest→oldest order, multi-detection frames), `summarizeCluster` (classes/count/span).
- `use-event-media` extraction verified by the existing `EventThumb` behavior (no regression).
- Modal / frame view / meta list are thin presentational shells — verified manually (no RN
  render harness, matching the cycle-2 convention).

## Out of scope (this cycle)
Bounding-box overlays; per-track trajectory retrace; importance filter; clip linking; editing
detections. The detail modal only displays + seeks.

## Deferred backend plan (later, when backend has capacity)

Two backend changes unblock the overlays; both are small relative to the viewer work.

### P1 — Persist detection-frame dimensions on object events (unblocks bbox overlay)
- In `addon-post-analysis` `frame-processor.ts`, set `frameWidth`/`frameHeight` on each
  emitted `ObjectEvent` (the `FrameResult` already has them; the cap field and the
  `event-store` column already exist — ~2 lines). Applies to new events going forward; not
  retroactive.
- **Viewer follow-up:** in `DetailFrameView`'s reserved overlay layer, draw each detection's
  `bbox` (normalized by `frameWidth/frameHeight`, mapped onto the rendered image rect) with
  `react-native-svg`. Color/label per class. Toggle via a setting.

### P2 — Track replay frames + trajectory access (unblocks trajectory retrace)
- On **track start** (state `new`/`entered`, `firstSeen`): persist the device full-frame
  snapshot keyed to the track (MediaStore kind `track-first-frame`) with `frameWidth/Height`.
- On **track end** (`left`/closed, `lastSeen`): persist a `track-last-frame` the same way.
- Expose via the cap: extend `getTrackMedia` to include these kinds, or add
  `getTrackFrames(trackId) → { firstFrame, lastFrame, frameWidth, frameHeight }`. Delete in
  lockstep with track retention.
- (`getTrack(deviceId, trackId)` already returns persisted completed tracks with
  `positions[]` — no change needed there beyond exposing frame dims for scaling.)
- **Viewer follow-up:** open a track from a detection → first frame as canvas → animate
  `positions[]` as an SVG polyline with a moving marker, crossfading to the last frame at the
  end. Buildable on top of this detail view's frame infrastructure.
