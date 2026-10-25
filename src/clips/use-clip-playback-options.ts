/**
 * use-clip-playback-options — the app's ONE read of
 * `videoclips.getPlaybackOptions`, for one camera and one provider.
 *
 * The hub answers a statement about WIRING, from a constant: which of the
 * three envelopes this provider's transport buys (`clip-playback-options.ts`).
 * It never touches the camera, so it costs nothing to ask and it does not wake
 * a sleeping one — but it is also nearly immutable, so it is cached hard and
 * polled on the app-wide reconcile backstop only. Its answer moves when a
 * provider BINDING moves, which is a human-paced event.
 *
 * ## Why `rethrow`
 *
 * `capQuery`'s default swallows three different events into one `null`: the
 * hub has no such method, the call failed, the call never answered. Here the
 * first is a real ANSWER — `getPlaybackOptions` is an `optionalMethod` and a
 * hub older than this app simply does not have it, which is `absent` and means
 * the freedom this app always had. The other two are not answers at all and
 * must reach the caller as `unknown`, so they are re-thrown. Without that
 * distinction a failed read would masquerade as "this hub is old", which is
 * the collapse D315 is about, one layer down.
 */
import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ClipPlaybackOptions } from '@camstack/types'

import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from '../data/cap-query.js'
import { RECONCILE_MS } from '../data/reconcile.js'
import {
  LEGACY_CONTROLS_VIEW,
  resolveClipControls,
  type ClipControlsView,
} from './clip-controls.js'
import {
  parseClipPlaybackOptions,
  type ClipPlaybackPresence,
} from './clip-playback-options.js'

/** The key for one camera+provider's envelope. */
export function clipPlaybackOptionsKey(
  deviceId: number,
  provider: string,
): readonly unknown[] {
  return ['v2', 'clip-playback-options', deviceId, provider]
}

/**
 * Classify a settled query into the presence vocabulary.
 *
 * Exported for the unit test: the mapping is the whole decision, and it is
 * worth pinning without a React tree around it. `asked === false` is `absent`
 * and not `pending`: there is no question in flight, so nothing is going to
 * answer, and a surface left `pending` forever would never draw anything.
 */
export function classifyClipPlaybackOptions(input: {
  readonly asked: boolean
  readonly status: 'pending' | 'error' | 'success'
  readonly options: ClipPlaybackOptions | null | undefined
}): ClipPlaybackPresence {
  if (!input.asked) return 'absent'
  if (input.status === 'pending') return 'pending'
  if (input.status === 'error') return 'unknown'
  // A settled success carrying no envelope is a hub that answered `null` —
  // the method is not there, or no provider serves this camera.
  return input.options === null || input.options === undefined ? 'absent' : 'present'
}

/**
 * What this camera's clips, from this provider, can be driven to do.
 *
 * `provider` is the ADDON id the clip on screen came from (`clip-sources.ts`);
 * `null` means nothing is asking — no clip, no provider — and the answer is
 * the legacy freedom rather than a question left hanging.
 */
export function useClipPlaybackOptions(
  deviceId: number | null,
  provider: string | null,
): ClipControlsView {
  const { controller, state } = useConnection()
  const asked =
    deviceId !== null &&
    Number.isFinite(deviceId) &&
    provider !== null &&
    provider.length > 0 &&
    state === 'connected'

  const query: UseQueryResult<ClipPlaybackOptions | null> = useQuery<ClipPlaybackOptions | null>({
    queryKey: clipPlaybackOptionsKey(deviceId ?? -1, provider ?? ''),
    enabled: asked,
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'videoclips',
        'getPlaybackOptions',
        { deviceId, provider },
        // See the header: an absent optional method still answers `null`;
        // everything else is a failure the caller must be able to tell apart.
        { rethrow: true },
      )
      return parseClipPlaybackOptions(raw)
    },
  })

  const presence = classifyClipPlaybackOptions({
    asked,
    status: query.status,
    options: query.data,
  })
  const options = query.data ?? null

  return useMemo(
    () => (asked ? resolveClipControls(presence, options) : LEGACY_CONTROLS_VIEW),
    [asked, presence, options],
  )
}
