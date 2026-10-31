/**
 * Source guards for the track-detail CAMERA NAME + PREV/NEXT navigation
 * (2026-08-18). The viewer suite has no renderer (vitest node env), so the
 * wiring is asserted on the source, in the style of
 * `track-trajectory-wiring.spec.ts`. Each assertion names the defect it holds
 * shut.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import enLocale from '../../../../../locales/en.json'
import itLocale from '../../../../../locales/it.json'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('the detail modal names the CAMERA, distinct from the track title', () => {
  it('TrackDetailView resolves the name from the camera directory, not the raw summary', () => {
    // Summaries built from a cluster event carry '' as
    // cameraName, and the enrichment fetch passes '' too — resolving through
    // useCameras is the only path that names the camera in EVERY context (and
    // carries the operator's client-side renames).
    const src = read('components/events/track/TrackDetailView.tsx')
    expect(src).toContain('useCameras(')
    expect(src).toContain('trackCameraName(')
  })

  it('the metadata sheet shows the RESOLVED name, not the (often empty) summary field', () => {
    const view = read('components/events/track/TrackDetailView.tsx')
    expect(view).toMatch(/<TrackMetadataSheet[\s\S]*?cameraName=/)
    const sheet = read('components/events/track/TrackMetadataSheet.tsx')
    expect(sheet).toContain('cameraName')
  })
})

describe('prev/next navigation lives in the ONE shared detail body', () => {
  it('TrackDetailView renders the navigation contract when a caller provides one', () => {
    const src = read('components/events/track/TrackDetailView.tsx')
    expect(src).toContain('navigation?: TrackDetailNavigation')
    expect(src).toContain('navigation.onPrev')
    expect(src).toContain('navigation.onNext')
    // Disabled at the ends, never hidden — a control that vanishes mid-swipe
    // moves the other arrow under the operator's finger.
    expect(src).toContain('navigation.hasPrev')
    expect(src).toContain('navigation.hasNext')
  })

  it('TrackDetailModal forwards the contract — the modal must not fork the body', () => {
    const src = read('components/events/track/TrackDetailModal.tsx')
    expect(src).toContain('navigation')
  })

  it('the neighbour maths is the ONE pure planner, everywhere', () => {
    for (const rel of [
      'components/camera/theater/detail/ClusterDetailBody.tsx',
      'hooks/use-track-list-navigation.ts',
    ]) {
      expect(read(rel)).toContain('planTrackNavigation(')
    }
  })

  it('the cluster detail navigates the SAME collection its picker chips show', () => {
    const src = read('components/camera/theater/detail/ClusterDetailBody.tsx')
    expect(src).toMatch(/<TrackDetailView[\s\S]*?navigation=/)
  })

  it('the events page hands the modal AND the split pane the gallery-ordered collection', () => {
    const src = read('screens/EventsScreen.tsx')
    expect(src).toContain('useTrackListNavigation(')
    expect(src).toMatch(/<TrackDetailModal[\s\S]*?navigation=/)
    expect(src).toMatch(/<TrackDetailView[\s\S]*?navigation=/)
  })

  it('the REEL navigates its own strip, not nothing', () => {
    // The strip opens the same modal the page does, over its own rows in the
    // strip's order. Both halves have to be true together — a navigation hook
    // with no `navigation` handed to the modal leaves the arrows gated off an
    // absent prop.
    const src = read('components/events/track/TrackReel.tsx')
    expect(src).toContain('useTrackListNavigation(')
    expect(src).toContain('tracks: feed.rows')
    expect(src).toMatch(/<TrackDetailModal[\s\S]*?navigation/)
  })

  it('a late getTrack never drags the operator back a track', () => {
    // A clicked row is upgraded in place by `getTrack`. Once an arrow has moved
    // the selection on, that in-flight upgrade is about the PREVIOUS track, and
    // applying it would undo the move. One hook owns the rule for every surface
    // (`useOpenTrack`), and the reel and the page both open through it.
    expect(read('hooks/use-open-track.ts')).toContain('resolved.trackId === opened.trackId')
    expect(read('components/events/track/TrackReel.tsx')).toContain('useOpenTrack()')
    expect(read('screens/EventsScreen.tsx')).toContain('useOpenTrack()')
  })

  it('the page navigates the rows the gallery SHOWS, in the order it shows them', () => {
    // One collection feeds the grid and the arrows; a second list kept for
    // navigation is how the arrows come to walk a different order than the eye.
    const src = read('screens/EventsScreen.tsx')
    expect(src).toContain('tracks: feed.rows')
    expect(src).toContain('<EventsGallery')
    expect(src).toContain('feed={feed}')
  })
})

describe('the new strings exist in BOTH languages', () => {
  it('en + it carry the accessibility labels', () => {
    for (const locale of [enLocale, itLocale]) {
      const tracks = (locale as { v2: { tracks: Record<string, unknown> } }).v2.tracks
      expect(typeof tracks.prevTrack).toBe('string')
      expect(typeof tracks.nextTrack).toBe('string')
    }
  })
})

describe('the Media section never vanishes silently (2026-08-21)', () => {
  // Two tracks reported as "no media, only the best shot" had every row and
  // blob on the hub — the read had failed once and the section simply was not
  // rendered. Empty and failed are now two EXPLICIT states.
  it('TrackDetailView renders an explicit failed state with a retry', () => {
    const src = read('components/events/track/TrackDetailView.tsx')
    expect(src).toContain('media.failed')
    expect(src).toContain('media.retry()')
    expect(src).toContain("t('v2.tracks.mediaLoadError'")
    expect(src).toContain("t('common.retry'")
  })

  it('TrackDetailView renders an explicit empty state for a track with no media', () => {
    const src = read('components/events/track/TrackDetailView.tsx')
    expect(src).toContain("t('v2.tracks.noMedia'")
  })

  it('both locales carry the two states', () => {
    for (const locale of [enLocale, itLocale] as const) {
      const tracks = (locale as { v2: { tracks: Record<string, unknown> } }).v2.tracks
      expect(typeof tracks.noMedia).toBe('string')
      expect(typeof tracks.mediaLoadError).toBe('string')
    }
  })
})

describe('the track detail has no separate "share image" button', () => {
  it('Download (the shared event menu) is the one way to send the image out', () => {
    const src = read('components/events/track/TrackDetailView.tsx')
    expect(src).not.toContain('useShareTrackMedia')
    expect(src).not.toContain('onShareImage')
    expect(src).not.toContain('v2.tracks.shareImage')
    expect(src).toContain('TRACK_DETAIL_DOWNLOAD_TEST_ID')
    expect(JSON.stringify(enLocale)).not.toContain('Share image')
    expect(JSON.stringify(itLocale)).not.toContain('Condividi immagine')
  })
})
