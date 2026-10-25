import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source guards for the LIVE clip surface — `clipsMode` inside
 * `TheaterTimeline` — that nothing else can hold.
 *
 * Geometry lives in `src/clips/__tests__/clip-axis.spec.ts` (compressed axis)
 * and `clip-clusters.spec.ts` (one card per visit). What is left here is the
 * set of decisions a future edit could silently undo:
 *
 *  1. Clips-mode never re-acquires a playback path of its own — no HLS
 *     `getClipPlayback`, and the server-list surface it once drove
 *     (`TimelineClipsPanel.tsx`, `ClipRibbon.tsx`, `ClipSourceChips.tsx`,
 *     `use-clips.ts`) stays deleted (Task 3.1,
 *     `docs/design/plans/fase-3-viewer-timeline-clip.md`).
 *  2. Clips is a MODE of the theater timeline, not a body-replacing panel.
 *     The floating clip pill must not `panels.toggle('clips')`.
 *  3. Visit cards use the clip's snapshot (`mediaUrl` / `thumbnailUrl`), never
 *     a frame pulled from the fMP4.
 */

const SRC = join(process.cwd(), 'src')
const BODY_PANEL = join(SRC, 'components', 'camera', 'theater', 'TimelineBodyPanel.tsx')
const LAYOUT = join(SRC, 'components', 'camera', 'theater', 'timeline-layout.ts')
const THEATER = join(SRC, 'components', 'camera', 'theater', 'TheaterTimeline.tsx')
const FOOTER = join(SRC, 'components', 'camera', 'theater', 'TimelineFloatingTools.tsx')
const THUMB = join(SRC, 'components', 'camera', 'theater', 'EventThumb.tsx')
/** Where the thumb's address DECISION lives since the timeline gained a second
 *  kind of item (a summary addresses a media row, a track an owner). */
const THUMB_ADDRESS = join(SRC, 'components', 'camera', 'theater', 'thumb-address.ts')
const CLUSTERS = join(SRC, 'components', 'camera', 'theater', 'clips-from-clusters.ts')
const DERIVED = join(SRC, 'components', 'camera', 'theater', 'clips-from-clusters.ts')

/** Task 3.1 deleted these — the server-list panel and everything that only
 *  fed it. A regression here means the panel (or its ribbon, its per-source
 *  chips, or its direct `videoclips` read) grew back beside `clipsMode`
 *  instead of the mode being fixed. */
const DELETED_PANEL = join(SRC, 'components', 'camera', 'theater', 'TimelineClipsPanel.tsx')
const DELETED_RIBBON = join(SRC, 'components', 'camera', 'clips', 'ClipRibbon.tsx')
const DELETED_CHIPS = join(SRC, 'components', 'camera', 'clips', 'ClipSourceChips.tsx')
const DELETED_HOOK = join(SRC, 'data', 'use-clips.ts')

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/** Strip block and line comments — a guard must police CODE, not prose that
 *  merely mentions the thing it forbids. */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the dead clips panel stays deleted', () => {
  it('TimelineClipsPanel, ClipRibbon, ClipSourceChips and use-clips.ts do not come back', () => {
    // The live surface is `clipsMode` inside `TheaterTimeline` — a card list
    // derived from the SAME clusters the normal timeline already built, never
    // a second read of `videoclips.listClips`. These four files existed only
    // to feed the server-list panel that path replaced; a regression means
    // someone re-introduced the panel next to the mode instead of fixing the
    // mode.
    for (const file of [DELETED_PANEL, DELETED_RIBBON, DELETED_CHIPS, DELETED_HOOK]) {
      expect(existsSync(file)).toBe(false)
    }
  })
})

describe('the clip surface grows no second playback path', () => {
  it('never asks for a clip playback URL', () => {
    for (const file of [THEATER, DERIVED]) {
      expect(code(file)).not.toContain('getClipPlayback')
    }
  })

  it('does not reintroduce the deleted server-list read path', () => {
    const src = code(THEATER)
    expect(src).not.toContain('TimelineClipsPanel')
    expect(src).not.toContain('ClipRibbon')
    expect(src).not.toContain('use-clips.js')
  })
})

describe('clips is a mode of the timeline, not a panel', () => {
  it('is not a member of the body-replacing panel union', () => {
    expect(code(LAYOUT)).not.toContain("'clips'")
    expect(code(BODY_PANEL)).not.toContain("case 'clips':")
    expect(code(BODY_PANEL)).not.toContain('TimelineClipsPanel')
  })

  it('is toggled as clipsMode — the timeline chrome stays mounted', () => {
    const src = code(THEATER)
    expect(src).toContain('clipsMode')
    expect(src).not.toContain("panels.toggle('clips')")
    expect(src).not.toContain('clipsBinding={{')
  })

  it('lights the floating clip pill while the mode is on', () => {
    expect(code(FOOTER)).toContain('clipsActive')
    expect(code(FOOTER)).toContain('active={clipsActive}')
  })
})

