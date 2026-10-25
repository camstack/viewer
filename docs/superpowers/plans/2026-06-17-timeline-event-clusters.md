# Timeline Event Clusters + Activity Bars — Implementation Plan (Cycle 2)

> Executed subagent-driven. Modules are mostly independent; build in order. Viewer-only
> (`camstack-viewer`, branch `feat/recorded-webrtc-timeline`). vitest env is `node` →
> pure helpers are unit-tested; components are presentational shells verified manually.
> Spec: `docs/superpowers/specs/2026-06-17-timeline-event-clusters-design.md`.

## Reference facts (exact)

- `pipeline-analytics` cap is **device-scoped**, reached via the viewer's defensive
  `capQuery(client, 'pipelineAnalytics', method, input)` (same as `recording`).
- `getObjectEvents({deviceId, since, until, limit, projection})` → array of
  `{ id:string, timestamp:number, className:string, label?:string, confidence?:number,
     mediaUrl?:string, mediaKey?:string }` (projection `'slim'` omits bbox/zones/etc).
- `getEventDensity({deviceId, since, until, bucketMs})` → `[{bucketStart, motion, object, audio}]` (int counts).
- `getAudioEvents({deviceId, since, until, limit})` → `[{ id, timestamp, rms, dbfs, classification? }]`.
- `getEventMedia({eventId})` → `[{ key, kind:'crop'|'thumbnail'|'snapshot', base64, sizeBytes, timestamp }]`.
- `recording.getAvailability({deviceId, fromMs, toMs})` → `{ranges:[{profile,startMs,endMs}]}` (already used by `useRecordingAvailability`).
- Geometry (`srcV2/components/camera/theater/timeline-geometry.ts`):
  `pxPerHour(zoomIndex)=(60/rowMinutes)*34`; `epochToOffset(epochMs, topMs, zoomIndex)` (≥0, newest=topMs at 0);
  `offsetToEpoch`; `ZOOM_LEVELS` (4 levels, default index 2 = {rowMinutes:5, spanHours:6}); `TIMELINE_ROW_HEIGHT=34`.
- Settings store (`srcV2/store/settings-store.ts`): `AppSettings` = `{grid,stream,advanced,highlight}`;
  add a nested section via reducer + zustand method + `useSettings` (`srcV2/data/use-settings.ts`) + defensive parse + `DEFAULTS`.
- Auth token for media: reuse the same token the embed/recording data-plane uses (find via the connection/system; the embed sent `Authorization: Bearer <token>`).

---

## M1 — Settings: cluster preferences + Timeline settings section

**Files:** `srcV2/store/settings-store.ts`, `srcV2/data/use-settings.ts` (if it re-exports), settings screen (find it, e.g. `srcV2/screens/SettingsScreen.tsx`), `locales/{en,it}.json`, test `srcV2/store/__tests__/settings-clusters.spec.ts`.

Add to `AppSettings`:
```ts
export interface ClusterPreferences {
  readonly gapPercent: number          // default 10
  readonly sizePercent: number         // default 60
  readonly activityVariant: 'lanes' | 'ribbon'  // default 'lanes'
  readonly repPriority: readonly string[]        // default ['label','person','vehicle','animal']
}
```
- Extend `AppSettings` with `clusters: ClusterPreferences`; add to `DEFAULTS` (frozen).
- Pure reducer `setClusterEntry(settings, key, value)` (immutable) + zustand `setCluster` + expose via `useSettings`.
- Defensive parse: each field falls back to default if missing/wrong type.
- TDD: test `setClusterEntry` immutability + the defensive parse defaults (mirror existing settings tests).
- Settings UI: add a "Timeline" section — two sliders (gap%, size%, sensible ranges 0–30 / 20–100), a segmented control (Lanes/Ribbon), and a read-only display of the priority list (full reorder UI optional; minimal acceptable). i18n keys under `v2.settings.timeline.*`.

**Verify:** `npm run ts-check` clean; new settings test passes; existing settings tests pass.

---

## M2 — Data hooks

**Files:** `srcV2/data/use-object-events.ts`, `srcV2/data/use-timeline-activity.ts`. Reuse the `capQuery`/`isRecord` pattern from `use-recording.ts` (copy or extract a tiny shared `cap-query.ts` — extracting is cleaner; if extracting, update `use-recording.ts` imports and keep its tests green).

