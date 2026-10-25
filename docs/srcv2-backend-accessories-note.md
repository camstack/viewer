# Backend note — `accessories` cap not registered for camera devices (child/accessory devices unavailable to clients)

**From:** camstack-viewer (srcV2 iOS app) · **To:** camstack-server backend agent
**Severity:** medium — the camera-detail "Devices" panel can never list child/accessory devices.

## TL;DR
The viewer lists a camera's child/accessory devices via the device-scoped **`accessories`** cap. For real cameras the call **throws "Capability not registered"**, so the panel is always empty. Either the `accessories` cap is not being registered/bound for camera devices that have children, or clients are meant to discover children a different way. Please confirm the intended path and fix the registration so a camera's accessories are queryable.

## What the viewer does
1. `system.trpcClient.accessories.getStatus({ deviceId })` → expects the cap's status block `{ childDeviceIds: number[], hiddenChildIds: number[] }`.
2. Visible children = `childDeviceIds` − `hiddenChildIds`.
3. Resolve each child via `system.trpcClient.deviceManager.getDevice({ deviceId: childId })` for name / type / online.
4. Render them in the camera-detail "Devices" floating panel; `setChildHidden` would back a hide/show toggle.

This matches `docs/srcv2-data-sources.md` (research) and the `accessories.cap.ts` contract.

## Observed (on-device diagnostics, live hub)
Opening the devices panel on real cameras logs:
```
[accessories] error device 97 Capability "accessories" not registered for device 97
[accessories] error device 15 Capability "accessories" not registered for device 15
```
So `accessories.getStatus({ deviceId })` rejects with **`Capability "accessories" not registered for device <id>`** for these camera devices (ids 15, 97, 127 observed). The viewer swallows this gracefully → empty panel.

## Expected
A camera that HAS child/accessory devices (doorbell chime, integration entity-children, linked sensors, etc.) should expose the `accessories` cap so `getStatus` returns its `childDeviceIds`. A camera with genuinely no children is fine to return an empty set — but it should NOT reject with "not registered" if accessories is a supported surface for that device.

## What to investigate (server side)
- Is the `accessories` cap **registered/bound** for camera devices, or only for specific providers/parents? The error implies no provider is bound for `accessories` on these device ids.
- Should clients query accessories on the **camera** device id, or on a **parent/integration** device id? (If children hang off a different parent, the viewer needs to know which id to query.)
- Is there an alternative children-discovery path we should use instead (e.g. `deviceManager` parent/child relationship — a `parentId`/`childDeviceIds` field on `DeviceInfo`)? If so, point us at it and we'll switch the viewer.
- For the test cameras (15, 97, 127): do they actually have child/accessory devices in admin-ui? If yes, the cap should be registered for them; if no, please confirm "no accessories" is the correct state (and ideally have `getStatus` return an empty set rather than reject).

## Code references
- `packages/types/src/capabilities/accessories.cap.ts` — `AccessoriesStatusSchema { childDeviceIds, hiddenChildIds }`, `setChildHidden`.
- Cap mount/registration: `server/backend/src/api/trpc/trpc.router.ts` + the generated `createCapRouter_accessories` (resolver currently rejects when no provider is bound to the device).
- Viewer consumer (for reference): `srcV2/data/use-accessories.ts`.

## Repro
1. From the srcV2 iOS viewer, open a camera and tap the devices (grid) toolbar icon.
2. The panel is empty; the Metro log shows `[accessories] error … Capability "accessories" not registered for device <id>`.