describe('visit cards use the clip snapshot', () => {
  it('the derived clip carries the cluster anchor snapshot as its thumbnail', () => {
    // clip-clusters.ts (the old server-list mapper) is deleted — clips-mode
    // cards derive from the normal clusters, and the visit snapshot is the
    // cluster's own anchor media.
    expect(code(CLUSTERS)).toContain('cluster.anchorEvent.mediaUrl')
    expect(code(CLUSTERS)).toContain('thumbnailUrl')
  })

  it('EventThumb honours an explicit mediaUrl instead of fetching by clip id', () => {
    // Track cards pass undefined on purpose (stamped mediaUrl 404s). Clip cards
    // carry the visit snapshot; ignoring it would show the class icon.
    expect(code(THUMB)).toContain('event.mediaUrl')
  })

  it('EventThumb keeps a RECOVERY address when the stamped snapshot dies', () => {
    // The hub stamps `thumbnail` on every clip without vouching for it —
    // measured on device 3836: 62 of 177 clips 404, 61 of its 95 motion clips.
    // D482: a bare id can no longer mint a direct URL, so the recovery is an
    // explicit OWNER address naming the visit's own object event, never a
    // guessed type. This disables the base64 getEventMedia fallback for clip
    // cards specifically, so a dead URL goes straight to the question-mark
    // glyph. Track cards were already hardened this way.
    expect(code(THUMB)).toContain("fallbackAddress: { kind: 'owner', ownerType: 'object', ownerId: event.mediaFallbackId }")
    // The recovery address must NOT become the primary source: it is passed
    // as the hook's fallback, never as `primaryAddress`, or the card would
    // quietly stop showing the visit snapshot it exists to show. The rule now
    // lives in `thumbMediaAddress` — a card holding a snapshot resolves NO
    // address at all — so both halves are read: the call that passes the fact,
    // and the branch that honours it.
    expect(code(THUMB)).toContain('thumbMediaAddress(event, snapshotUrl !== undefined)')
    expect(code(THUMB_ADDRESS)).toContain('if (hasSnapshot) return null')
  })
})

describe('the clips advance loop cannot fire on a foreign playhead', () => {
  it('skips while a seek has not landed', () => {
    // A cluster tap from LIVE enters recorded playback with the embed still
    // reporting live positions; `reconcilePosition` adopts the third straggler,
    // so the playhead is ~now. Running the advance on that cascades the ribbon
    // to its newest clip — "you tap a clip and land on a later one".
    expect(code(THEATER)).toContain('if (props.seekAnchor !== null) return')
  })

  it('the screen hands the machine anchor down', () => {
    const screen = code(join(SRC, 'screens', 'CameraDetailScreen.tsx'))
    expect(screen).toContain('seekAnchor={playback.state.seekAnchor}')
  })
})

describe('an unreadable clip day is not painted as an empty one', () => {
  // The hook that used to fail loudly on its own bulk deadline (`rethrow:
  // true`, `BULK_QUERY_DEADLINE_MS`) is deleted with the panel it fed — clips
  // no longer have a read of their own, so a failure is entirely the tracks
  // query's and the activity query's to report, which the two tests below
  // guard.
  it('the empty state now waits on the read the cards are DERIVED from', () => {
    // Clips no longer have a read of their own, so "loading" and "failed" are
    // the tracks query's answers. Reporting a clip failure separately would
    // duplicate the `events` fault the same query already raises.
    const src = code(THEATER)
    expect(src).toContain('tracksQuery.isLoading || activityQuery.loading')
    expect(src).toContain('tracksQuery.isError || activityQuery.failed')
  })

  it('loading / empty / offline are rendered, and are not each other', () => {
    expect(code(THEATER)).toContain('resolveClipsStatus')
  })
})

describe('clips mode derives its cards from the timeline clusters', () => {
  it('does not ask the server for a SECOND clustering of the same camera', () => {
    // The defect: `listClips` clusters the hub's own event log into visits with
    // its own gap constant, its own labels and its own truncation, while the
    // timeline clusters `listTracks` client-side. Two clusterers over two
    // datasets diverge, and the operator saw it — different cards in the two
    // modes on the same camera.
    //
    // AMENDED 2026-09-20, and the reason is restated rather than the assertion
    // deleted (D569). This file used to forbid `useCameraClips` outright. What
    // the defect actually needs is that the two derivations are never on screen
    // TOGETHER — and the operator settled that himself: *"La sorgente deve
    // essere selezionata … come provider di quella camera. Mai mischiate
    // provider diversi."* One camera has one source, picked in its settings.
    // When it is CamStack the cards are `deriveClipsFromClusters` and the cap
    // is not read at all; when it is the camera's own storage the cards are
    // that source's files and the derived list is not built. A camera whose
    // clips live on its SD card cannot be served by a derivation over footage
    // we never recorded, so forbidding the read outright would mean showing no
    // clips on a camera full of them.
    //
    // What stays forbidden is the MERGE, and `camera-clips-wiring.spec.ts`
    // holds that: the theater branches on `clips.choice.derivation` and never
    // concatenates the two lists. `clipsToClusters` — the old server-side
    // re-clustering — stays gone.
    const src = code(THEATER)
    expect(src).not.toContain('clipsToClusters')
    expect(src).toContain("clips.choice.derivation === 'cap'")
    expect(src).not.toContain('...derivedClips, ...')
  })

  it('builds the clip list from the cluster list plus recording availability', () => {
    const src = code(THEATER)
    expect(src).toContain('deriveClipsFromClusters')
    expect(src).toContain('clusters: eventClusters')
    expect(src).toContain('recording: activity.recording')
  })

  it('lays the SAME cluster objects onto the compressed axis', () => {
    const src = code(THEATER)
    expect(src).toContain('positionDerivedClips(clipAxis, derivedClips)')
    // The linear-mode cards and the clips-mode cards come from one call.
    expect(src).toContain('clusterByZoom(filteredEvents')
  })

  it('the derivation never mints a card from anything but the cluster', () => {
    const src = code(DERIVED)
    // Spreading the cluster is the guarantee: no second place decides what a
    // clips-mode card says.
    expect(src).toContain('...entry.cluster')
    expect(src).not.toContain('capQuery')
    expect(src).not.toContain('useQuery')
  })
})

