# srcV2 — data sources for the dummy features (research)

How to wire the currently-dummy camera-detail features to real camstack data. All
reachable from the viewer via `system.trpcClient.<cap>` and the SDK's live-event API.

## 1. Bounding boxes (live detection overlay)
- **Source:** live event `detection.result` (pipeline), NOT the `native-object-detection`
  cap (that one only carries `{class, timestamp, confidence}` — no coords).
- **Payload shape** (from admin-ui `useDeviceDetections`): `event.data.frame = { width, height, detections: [...] }`; filter by `event.source.id === deviceId`.
- **Client API:** the viewer SDK already exposes this — `@camstack/sdk` exports
  `NormalizedBoundingBox`, `DetectionData`, `LiveDetectionEvent`, `SystemLiveEvent`,
  `SystemLiveEventListener` (see `node_modules/@camstack/sdk/dist/nvr.d.ts`). Subscribe to
  live detection events, take the normalized boxes, render an overlay.
- **UI reference to port:** ui-library `composites/detection-overlay.tsx` + `detection-canvas.tsx`
  + `detection-colors.ts` (per-class colors). Boxes are normalized → scale to the rendered
  video rect.
- **Plan:** `useDeviceDetections(deviceId)` hook in srcV2 (subscribe via the SDK live-event
  API), feed `MotionBoxesOverlay` (already on screen, gated by the toolbar bolt toggle).

## 2. Events (timeline highlights)
- **Cap:** `events` (device-scoped). `getEvents({ deviceId, from?, to?, limit? }) → EventItem[]`
  where `EventItem = { id, type, timestamp(ms), label?, thumbnailUrl?, clipUrl?, metadata? }`.
  Also `getEventThumbnail({deviceId,eventId})` and `getEventClipUrl(...)`.
- **Plan:** replace the dummy timeline highlights — query `events.getEvents` for the visible
  window, map each event's `timestamp` to a position on the heatmap/vertical timeline and color
  by `type`. The filter chips (motion/audio) map to `type`. `mock-data.ts` is the single swap
  point: `buildHeatmapBins`/`buildTimelineRowsAtZoom` become adapters over `getEvents`
  (+ recording coverage / motion buckets from the SDK's NVR API — `MotionBucket`,
  `RecordingSegment`, `EventsQuery`, `MotionQuery` are all exported by the SDK).

## 3. Child devices (devices panel)
- **Cap:** `accessories` (device-scoped). Status: `{ childDeviceIds: number[], hiddenChildIds: number[] }`;
  mutation `setChildHidden`. The child device IS the source of truth for what it is.
- **Plan:** `accessories.getStatus({deviceId})` → `childDeviceIds` minus `hiddenChildIds` →
  resolve each via `deviceManager.getDevice(id)` (name/type/state) → render in `DevicesPanel`
  (already on screen, gated by the toolbar grid toggle). `setChildHidden` powers a hide/show.

## 4. PTZ presets (already actionable)
- **Cap:** `ptz` supports presets: `getOptions.supportsPresets` (+ `maxPresets`),
  `getPresets() → {id,name}[]`, `goToPreset({deviceId,presetId})`, `savePreset({deviceId,presetId,name})`.
- **Status:** being wired into `PtzControls` now (the in-flight build).

## Open integration question
Live boxes (#1) need the viewer SDK's **subscription/live-event** path (`SystemLiveEvent` +
listener) to actually deliver `detection.result`. The SDK declares the types; confirm the
runtime `system` exposes an `onLiveEvent`/`subscribe` surface before building the overlay
hook. Events (#2) and children (#3) are plain queries — no subscription needed.
