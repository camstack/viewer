/**
 * The merged Library gallery: hub-produced artifacts and recording exports are
 * ONE list of elements, and `library-items.ts` is the single authority on what
 * each element supports.
 *
 * The rule these tests hold shut is D62's: a second component that disagrees
 * with the one owning the function is worse than no component. Before the
 * merge, "can this be deleted / played / cancelled" was answered by two screens
 * that never compared notes — `ExportsScreen` drew Download/Delete/Cancel from
 * three inline booleans and `ArtifactsScreen` drew Download from none. One
 * function, one answer, asserted here.
 */
import { describe, it, expect } from 'vitest'
import type { NcArtifactRecord } from '../../../data/nc-artifacts.js'
import type { ExportRecord, ExportState } from '../../../data/use-exports.js'
import {
  LIBRARY_KIND_ORDER,
  exportItem,
  artifactItem,
  libraryItemActions,
  libraryItemMatches,
  mergeLibraryItems,
  wantsArtifacts,
  wantsExports,
  type LibraryFilterCriteria,
} from '../library-items.js'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function artifact(over: Partial<NcArtifactRecord> = {}): NcArtifactRecord {
  return {
    id: 'a1',
    kind: 'timelapse',
    mediaType: 'video',
    mime: 'video/mp4',
    sizeBytes: 1024,
    createdAt: NOW,
    capturedAt: NOW,
    expiresAt: NOW + DAY,
    deviceId: 7,
    deviceIds: [7],
    downloadPath: '/addon/pipeline-analytics/a1',
    ...over,
  }
}

function exp(over: Partial<ExportRecord> = {}): ExportRecord {
  return {
    id: 'e1',
    deviceId: 7,
    profile: 'high',
    fromMs: NOW,
    toMs: NOW + 60_000,
    options: { includeAudio: true, maxLifeMs: DAY, deleteAfterDownload: false },
    state: 'ready',
    progressPct: null,
    fileBytes: 2048,
    expiresAt: NOW + DAY,
    deleteAfterDownload: false,
    downloadedAt: null,
    createdAt: NOW,
    createdBy: 'op',
    error: null,
    ...over,
  }
}

const ALL: LibraryFilterCriteria = { kinds: [], deviceIds: [], fromMs: NOW - DAY, toMs: NOW + DAY }

describe('what each element supports', () => {
  it('plays a video artifact, and lets it be downloaded and deleted', () => {
    const acts = libraryItemActions(artifactItem(artifact()), NOW)
    expect(acts).toEqual({ playback: true, download: true, delete: true, cancel: false })
  })

  it('plays a GIF — it is a moving picture, not a still', () => {
    expect(libraryItemActions(artifactItem(artifact({ mediaType: 'gif' })), NOW).playback).toBe(true)
  })

  it('does NOT claim playback for a still image: a mosaic has nothing to play', () => {
    const acts = libraryItemActions(artifactItem(artifact({ kind: 'summary-mosaic', mediaType: 'image' })), NOW)
    expect(acts.playback).toBe(false)
    expect(acts.download).toBe(true)
  })

  it('offers delete on an artifact — `nc.deleteArtifact` is on the wire since 2026-09-13', () => {
    // The hub removes the index row AND the bytes (and a video's poster with
    // them). Whether THIS session may remove THIS row is the hub's call, not a
    // guess made here: a global artifact is admin-only and comes back
    // `deleted: false`, which the screen reports as a refusal.
    expect(libraryItemActions(artifactItem(artifact()), NOW).delete).toBe(true)
  })

  it('still offers delete once the retention window has closed — the ROW is the operator\'s to clear', () => {
    // Same rule as a failed/expired export below: the file may be gone while
    // the index row is still listed, and a row nobody can clear is a gallery
    // that only grows.
    expect(libraryItemActions(artifactItem(artifact({ expiresAt: NOW - 1 })), NOW).delete).toBe(true)
  })

  it('withdraws download once the retention window has closed', () => {
    const acts = libraryItemActions(artifactItem(artifact({ expiresAt: NOW - 1 })), NOW)
    expect(acts.download).toBe(false)
    expect(acts.playback).toBe(false)
  })

  it('plays, downloads and deletes a ready export', () => {
    expect(libraryItemActions(exportItem(exp()), NOW)).toEqual({
      playback: true,
      download: true,
      delete: true,
      cancel: false,
    })
  })

  it('cancels an export that is still being produced, and offers nothing else', () => {
    for (const state of ['queued', 'rendering'] as const) {
      expect(libraryItemActions(exportItem(exp({ state })), NOW)).toEqual({
        playback: false,
        download: false,
        delete: false,
        cancel: true,
      })
    }
  })

  it('lets a failed or expired export be deleted but never played', () => {
    for (const state of ['failed', 'expired'] as const satisfies readonly ExportState[]) {
      const acts = libraryItemActions(exportItem(exp({ state })), NOW)
      expect(acts.delete).toBe(true)
      expect(acts.playback).toBe(false)
      expect(acts.download).toBe(false)
    }
  })

  it('offers nothing on a row whose file is already deleted', () => {
    expect(libraryItemActions(exportItem(exp({ state: 'deleted' })), NOW)).toEqual({
      playback: false,
      download: false,
      delete: false,
      cancel: false,
    })
  })
})