describe('a clips tap identifies the CLIP, not the event under the finger', () => {
  it('resolves the tapped card to its clip and plays that clip from its start', () => {
    const src = code(THEATER)
    // `setActiveClipId(event.id)` handed an EVENT id to a sequencer that looks
    // ids up in the CLIP list: `resolveClipAdvance` found nothing and returned
    // `hold` for the rest of the session, so clips mode played one clip and
    // then ran on into the dead air it exists to skip.
    expect(src).toContain('clipForCardId(derivedClipsRef.current, cluster.id)')
    expect(src).toContain('setActiveClipId(clip.clipId)')
    expect(src).not.toContain('setActiveClipId(event.id)')
    // AMENDED 2026-09-20: the seek is no longer unconditional. `resolveClipTap`
    // owns which of the two players a clip goes to — OUR footage is a seek by
    // epoch, a file the camera wrote is a fetch and the file player, and
    // seeking a native clip's epoch would play whatever our recorder happened
    // to hold at that instant. The instant is still `clip.startMs` and still
    // comes from the CLIP, which is what this test exists to hold.
    expect(src).toContain("onSeek(tap.epochMs, 'cluster')")
    expect(src).toContain('resolveClipTap(clip)')
  })

  it('the card hands its cluster to the press handler', () => {
    // Without the card there is nothing to resolve: an event id is shared by
    // the normal timeline and cannot name a clip.
    // `ClusterSlot` is where the press is bound to its card (the slot exists so
    // the binding is not re-created on every render of the list).
    expect(code(join(SRC, 'components', 'camera', 'theater', 'TimelineScroller.tsx')))
      .toContain('onPress(event, cluster)')
  })

  it('a clips card does not page to a subject the tap will not honour', () => {
    const scroller = code(join(SRC, 'components', 'camera', 'theater', 'TimelineScroller.tsx'))
    const card = code(join(SRC, 'components', 'camera', 'theater', 'ClusterCard.tsx'))
    expect(scroller).toContain('paging={enableClusterActions}')
    expect(card).toContain('const events: readonly ObjectEvent[] = !paging')
  })
})

describe('switching the axis cannot commit a seek', () => {
  it('re-anchors the list itself when the compressed axis appears or goes', () => {
    // The surviving scroll offset is clamped by the ScrollView the moment the
    // content height changes, and `use-timeline-scrub` cannot tell that scroll
    // from a finger — so the clapperboard used to throw the player onto the
    // oldest clip. A programmatic scroll is not read as a scrub.
    const src = code(THEATER)
    expect(src).toContain('compressedAxisRef')
    expect(src).toContain('scrollListTo(mappedEpochToOffset(activeEpoch ?? topMs')
  })
})

describe('an unlanded availability read is not an empty camera', () => {
  it('the clips status waits on the FOOTAGE read as well as the tracks read', () => {
    // A clip is a cluster WITH FOOTAGE under it. With only the tracks query
    // consulted, the body said "no clips for this camera" for as long as the
    // availability bundle took, then filled with cards.
    const src = code(THEATER)
    expect(src).toContain(': tracksQuery.isLoading || activityQuery.loading')
    expect(src).toContain(': tracksQuery.isError || activityQuery.failed')
  })

  it('a failed availability read reaches the ONE fault slot', () => {
    // `timeline-faults.ts` claims in prose that a clips failure is reported
    // "as `recordings`" — the signal only ever carried the day-window coverage
    // query, never the extended-window bundle the cards are derived from.
    const src = code(THEATER)
    expect(src).toContain('coverageQuery.isError || activityQuery.failed')
    expect(src).toContain('refetchActivity()')
  })
})

describe('a footage-only card is not a blank card', () => {
  it('carries the recorder still at the instant that can actually be decoded', () => {
    const src = code(DERIVED)
    expect(src).toContain('stillMediaPath(clip.deviceId, entry.stillAtMs)')
  })
})
