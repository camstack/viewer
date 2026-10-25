/**
 * set-device — the embed player's in-place camera swap contract.
 *
 * A fresh embed page per camera open pays the whole cold path again: page
 * boot, a second WebSocket + auth handshake, config handshake, TURN fetch.
 * The `setDevice` command lets a host swap the camera on the ALREADY-BOOTED
 * page: the SDK system (WebSocket), query client and TURN cache survive; only
 * the player component remounts. The remount is deliberate — recreating the
 * video element is what guarantees the previous camera's last frame can never
 * linger across a swap.
 *
 * The command crosses a trust boundary (injected JS on native, `postMessage`
 * on web), so the shape is validated here and malformed input resolves to
 * `null` (a no-op for the caller) rather than throwing inside the page.
 */
import { z } from 'zod'
import { CamProfileSchema } from '@camstack/types/client'

/**
 * WebRTC target for the swapped-to camera. Mirrors the page config's target
 * union (`adaptive` | `profile`) — `cam-stream` stays out of the embed
 * contract, same as the boot config.
 */
export const embedTargetSchema = z.union([
  z.object({ kind: z.literal('adaptive') }),
  z.object({ kind: z.literal('profile'), profile: CamProfileSchema }),
])

export type EmbedTarget = z.infer<typeof embedTargetSchema>

export const setDeviceCommandSchema = z.object({
  deviceId: z.number().int().nonnegative(),
  /** Absent → the page keeps the target it booted with. */
  target: embedTargetSchema.optional(),
  /** Absent → the page keeps the muted flag it booted with. */
  muted: z.boolean().optional(),
  /** Absent → the page keeps the stats flag it booted with. */
  stats: z.boolean().optional(),
  /** Cold-start poster for the NEW camera (data URL). Optional — the native
   *  host keeps its own opaque poster over the WebView until 'playing', so an
   *  absent snapshot is black-under-cover, never the previous camera. */
  snapshot: z.string().optional(),
  /**
   * The instant the swapped-to camera opens at (epoch ms). ABSENT ⇒ the new
   * camera opens LIVE.
   *
   * ## Why a swap may carry an instant (2026-09-12, D483)
   *
   * The swap used to open live unconditionally, and the page said why: "so the
   * deep-link instant never leaks onto a different camera". That invariant was
   * about a LEAK — the boot config's `initialSeekMs` belongs to the camera the
   * page was opened for, and letting it apply to a different one would seek
   * camera B to an instant chosen for camera A, silently.
   *
   * This field is the opposite of a leak: the host passes it as an ARGUMENT
   * because the operator's gesture means "camera B at the moment I am looking
   * at". The boot config's instant still never travels — the page reads
   * `initialSeekMs` from the swap or from nothing, never from the config it
   * booted with (`EmbedPlayerPage`).
   *
   * It is what keeps the swap flash-free. Without it the host would have to
   * swap and THEN seek over the control channel, which is precisely the
   * "host round-trip, live-first flash" that config-carried seeking was built
   * to remove (`playback/initial-seek.ts`).
   */
  atMs: z.number().int().positive().optional(),
})

export type SetDeviceCommand = z.infer<typeof setDeviceCommandSchema>

/** Validate an untrusted `setDevice` payload. `null` = reject (caller no-ops). */
export function parseSetDeviceCommand(raw: unknown): SetDeviceCommand | null {
  const parsed = setDeviceCommandSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