describe('one merged, ordered list', () => {
  it('interleaves both sources newest-first', () => {
    const items = mergeLibraryItems(
      [artifact({ id: 'a-old', capturedAt: NOW - 3_000 }), artifact({ id: 'a-new', capturedAt: NOW })],
      [exp({ id: 'e-mid', fromMs: NOW - 1_000 })],
    )
    expect(items.map((i) => i.id)).toEqual(['artifact:a-new', 'export:e-mid', 'artifact:a-old'])
  })

  it('keys the two sources apart, so an artifact and an export sharing an id are two rows', () => {
    const items = mergeLibraryItems([artifact({ id: 'x' })], [exp({ id: 'x' })])
    expect(new Set(items.map((i) => i.id)).size).toBe(2)
  })
})

describe('the filter reaches exports too', () => {
  it('keeps an export inside the day window and drops one outside it', () => {
    expect(libraryItemMatches(exportItem(exp()), ALL)).toBe(true)
    expect(libraryItemMatches(exportItem(exp({ fromMs: NOW - 5 * DAY })), ALL)).toBe(false)
  })

  it('honours the camera selection', () => {
    const onlyNine: LibraryFilterCriteria = { ...ALL, deviceIds: [9] }
    expect(libraryItemMatches(exportItem(exp({ deviceId: 7 })), onlyNine)).toBe(false)
    expect(libraryItemMatches(exportItem(exp({ deviceId: 9 })), onlyNine)).toBe(true)
  })

  it('treats `export` as one more kind chip beside the artifact kinds', () => {
    expect(LIBRARY_KIND_ORDER).toContain('export')
    const onlyExports: LibraryFilterCriteria = { ...ALL, kinds: ['export'] }
    expect(libraryItemMatches(exportItem(exp()), onlyExports)).toBe(true)
    expect(libraryItemMatches(artifactItem(artifact()), onlyExports)).toBe(false)
  })

  it('matches a mosaic through its `deviceIds`, not only its primary device', () => {
    const onlyNine: LibraryFilterCriteria = { ...ALL, deviceIds: [9] }
    expect(libraryItemMatches(artifactItem(artifact({ deviceId: null, deviceIds: [9, 11] })), onlyNine)).toBe(true)
  })
})

describe('a source nobody asked for is not fetched', () => {
  it('asks for both when no kind chip is set', () => {
    expect(wantsArtifacts([])).toBe(true)
    expect(wantsExports([])).toBe(true)
  })

  it('stops asking the hub for artifacts when only exports are selected', () => {
    // Without this the artifact query would send NO `kinds` (an empty artifact
    // subset is omitted from the wire input by `buildListArtifactsInput`) and
    // the hub would answer with every artifact there is — the exact opposite of
    // what the operator selected.
    expect(wantsArtifacts(['export'])).toBe(false)
    expect(wantsExports(['export'])).toBe(true)
  })

  it('stops listing exports when only artifact kinds are selected', () => {
    expect(wantsExports(['timelapse'])).toBe(false)
    expect(wantsArtifacts(['timelapse'])).toBe(true)
  })
})