`useObjectEvents(deviceId, fromMs, toMs): UseQueryResult<ObjectEvent[]>`
- key `['v2','analytics','objects',deviceId,fromMs,toMs]`, enabled when connected, refetch ~30s for the live tail.
- `capQuery(client,'pipelineAnalytics','getObjectEvents',{deviceId, since:fromMs, until:toMs, limit:1000, projection:'slim'})`; narrow rows to `ObjectEvent` (drop malformed); `[]` on error.
- Export the `ObjectEvent` interface (id, timestamp, className, label?, confidence?, mediaUrl?, mediaKey?).

`useTimelineActivity(deviceId, fromMs, toMs): { recording: Range[]; motion: Bucket[]; audio: Bucket[] }`
- Fetches in parallel (via React Query or Promise.all inside one queryFn):
  - density `getEventDensity({deviceId,since:fromMs,until:toMs,bucketMs})` (bucketMs from a helper, e.g. ~ (toMs-fromMs)/240 clamped) → motion buckets `{startMs:bucketStart,endMs:bucketStart+bucketMs,intensity: norm(motion)}`.
  - `getAudioEvents(...)` → bucket by the same bucketMs, intensity = `dbfsToUnit(maxDbfsInBucket)`.
  - `recording.getAvailability(...)` → ranges.
- Normalization lives in M4's pure helpers (import them). `{recording:[],motion:[],audio:[]}` on error.
- No unit test required (thin RQ wrappers; consistent with `useRecordingAvailability`).

**Verify:** `npm run ts-check` clean.

---

## M3 — Pure clustering (`srcV2/components/camera/theater/event-cluster.ts` + test)

Types:
```ts
export interface ObjectEvent { id:string; timestamp:number; className:string; label?:string; confidence?:number; mediaUrl?:string; mediaKey?:string }
export interface PositionedCluster {
  id:string; events:readonly ObjectEvent[]; representative:ObjectEvent
  classes:readonly string[]; labels:readonly string[]
  startMs:number; endMs:number; topPx:number; heightPx:number
}
```
Functions (all pure, tested):
- `pickRepresentative(events, priority)` — first event matching priority in order. Default priority `['label','person','vehicle','animal']`: `'label'` matches any event with a non-empty `label`; class tokens match `className` (treat `'vehicle'` == car/truck/bus, `'animal'` == dog/cat/bird — keep a small synonym map). Fallback = newest.
- `clusterByZoom(events, { topMs, zoomIndex, sizePx, gapPx })` → `PositionedCluster[]`:
  sort events DESC by timestamp; for each, `px = epochToOffset(ts, topMs, zoomIndex)`; start a cluster at the first; absorb while `px < clusterTopPx + sizePx + gapPx`; else start a new cluster. Each cluster: `topPx=clusterTopPx`, `heightPx=sizePx`, `startMs=min ts`, `endMs=max ts`, `representative=pickRepresentative`, `classes=distinct classNames`, `labels=distinct labels`, `id=representative.id`.
- `clusterMetrics({zoomIndex, sizePercent, gapPercent})` → `{sizePx, gapPx}` where `sizePx=max(MIN, sizePercent/100 * pxPerHour(zoomIndex))`, `gapPx=gapPercent/100 * sizePx`.

Tests: grouping merges near events; two events far apart → two clusters; **no two clusters overlap and the gap ≥ gapPx**; zoom in (finer) splits a group that was merged at coarse zoom; `pickRepresentative` honors label-first then person>vehicle>animal then newest.

**Verify:** test passes; ts-check clean.

---

## M4 — Activity bucketers (`srcV2/components/camera/theater/activity-bars.ts` + test)

Pure helpers:
```ts
export interface Range { startMs:number; endMs:number }
export interface Bucket { startMs:number; endMs:number; intensity:number } // 0..1
export function dbfsToUnit(dbfs:number, floor=-60, ceil=0):number  // clamp+normalize
export function densityToMotionBuckets(rows:{bucketStart:number;motion:number}[], bucketMs:number):Bucket[]  // intensity = motion / maxMotion (0 when all 0)
export function audioEventsToBuckets(events:{timestamp:number;dbfs:number}[], fromMs:number, bucketMs:number, count:number):Bucket[] // intensity = dbfsToUnit(max dbfs in bucket); empty buckets intensity 0
export function pickBucketMs(fromMs:number, toMs:number, target=240):number  // ~target buckets, clamped to [5_000, 3_600_000]
```
Tests: `dbfsToUnit(-60)=0`, `dbfsToUnit(0)=1`, mid clamps; motion normalization (max→1, zeros→0); audio bucketing assigns max dbfs per bucket; `pickBucketMs` count + clamps.

