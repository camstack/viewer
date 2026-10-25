/**
 * Stamp the embed cache identity for this app build, once, before anything
 * renders.
 *
 * Imported for its SIDE EFFECT from `app/_layout.tsx` (alongside `i18n`), not
 * called from a component: `EmbedWarmup` builds an embed URL on the app's very
 * first commit, and an identity set from an effect would arrive after it — the
 * warm-up would then populate a different cache entry from the one the real
 * player asks for, which is the exact failure mode the warm-up exists to avoid.
 *
 * The expo imports live here rather than in `grid-embed/embed-url.ts` so that
 * module stays pure and loadable in the node-env vitest suite. `Updates.updateId`
 * and `Constants.expoConfig` are synchronous constants — no await, no gate.
 *
 * See `deriveEmbedCacheBust` for why the identity is the BUILD and not the
 * launch, and what the launch nonce it replaced was actually protecting.
 */
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'

import { deriveEmbedCacheBust, setEmbedCacheBust } from '../grid-embed/embed-url.js'

/**
 * Read the two constants defensively.
 *
 * This module runs at IMPORT time, before anything renders, on every platform
 * including the hub-served web build — where `expo-updates` is not enabled and
 * has historically raised on property access rather than returning null. A
 * throw here is not a degraded cache identity, it is a white screen, so the
 * failure mode is capped at "fall back to the declared version".
 */
function readUpdateId(): string | null {
  try {
    return Updates.updateId
  } catch {
    return null
  }
}

function readAppVersion(): string | null {
  try {
    return Constants.expoConfig?.version ?? null
  } catch {
    return null
  }
}

setEmbedCacheBust(
  deriveEmbedCacheBust({ updateId: readUpdateId(), appVersion: readAppVersion() }),
)
