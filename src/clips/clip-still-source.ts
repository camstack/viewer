/**
 * WHICH address a clip tile asks for its still.
 *
 * A clip row can carry two, and they are not alternatives of equal cost:
 *
 *  - **`thumbnailUrl` — the SERVED still.** A JPEG the provider already holds
 *    on disk. One authenticated GET; it either is the picture or it is gone.
 *  - **`thumbnailMintUrl` — the MINT route.** Cuts a still out of the clip
 *    FILE, through the provider's bounded queue, answering 204 while it waits
 *    its turn.
 *
 * So: **the still that exists beats the one that has to be made.**
 *
 * That was not what the app did. Measured on 592 on 2026-09-21, `listClips`
 * answered 300 rows with 275 served stills and the tile asked the mint route
 * for all 300. `clip-mapping.ts` parsed the served URL, `Clip` documented it
 * and three spec files asserted it — and no component read it. The field read
 * as a working feature while every tile queued for a still already on disk,
 * which is what put the operator's list behind the catalog prefetch the night
 * that was wired (D577).
 *
 * An empty or whitespace-only value is ABSENT, never an address: passed to a
 * fetch it resolves against the app's own origin and 404s, turning a named
 * wait into an anonymous broken tile.
 */

/** Which of the two a still came from. They fail differently, so it is named. */
export type ClipStillOrigin = 'served' | 'mint'

export interface ClipStillSource {
  /** Hub-relative or absolute, exactly as the row carried it. */
  readonly url: string
  readonly origin: ClipStillOrigin
}

/** The two fields a clip row may carry a still address on. */
export interface ClipStillAddresses {
  readonly thumbnailUrl?: string | undefined
  readonly thumbnailMintUrl?: string | undefined
}

export function clipStillSource(clip: ClipStillAddresses): ClipStillSource | null {
  const served = usable(clip.thumbnailUrl)
  if (served !== null) return { url: served, origin: 'served' }
  const mint = usable(clip.thumbnailMintUrl)
  return mint === null ? null : { url: mint, origin: 'mint' }
}

function usable(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
