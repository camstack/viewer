# srcV2 viewer — what it needs from the camstack-server SDK / caps

**Date:** 2026-06-13
**From:** srcV2 viewer work (camstack-viewer)
**To:** camstack-server (`@camstack/sdk` `System` + caps)
**Why:** building srcV2 surfaced gaps in the SDK's *client-facing* surface. None block compiling, but they block a correct UI. Listed by priority.

---

## 1. Device name / info for the current device set — BLOCKING the Cameras UI

**Problem.** `System.listDevices(filters?)` returns `DeviceProxy[]` whose only synchronous identity is `deviceId`. The display **name**, **canonical type**, and **online** flag live in `DeviceInfo` held by `SystemMirror`, but there is **no public way to read them for the warm-boot set**:
- `DeviceProxy` exposes `deviceId`, `state`, `binding`, cap accessors — no `name`/`type`.
- `onDeviceAdded(cb)` only fires for devices added **after** subscription, not the set already present at `init()`.
- `DeviceInfo` is **not exported** from the `@camstack/types` barrel (we had to derive it as `NonNullable<Parameters<DeviceLifecycleListener>[1]>`).

**Effect today.** The Cameras list renders every camera as `Camera #<id>` until some later lifecycle event happens to fire. Unusable for a real list.

**What we need (any one of these):**
- Preferred: `System.getDeviceInfo(deviceId): DeviceInfo | null` (sync, from the mirror), **and** export the `DeviceInfo` type from `@camstack/sdk`/`@camstack/types`.
- Or: a `System.listDeviceInfos(filters?): readonly DeviceInfo[]` that returns the named/typed snapshot directly (parallel to `listDevices`).
- Or: have `onDeviceAdded` replay the current set on subscription (emit the existing devices once), documented as such.

**Exact fields the UI needs per device:**
`{ deviceId: number, name: string, canonicalType (camera | doorbell | …), online: boolean }`, and for cameras the capability hints to render controls: **has PTZ**, **has two-way audio/intercom**, **available stream profiles** (high/mid/low), **has recording**. If these are already reachable per-device via caps (e.g. `ptz`, `intercom`, `stream-params`, `recording`), document the canonical client path to query them by `deviceId` without N round-trips on first paint.

---

## 2. Live motion / audio indicators — needed for the live view

We consume live events via `System.subscribeEvent(category, cb)`. Please confirm/document, for the **client**:
- The exact **category strings** (and payload shapes) for **live motion** and **live audio-level/threshold** events per device — so the live view can flash a motion/audio badge and the (later) timeline can show "now" activity.
- Whether these are per-device filterable at subscription, or the client must filter by `source.id` itself.

(For historical timeline bands we already use `pipeline-analytics.getEventDensity({deviceId,since,until,bucketMs}) → {bucketStart,motion,object,audio}[]` — confirmed + implemented. No change needed there.)

---

## 3. Events macro-block (LATER — not needed yet, listing for planning)

When we build the events tab (after the live/grid/settings work and the scrub spike), the UI will need:
- Per-event list/query by device + time range with **thumbnails** (the `EventThumbnailer` path) and the **clip** for each event (bounded VOD).
- A stable event id + class/zone/severity for filtering.
Please keep the client-facing shape of these in mind; we'll send a detailed spec when we start that block.

---

## 4. Minor / noted

- `@camstack/sdk` source currently has 2 type errors at `system.ts:603` (`platformProbe` not on `SystemProxy`) — surfaced because the viewer aliases `@camstack/sdk` to source for types. Likely a generated-cap/`SystemProxy` drift; not ours, but it pollutes the viewer's `ts-check`. A regen/fix would clean it up.
- Auth: srcV2 currently takes a **server URL + scoped token** to bootstrap a connection. A documented **username/password → token** login path (or the canonical way the admin-ui obtains its token) would let us build the proper onboarding/login screen.

---

### Summary of the one true blocker
**#1 (device name/info for the warm-boot set).** Everything else is confirm-and-document or later. A small `System.getDeviceInfo` / `listDeviceInfos` + exporting `DeviceInfo` unblocks a real Cameras list.

---

## BACKEND RESPONSE — 2026-06-13 (camstack-server)

### #1 — DONE (server SDK shipped)
- **`System.getDeviceInfo(deviceId): DeviceInfo | null`** — sync, from the warm-boot mirror.
- **`System.listDeviceInfos(filters?): readonly DeviceInfo[]`** — the named/typed snapshot for the current set, same `filters` as `listDevices` (no need to wait for lifecycle events).
- **`DeviceInfo` is now exported from `@camstack/sdk`** (re-exported from `@camstack/types`). Stop deriving it.

`DeviceInfo` carries exactly what the list needs (no extra round-trip):
`{ id, stableId, addonId, type (DeviceType), name, location, online, isCamera, role?, features: string[], disabled, parentDeviceId, config, … }`.

**Per-device control hints (PTZ / intercom / stream profiles / recording) without N round-trips:** read the device's **binding** — `System.getDevice(deviceId).binding` (warm-boot, from the same mirror) lists the caps bound to the device, so `ptz` / `intercom` / `recording` presence is a sync check. `DeviceInfo.features` carries feature flags. Stream profiles (high/mid/low) come from `streamBroker.listAllProfileSlots()` (or per-device via the broker) — one call, not per-camera. Live status for a cap (e.g. `motion.isDetected`) is the `getStatus`/`getDeviceStatusAggregate({deviceId, caps})` path.

Bump `@camstack/sdk` in the viewer to pick these up (built dist + types updated).

### #2 — event categories (confirmed)
`System.subscribeEvent(category, cb)` envelopes are `{ id, timestamp, source:{type,id}, category, data }`. **Per-device filtering IS supported server-side** — subscribe with `{ deviceId, category }` (see how the admin-ui state stream subscribes with `{ deviceId, category: EventCategory.DeviceStateChanged }`); you don't have to filter by `source.id` client-side.

- **Live motion:** category `EventCategory.MotionOnMotionChanged` = `'motion.on-motion-changed'` (per-device on/off). For current state without an event, the device-scoped `motion` cap: `motion.isDetected` / `motion.getStatus`. Motion-zone geometry for an overlay rides `EventCategory.MotionZonesRaw` = `'detection.motion-zones-raw'`.
- **Live audio level/threshold:** `EventCategory.PipelineAudioInferenceResult` = `'pipeline.audio-inference-result'` (this is what the ui-library audio-level waveform consumes).
- **Object detections (live):** `EventCategory.DetectionEvent` = `'detection.event'`; persisted/enriched ones come as `EventCategory.PipelineAnalyticsDetectionEvent` = `'pipeline-analytics.detection-event'`.

(Historical bands via `pipeline-analytics.getEventDensity` — unchanged, as you noted.)

### #4 — done / noted
- **SDK type errors at `system.ts:603` — FIXED.** `platform-probe` is infra (addon-to-addon via `api.platformProbe`), NOT a client-facing system cap, so it isn't on `SystemProxy`; the stray `system.platformProbe` getter was removed. `@camstack/sdk` `tsc` is clean again — your aliased ts-check should be too after a bump.
- **Auth login path:** still TODO on the server side (a documented username/password → scoped-token flow). Tracked; send your onboarding/login needs and we'll expose the canonical path the admin-ui uses.

### #3 — events macro-block: acknowledged, deferred. Send the detailed spec when you start that block; note the server-side footage↔event↔clips retention reconciliation is also being designed (a `clips` concept + eviction telemetry) — let's align the client-facing shape then.
