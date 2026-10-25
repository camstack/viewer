# WS-C Report: Event-Detail Linked-Media Strip + Inline Face Assign/Dissociate/Create

## Files Added

| File | Purpose |
|------|---------|
| `srcV2/components/camera/theater/detail/use-event-media-strip.ts` | Hook: fetches `getEventMedia` and filters to `crop`/`faceCrop`/`plateCrop` kinds; manages per-eventId AbortController for cancellation on frame change. |
| `srcV2/components/camera/theater/detail/EventMediaStrip.tsx` | Presentational: horizontal `ScrollView` of base64 image tiles, labeled by kind. Renders nothing when no strip-kind media is available. |
| `srcV2/components/camera/theater/detail/use-face-info.ts` | Hook: queries `faceGallery.getFaceByTrack` + `listIdentities` via `capQuery`; mutations (`assignFace`, `unassignFace`, `createIdentity` → `assignFace`) via direct `.mutate`; re-fetches after each mutation; exposes `mutating`/`error` state. |
| `srcV2/components/camera/theater/detail/FaceAssignPanel.tsx` | Presentational: identity label + "Assign" button (opens bottom-sheet picker with existing identities and "Create new person" text-input flow) + "Dissociate" button (shown only when assigned). |

## Files Modified

| File | Change |
|------|--------|
| `srcV2/components/camera/theater/detail/ClusterDetailModal.tsx` | Added imports for `EventMediaStrip` and `FaceAssignPanel`; inserted both under the `DetectionMetaList` inside the `styles.meta` view; passes `active?.imageDetectionId` to strip and `active?.detections.find(d => d.trackId !== undefined)?.trackId` to face panel. |

## How deviceId + trackId are obtained for the selected event

- `deviceId` is a prop on `ClusterDetailModal` passed in from the parent theater screen (it's the camera's numeric id used throughout the theater).
- `trackId` comes from `DetailDetection.trackId` on the **active frame's** detections. The pager tracks `activeIndex` via its `onScroll` handler; `frames[activeIndex].detections` carries the `trackId` set during `full`-projection parsing in `toDetailDetection`. The panel uses the first detection on the frame that has a non-undefined `trackId`.
- The `faceGallery` cap is system-scoped (no deviceId for the cap router itself), but `getFaceByTrack` takes `{ deviceId, trackId }` — both are passed from context available in the modal.

## The mutate pattern used

Matches `srcV2/data/use-ptz.ts`:

```typescript
const system = controller.getSystem()
await system.trpcClient.faceGallery.assignFace.mutate({ faceId, identityId })
```

Implemented defensively in `callMutate` (in `use-face-info.ts`) — reads `.mutate` off the tRPC proxy without using `capQuery` (which only wraps `.query`). Errors bubble up and are caught in each mutation method, setting the `error` state string for inline display.

## Refresh-after-mutation approach

After each successful mutation, `fetchAll(ac)` is called with a fresh `AbortController`. This re-runs both `getFaceByTrack` and `listIdentities` concurrently, updating `faceInfo` and `identities` in state. The `mutating` flag stays `true` until `fetchAll` completes, so buttons remain disabled during both the mutation and the re-fetch.

## ts-check result

`npm run ts-check` → **CLEAN** (zero errors, zero warnings). Verified after all files were written.

## Concerns

1. **TileError / expo-image placeholder**: The `EventMediaStrip` renders a `TileError` `<View>` behind each image as a fallback icon. Because expo-image renders on top of sibling views, the icon is always obscured when the image loads successfully. If base64 is invalid, expo-image will show a blank area (no visible fallback icon). A per-tile `useState` + `onError` toggle would fix this cleanly but adds complexity; accepted as a minor visual gap.

2. **`EventMediaStrip` uses `imageDetectionId`** (the frame's representative detection) rather than iterating all detections in the frame for media. This means if a non-image detection is chosen as the representative but others have richer crops, those other crops are not shown. This matches the existing pager behavior (`DetailFrameView` uses the same id).

3. **Face panel shows only the first detection's trackId per frame**. When multiple detections with different trackIds are present in the same inference frame (e.g., two faces), only the first tracked one is shown. A future enhancement could list multiple `FaceAssignPanel` instances, one per tracked detection.

4. **No unit tests for new hooks** — the project has no test framework coverage for hooks (only pure helpers in `cluster-detail.ts` are unit-tested via vitest). The new pure parsers (`parseFaceInfo`, `parseIdentities`, `parseItems`) are defensive but untested. `ts-check` covers the type layer.

5. **`listIdentities` is re-fetched on every `useFaceInfo` mount and after every mutation**. For large identity lists this could be slow; a shared React Query cache key would be more efficient, but that requires TanStack Query integration (adding complexity beyond the WS-C scope).
