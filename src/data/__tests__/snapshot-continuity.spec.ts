import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(resolve(process.cwd(), 'src', path), 'utf8')

/**
 * The freshness contract (revised 2026-08-16): a tile ALWAYS paints the frame
 * the hub names — the `stale` badge communicates age instead of blanking.
 * The previous hard paint ceiling blanked the whole grid on every resume from
 * background (no demand while suspended → server stops warming → every frame
 * ages past the ceiling) and blanked awake-but-idle battery cameras whose
 * frames legitimately age. State overlays (`stateReason`) remain authoritative
 * and are still the only way a stale photographic background is legitimate.
 *
 * Still forbidden: the five-minute display ceiling, the retained URI, and the
 * painted-frame fallback without a current candidate.
 */
describe('snapshot freshness', () => {
  it('paints whatever frame the hub names; honesty rides the stale badge', () => {
    const source = read('data/use-snapshot.ts')
    expect(source).toContain('const linkRenderable =')
    // Live clock, not the mint-time answer: a frame keeps aging between polls,
    // and the badge reads the LIVE age.
    expect(source).toContain(
      'const ageMs = capturedAt === null ? link?.ageMs ?? null : Math.max(0, Date.now() - capturedAt)',
    )
    // `liveAgeMs` was a SECOND copy of that computation that nothing read — and
    // this guard used to vouch for it, which is worse than not guarding at all:
    // a reader saw an assertion and assumed the live clock was wired up.
    expect(source).not.toContain('liveAgeMs')
    // The badge, not a blank, is the age signal.
    expect(source).toContain('SNAPSHOT_STALE_AFTER_MS')
    expect(source).toContain('ageMs > SNAPSHOT_STALE_AFTER_MS')
  })

  it('shows the age badge without a live socket — the offline case it exists for', () => {
    // Gating `stale` on a minted link meant the badge disappeared in exactly the
    // situation it is for: offline, painting a cached frame, nothing on screen
    // saying how old it was. That is the operator report the native file cache
    // was built for.
    const source = read('data/use-snapshot.ts')
    expect(source).toContain('link?.sleeping === true ||')
    expect(source).toContain('(ageMs !== null && ageMs > SNAPSHOT_STALE_AFTER_MS)')
    // And since D190 a state the SERVER named is staleness too: an offline
    // camera's frame is not live, whatever its clock says.
    expect(source).toContain('stateReason !== null ||')
  })

  it('paints the age of the frame ON SCREEN, not the newest one the hub holds', () => {
    const source = read('data/use-snapshot.ts')
    expect(source).toContain('const capturedAt = paintedCapturedAt ?? hubCapturedAt')
  })

  it('has no display ceiling, no retained URI and no stale paint window', () => {
    const source = read('data/use-snapshot.ts')
    expect(source).not.toContain('SNAPSHOT_DISPLAY_MAX_AGE_MS')
    expect(source).not.toContain('withinDisplayCeiling')
    expect(source).not.toContain('retainedUriRef')
    // The 30 s constant may remain ONLY as the log-signature bucket edge —
    // never as a paint gate.
    expect(source).not.toContain('liveAgeMs <= SNAPSHOT_PAINT_MAX_AGE_MS')
  })

  it('does not report initial loading after a frame has painted', () => {
    const source = read('data/use-snapshot.ts')
    expect(source).toContain(
      'isLoading: !everLoaded && (awaitingFrame || (uri !== null && !failed))',
    )
    expect(source).toContain('everLoaded &&')
    // A file-cache download in flight is a frame being waited for, exactly like
    // an unsettled link — otherwise a tile with nothing on disk yet reports
    // neither loading nor failed and the card paints its empty state over a
    // frame that is milliseconds away.
    expect(source).toContain(
      'const awaitingFrame = waitingForCurrentLink || cachedFile.fetching || awaitingCachedFile',
    )
    // …including the render BEFORE the download starts: the store dispatches
    // from an effect, and on an older hub the link wait does not cover that gap.
    expect(source).toContain(
      "cachedFile.supported && renderable && cachedFile.uri === null && !cachedFile.failed",
    )
  })

  it('paints local files without a Bearer, and never disk-caches them twice', () => {
    const hook = read('data/use-snapshot.ts')
    expect(hook).toContain("!uri.startsWith('file:')")
    const image = read('components/camera/SnapshotImage.tsx')
    // `expo-image`'s disk cache is what the file cache replaces on native.
    // Letting it copy our files back in would double every snapshot write and
    // restore the unnameable store the whole design removes.
    expect(image).toContain("uri.startsWith('file:') ? 'memory' : 'memory-disk'")
    // Both layers — the painted underlay and the incoming candidate.
    expect(image).toContain('cachePolicy={cachePolicyFor(painted.uri)}')
    expect(image).toContain('cachePolicy={cachePolicyFor(candidate.uri)}')
  })

  it('keeps the state reason inside the URL identity so overlays bust the native cache', () => {
    const source = read('data/snapshot-media-url.ts')
    expect(source).toContain('s-${params.stateReason}')
  })

  it('never renders the painted frame without a current candidate', () => {
    const source = read('components/camera/SnapshotImage.tsx')
    // No candidate → no image at all (the old `candidate ?? painted` fallback).
    expect(source).toContain('if (candidate === null) return null')
    expect(source).not.toContain('candidate ?? painted')
    // The painted frame survives ONLY as the underlay of an in-flight
    // replacement — never as standalone content.
    expect(source).toContain('painted !== null && replacing')
    expect(source).toContain('setPainted({ deviceId, source: candidate })')
    expect(source).toContain('onDisplay={() =>')
    expect(source).toContain('candidateLoadedRef.current')
    expect(source).toContain('key={candidate.uri}')
    // A late load of another generation is refused; the web object URL of a
    // header-carrying candidate is not (`snapshot-load-match.ts`).
    expect(source).toContain('if (!isLoadOfCandidate(event.source.url, candidate)) return')
    expect(source).toContain('recyclingKey={String(deviceId)}')
  })

  it('withholds the URI until this session has heard the hub, so disk cache cannot paint last week', () => {
    const source = read('data/use-snapshot.ts')
    expect(source).toContain('namedThisSession')
    expect(source).toContain('namedThisSession: namedThisSession.current')
  })
})
