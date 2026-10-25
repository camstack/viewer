import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseClips } from '../clip-mapping.js'
import { parseClipSources, resolveClipProvider, clipSourcePickerOptions } from '../clip-sources.js'
import { cheapestClipProfile } from '../clip-quality.js'
import { resolveClipTap } from '../clip-tap.js'
import { clipStageAttach, clipStageStep, initialClipStage, resolveClipLoop } from '../clip-stage.js'
import { resolveClipDownload } from '../clip-download.js'
import { resolveClipsSurface } from '../clips-surface.js'
import { isPlayable } from '../clip-model.js'
import { resolveClipsStatus } from '../clips-status.js'
import { nativeDerivedClips, positionDerivedClips } from '../../components/camera/theater/clips-from-clusters.js'
import { buildClipAxis } from '../clip-axis.js'

/**
 * The wire, captured from the LIVE hub on 2026-09-20 — three nodes on
 * `@camstack/server@1.2.357`, `provider-reolink` and the recorder deployed.
 *
 * Every honest-state spec on this surface has a way of passing while the wire
 * lies, because a hand-written fixture is written to the reading the author
 * already has. These are the bytes the hub actually sent: 357 rows of 592's
 * onboard catalog over four hours, 2 of 3628's, and both cameras' source lists.
 * If the shape moves, this is the file that goes red.
 */
const FIXTURES = join(process.cwd(), 'src', 'clips', '__tests__', 'fixtures')

