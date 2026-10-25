/**
 * Start the local persisted reads at app start, not on the screen that needs
 * them.
 *
 * Imported for its SIDE EFFECT from `app/_layout.tsx`. Both stores' `hydrate()`
 * are idempotent, so the existing per-screen calls stay correct and simply find
 * the work already done.
 *
 * ## Why this is a latency fix and not tidying
 *
 * Camera prefs were hydrated from an effect inside `CameraDetailScreen`. The
 * screen initialises its stream tier as `useState(storedQuality ?? 'auto')`, so
 * on a cold open the tier starts at `auto` and FLIPS when the AsyncStorage read
 * lands a moment later. That flip changes `target`, and `LiveViewWebView`
 * injects `setTarget` on every `target` change — which the embed serves with a
 * make-before-break stream swap that REPLACES the live `<video>` element.
 *
 * So opening a camera whose quality had ever been set renegotiated the stream
 * on top of a stream that was still starting: the first picture is thrown away
 * and paid for twice. Reading the prefs while the transport is still
 * handshaking costs nothing on the critical path and makes the tier correct
 * before the player is ever mounted.
 *
 * The same argument holds for the grid store: `GridViewScreen` cannot resolve
 * its member cameras until it knows which ids the grid holds, and that read is
 * pure local I/O that need not wait for a navigation.
 */
import { useCameraPrefsStore } from '../store/camera-prefs-store.js'
import { useGridStore } from '../store/grid-store.js'
import { useLastCameraStore } from '../store/last-camera-store.js'
import { useCameraLocalStore } from '../store/camera-local-store.js'
import { useGridLocalStore } from '../store/grid-local-store.js'
import { useDeviceSettingsStore } from '../store/device-settings-store.js'
import { useSettingsStore } from '../store/settings-store.js'
import { useLanguageStore } from '../store/language-store.js'
import { useReelFilterStore } from '../store/reel-filter-store.js'
import { useReelHighlightStore } from '../store/reel-highlight-store.js'
import { useDevicePickerGroupStore } from '../store/device-picker-group-store.js'
import { useEventsFilterStore } from '../store/events-filter-store.js'

void useCameraPrefsStore.getState().hydrate()
void useGridStore.getState().hydrate()
// The device-local halves of the two documents above (stream tier, audio
// memory, timeline filters; a wall's sound and tier) and debug mode — the
// same latency argument, and the first of these reads also runs the one-time
// move out of the shared documents (`store/device-local-migration.ts`).
void useCameraLocalStore.getState().hydrate()
void useGridLocalStore.getState().hydrate()
void useDeviceSettingsStore.getState().hydrate()
// The camera the LAST session ended on. Read here for a stronger reason than
// latency: the watcher that maintains it refuses to write until this has
// landed, so hydrating late does not corrupt the value — it just delays the
// launch decision behind a disk read that could have happened during the
// handshake. See `store/last-camera-store.ts`.
void useLastCameraStore.getState().hydrate()

// The ACCOUNT stores (`account/account-sections.ts`): each one's per-hub
// cache is read as soon as a hub is bound, so the account sync finds every
// namespace ready on its first exchange instead of waiting for the screen that
// happens to use it.
void useSettingsStore.getState().hydrate()
void useLanguageStore.getState().hydrate()
void useReelFilterStore.getState().hydrate()
void useReelHighlightStore.getState().hydrate()
void useDevicePickerGroupStore.getState().hydrate()
void useEventsFilterStore.getState().hydrate()