**Verify:** test passes; ts-check clean.

---

## M5 — `EventThumb.tsx`

`<EventThumb event size? />`: if `event.mediaUrl` → `<Image source={{uri:event.mediaUrl, headers:{Authorization:`Bearer ${token}`}}}>` (get token from the connection/system; find how `useRecording`/embed obtain it — there is a scoped token). `onError` → fetch `getEventMedia({eventId:event.id})` via capQuery → first item base64 → `data:image/jpeg;base64,...`. Final fallback: a class icon (lucide) colored by class. Memoized; never throws.

**Verify:** ts-check clean.

---

## M6 — `ClusterCard.tsx` (port V1 compact)

Props: `{ cluster: PositionedCluster, width:number, selected?:boolean, onPress:()=>void, priority:readonly string[] }`.
Render (camstack theme tokens): left neon border (color = class color of representative via `detection-colors`/`colorForEventType`); a horizontal snap `ScrollView` of `EventThumb` (one per event, only when >1 with media, else single rep thumb) with a toggle button; bottom overlay = class pills (distinct classes, max 3 + "+N"), time label (`HH:MM` of representative), page counter (`i/N` while carousel open); a small "recorded/clip" dot (top-right) — for the prototype show it when the cluster has any event (or omit). `onPress` (whole card) → `onPress()`. Match V1's structure (carousel snap-to-width, activeIndex on scroll, toggle). Style adapted to camstack (use `useTheme()` colors + tokens, not V1's neon hardcodes).

**Verify:** ts-check clean.

---

## M7 — `ActivityLanes.tsx` + `ActivityRibbon.tsx`

Shared props: `{ model: ActivityModel, topMs:number, zoomIndex:number, height:number, scrollOffsetY:number, width:number }` where each renders absolutely-positioned segments using `epochToOffset(ms, topMs, zoomIndex) - scrollOffsetY` for vertical placement (so they scroll with content) and windows to the visible range.
- `ActivityLanes`: 3 thin columns — recording (fill blocks from ranges), motion (blocks, opacity=intensity), audio (blocks, height/opacity=intensity). Colors from theme/highlight settings.
- `ActivityRibbon`: one wider lane layering recording fill (background), motion glow (opacity=intensity), audio as a thin edge envelope (width∝intensity), detection dots optional. Keep it legible.
Both `pointerEvents="none"`.

**Verify:** ts-check clean.

---

## M8 — Integrate into `TheaterTimeline.tsx`

- Remove the `eventTickLayer` + `eventsToListHighlights` usage (keep `filterEvents`/heatmap highlights if still used by the heatmap; only remove the vertical-list ticks).
- Add `const [scrollOffsetY, setScrollOffsetY] = useState(0)` and set it in `handleScroll` (`setScrollOffsetY(offsetY)` — throttled is fine).
- `const objectEvents = useObjectEvents(deviceId, dayWindow.from, dayWindow.to)`; `const activity = useTimelineActivity(deviceId, dayWindow.from, dayWindow.to)`.
- `const { sizePx, gapPx } = clusterMetrics({ zoomIndex, sizePercent, gapPercent })`; `const clusters = useMemo(() => clusterByZoom(objectEvents ?? [], { topMs, zoomIndex, sizePx, gapPx }), [...])` (priority from settings for representative).
- Inside `listWrap`, ADD an overlay sibling AFTER the FlashList: `<View pointerEvents="box-none" style={absoluteFill}>`:
  - Cluster cards: window to `topPx` within `[scrollOffsetY - margin, scrollOffsetY + viewportH + margin]`; render each at `top: cluster.topPx - scrollOffsetY, left: ...`, `width` ~ 60% of the list width, `onPress → props.onTimelineSeek?.(cluster.representative.timestamp)`.
  - Activity: `settings.clusters.activityVariant === 'ribbon' ? <ActivityRibbon .../> : <ActivityLanes .../>` pinned to the right, passing `scrollOffsetY/topMs/zoomIndex`.
- Keep the live-edge/scrub/auto-follow logic untouched (the overlay is `box-none`; only cards capture touches).

**Verify:** `npm run ts-check` clean; `npx vitest run srcV2` all green; `npx eslint` on all changed/new files clean. Manual: clusters appear, scroll with the timeline, tap seeks, switching the settings variant swaps Lanes↔Ribbon.

---

## Final
After M8: full `npm run ts-check`, `npx vitest run srcV2`, eslint on all new/changed files. Commit per module. The prototype is the working timeline with clusters + both activity variants + settings. Push only on user confirmation.