function wire(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

const SOURCES_592 = wire('live-592-sources.json')
const SOURCES_3628 = wire('live-3628-sources.json')
const CLIPS_592 = wire('live-592-native-clips.json')
const CLIPS_3628 = wire('live-3628-native-clips.json')

describe('the live source lists parse, and neither camera is told it has nothing', () => {
  it('reads both of 592’s sources with the addon each is served by', () => {
    const rows = parseClipSources(SOURCES_592)
    expect(rows.map((r) => `${r.sourceId}@${r.addonId}`)).toEqual([
      'analytics@recorder',
      'native:reolink:onboard@provider-reolink',
    ])
  })

  it('defaults both cameras to CamStack and the DERIVED list', () => {
    for (const raw of [SOURCES_592, SOURCES_3628]) {
      const choice = resolveClipProvider({ sources: parseClipSources(raw) })
      expect(choice.derivation).toBe('derived')
      expect(choice.addonId).toBe('recorder')
    }
  })

  it('offers a real two-option picker on both', () => {
    for (const raw of [SOURCES_592, SOURCES_3628]) {
      expect(clipSourcePickerOptions(parseClipSources(raw))).toHaveLength(2)
    }
  })

  it('sends provider-reolink when the operator picks the camera’s storage', () => {
    const choice = resolveClipProvider({
      chosen: 'native:reolink:onboard',
      sources: parseClipSources(SOURCES_592),
    })
    expect(choice.addonId).toBe('provider-reolink')
    expect(choice.derivation).toBe('cap')
    expect(choice.state).toBe('ok')
  })
})

describe('the live clip rows parse, and none of them is dropped', () => {
  it('keeps every row 592 sent', () => {
    // 357 rows, four hours. A parser that drops one drops it silently, which is
    // how a clips list becomes shorter than the camera's.
    expect((CLIPS_592 as readonly unknown[]).length).toBe(357)
    expect(parseClips(CLIPS_592, 592)).toHaveLength(357)
  })

  it('keeps both of 3628’s', () => {
    expect(parseClips(CLIPS_3628, 3628)).toHaveLength(2)
  })

  it('plays every one of them at the SUB file — 357 of 357', () => {
    // Measured on the wire: all 357 rows resolved a sub twin, 353 also a main.
    // The timeline is the cheap surface, so every one of these is a `low` ask.
    const clips = parseClips(CLIPS_592, 592)
    const profiles = clips.map((c) => cheapestClipProfile(c))
    expect(profiles.filter((p) => p === 'low')).toHaveLength(357)
    expect(profiles).not.toContain('high')
    expect(profiles).not.toContain(null)
  })

  it('takes every one of them to the FILE player, never to a seek', () => {
    const taps = parseClips(CLIPS_592, 592).map((c) => resolveClipTap(c))
    expect(taps.every((t) => t.kind === 'file')).toBe(true)
    expect(taps.some((t) => t.kind === 'seek')).toBe(false)
  })

  it('treats every one of them as playable — not one row carries `playable`', () => {
    // The field is absent on the whole fleet today. A parser that read absence
    // as a refusal would empty this surface entirely, on a camera holding 357
    // clips of the last four hours.
    expect(parseClips(CLIPS_592, 592).every((c) => isPlayable(c))).toBe(true)
  })

  it('carries a picture for every row that has one, and claims none for the rest', () => {
    // 242 of 357 carried a mint on this capture; the provider cuts stills on
    // demand and the catalog row says whether it will offer to. A card with no
    // offer draws its glyph — it does not draw the recorder's frame for an
    // instant we never recorded.
    const clips = parseClips(CLIPS_592, 592)
    const withMint = clips.filter((c) => c.thumbnailMintUrl !== undefined)
    expect(withMint.length).toBeGreaterThan(0)
    expect(withMint.length).toBeLessThan(clips.length)
    for (const clip of withMint) {
      expect(clip.thumbnailMintUrl).toMatch(/^\/addon\/provider-reolink\/clip-thumb\/592\//)
    }
  })

  it('keeps the camera’s own words and the hub’s side by side', () => {
    const clips = parseClips(CLIPS_3628, 3628)
    expect(clips[0]?.nativeTypes).toEqual(['people'])
    expect(clips[0]?.labels).toEqual(['person'])
  })
})

describe('the live rows lay out as cards', () => {
  it('every parsed row becomes exactly one card', () => {
    const clips = parseClips(CLIPS_592, 592)
    const derived = nativeDerivedClips(clips)
    const axis = buildClipAxis(derived.map((d) => d.clip), {
      topMs: Date.now(),
      sizePx: 96,
      gapPx: 24,
      minGapMs: 2_000,
    })
    expect(positionDerivedClips(axis, derived)).toHaveLength(clips.length)
  })

  it('a card’s picture is the provider’s mint, never a recorded still', () => {
    const clips = parseClips(CLIPS_592, 592).filter((c) => c.thumbnailMintUrl !== undefined)
    const derived = nativeDerivedClips(clips)
    const axis = buildClipAxis(derived.map((d) => d.clip), {
      topMs: Date.now(),
      sizePx: 96,
      gapPx: 24,
      minGapMs: 2_000,
    })
    for (const card of positionDerivedClips(axis, derived)) {
      // On `thumbnailMintUrl`, and NOT on `mediaUrl`. `mediaUrl` goes straight
      // to `<Image src>`, and this address answered 204 for 43 of the 60 tiles
      // of a measured first paint — an `<Image>` cannot read a 204's headers,
      // so a queued still became an anonymous broken tile that never came
      // back (D563, D573).
      expect(card.anchorEvent.thumbnailMintUrl).toMatch(/clip-thumb/)
      expect(card.anchorEvent.mediaUrl).toBeUndefined()
    }
  })
})

describe('a first paint on this wire says the right thing', () => {
  const base = { active: true, connected: true, loading: false, failed: false }

  it('is quiet once the cards are up', () => {
    const rows = parseClipSources(SOURCES_592)
    const choice = resolveClipProvider({ chosen: 'native:reolink:onboard', sources: rows })
    expect(
      resolveClipsStatus({
        ...base,
        clipCount: parseClips(CLIPS_592, 592).length,
        sourceState: choice.state,
        chosenMissing: choice.chosenMissing,
      }),
    ).toBe('hidden')
  })

  it('is LOADING at the first frame, not empty', () => {
    // Before `listSources` answers there is no state and no count. The old
    // resolver would have said `empty` here — the blank the operator cannot act
    // on — which is the frame every fixture-warmed spec skips over.
    const cold = resolveClipProvider({ chosen: 'native:reolink:onboard', sources: [] })
    expect(cold.addonId).toBeNull()
    expect(
      resolveClipsStatus({ ...base, loading: true, clipCount: 0, sourceState: cold.state }),
    ).toBe('loading')
  })

  it('says EMPTY only once an ok source has answered with nothing', () => {
    const rows = parseClipSources(SOURCES_592)
    const choice = resolveClipProvider({ chosen: 'native:reolink:onboard', sources: rows })
    expect(choice.state).toBe('ok')
    expect(
      resolveClipsStatus({ ...base, clipCount: 0, sourceState: choice.state }),
    ).toBe('empty')
  })
})

describe('the frame, the loop and the tile control, over the REAL rows', () => {
  const rows592 = parseClips(CLIPS_592, 592)
  const rows3628 = parseClips(CLIPS_3628, 3628)

  it('every one of 592’s 357 rows is closed, so every one of them LOOPS', () => {
    // Not one measured row carries `inProgress`. The flag exists (the cap
    // documents a growing file that reported the same endTime for eight
    // minutes) but it is the rare case, and the common case must not be the
    // one that behaves oddly: a closed clip repeats.
    expect(rows592).toHaveLength(357)
    expect(rows592.every((c) => resolveClipLoop(c).loop)).toBe(true)
    expect(rows592.every((c) => resolveClipLoop(c).reason === 'closed')).toBe(true)
  })

  it('every row can take the frame, and every one of them asks for the CHEAP copy there', () => {
    for (const clip of rows592) {
      const stage = clipStageAttach(initialClipStage, clip)
      expect(stage.kind).toBe('clip')
      if (stage.kind !== 'clip') continue
      expect(stage.profile).toBe('low')
      expect(stage.loop).toBe(true)
      expect(stage.inProgress).toBe(false)
    }
  })

  it('and the TILE control on the same rows offers the copy worth keeping — the other one', () => {
    // The two polarities, side by side on the same 357 rows: the frame plays
    // 0.67 MB, the keep defaults to ~20 MB. Anyone who makes them agree has
    // broken one of them.
    const offers = rows592.map((c) => resolveClipDownload(c))
    expect(offers.every((o) => o.kind === 'offered')).toBe(true)
    const defaults = offers.map((o) =>
      o.kind !== 'offered'
        ? null
        : o.quality.kind === 'choice'
          ? o.quality.defaultProfile
          : o.quality.option.profile,
    )
    // The wire's own distribution, and it is the reason this is not
    // `every(d => d === 'high')`: some of these rows resolved no main twin, or
    // a main twin the export path will refuse, and the control on those falls
    // to the SUB rather than defaulting to a copy that cannot be kept. A
    // fixture written to the author's expectation would have said 'high' for
    // all 357 and passed — this went red on the real bytes the first time.
    expect(defaults.filter((d) => d === 'high')).toHaveLength(267)
    expect(defaults.filter((d) => d === 'low')).toHaveLength(90)
  })

  it('and 353 of the 357 rows have TWO distinct copies, so the picker is the normal case', () => {
    // A clip with one copy gets no dialog. On this camera that is 4 rows out
    // of 357 — which is what makes the picker worth building and what makes
    // the single-copy short-circuit worth keeping.
    const offers = rows592.map((c) => resolveClipDownload(c))
    const choice = offers.filter((o) => o.kind === 'offered' && o.quality.kind === 'choice')
    const direct = offers.filter((o) => o.kind === 'offered' && o.quality.kind === 'direct')
    expect(choice).toHaveLength(353)
    expect(direct).toHaveLength(4)
    // Not one row pairs its twins onto the same id, so the distinctness test
    // never fires on this wire — it is there for a catalog that does.
    expect(choice.length + direct.length).toBe(357)
  })

  it('and a QUARTER of them have a main twin the export path would refuse', () => {
    // The 50 MiB read bound (`RECORDING_EXPORT_MAX_READ_BYTES`) is not an edge
    // case on this camera: 86 of 357 rows carry a main over it, the largest at
    // 166.9 MB, and NOT ONE carries a sub over it. That asymmetry is the whole
    // argument for showing the refused option disabled instead of dropping it:
    // dropping would silently hand the operator the sub on a quarter of his
    // catalog, which is the substitution D549 15 forbids doing quietly.
    const offers = rows592.map((c) => resolveClipDownload(c))
    const refusedHighs = offers.filter(
      (o) =>
        o.kind === 'offered' &&
        o.quality.kind === 'choice' &&
        o.quality.options.some((opt) => opt.profile === 'high' && opt.refusal === 'too-large'),
    )
    expect(refusedHighs).toHaveLength(86)
    const refusedSubs = offers.filter(
      (o) =>
        o.kind === 'offered' &&
        o.quality.kind === 'choice' &&
        o.quality.options.some((opt) => opt.profile === 'low' && opt.refusal !== null),
    )
    expect(refusedSubs).toHaveLength(0)
    // …so the control itself is never disabled on this wire: every row still
    // has one copy that can be kept.
    expect(offers.some((o) => o.kind === 'tooLarge')).toBe(false)
  })

  it('stepping walks the whole list of 592 and stops at both ends without wrapping', () => {
    let at = rows592[0]
    let seen = 1
    for (;;) {
      if (at === undefined) throw new Error('unreachable')
      const next = clipStageStep(rows592, at.clipId, 1)
      if (next === null) break
      at = next
      seen += 1
    }
    expect(seen).toBe(357)
    expect(clipStageStep(rows592, rows592[0]?.clipId ?? '', -1)).toBeNull()
  })

  it('3628 — two clips and no more — is navigable in exactly the same way', () => {
    // The camera the operator named as the second case. It has a clip list and
    // nothing else to anchor navigation to; stepping is the whole surface.
    expect(rows3628).toHaveLength(2)
    const first = rows3628[0]
    if (first === undefined) throw new Error('unreachable')
    expect(clipStageStep(rows3628, first.clipId, 1)?.clipId).toBe(rows3628[1]?.clipId)
    expect(clipStageStep(rows3628, first.clipId, -1)).toBeNull()
  })

  it('both cameras get the axis-free surface, because both are on a FILE source', () => {
    for (const raw of [SOURCES_592, SOURCES_3628]) {
      const sources = parseClipSources(raw)
      const native = sources.find((s) => s.sourceId.startsWith('native:'))
      expect(native).toBeDefined()
      const surface = resolveClipsSurface({ clipsMode: true, derivation: 'cap' })
      expect(surface.playhead).toBe(false)
      expect(surface.stepsClips).toBe(true)
    }
  })
})
