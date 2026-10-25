import { describe, it, expect } from 'vitest'

import { CLIP_DOWNLOAD_LABEL_KEY, clipDownloadFileName, resolveClipDownload } from '../clip-download.js'
import { CLIP_EXPORT_MAX_BYTES } from '../clip-export-quality.js'
import type { Clip } from '../clip-model.js'

function clip(over: Partial<Clip> = {}): Clip {
  return {
    clipId: 'native:reolink:onboard:0:abc',
    deviceId: 107,
    startMs: 1_789_935_554_000,
    endMs: 1_789_935_582_000,
    sourceId: 'native:reolink:onboard',
    kind: 'motion',
    playback: { kind: 'native', deviceId: 107, clipId: 'native:reolink:onboard:0:abc' },
    ...over,
  }
}

const TWINS = {
  sub: { id: 'sub-id', bytes: 712_460 },
  main: { id: 'main-id', bytes: 23_736_535 },
} as const

describe('what the tile’s keep control offers, read entirely off the row', () => {
  it('offers BOTH distinct copies, defaulting to the one worth keeping', () => {
    // The frame plays the cheapest copy (D559): it is a scroll of cards on a
    // phone. A keep is the opposite, and handing over the worst copy the hub
    // holds is the defect `EXPORT_SELECTION_PROFILE` was set to 'high' to
    // avoid. Same app, opposite defaults, both right — and now the operator
    // is asked, because there are two real copies to ask about.
    const offer = resolveClipDownload(clip({ streams: TWINS }))
    expect(offer.kind).toBe('offered')
    if (offer.kind !== 'offered') throw new Error('unreachable')
    expect(offer.quality.kind).toBe('choice')
    if (offer.quality.kind !== 'choice') throw new Error('unreachable')
    expect(offer.quality.defaultProfile).toBe('high')
    expect(offer.quality.options.map((o) => o.profile)).toEqual(['high', 'low'])
    expect(offer.quality.options.map((o) => o.bytes)).toEqual([23_736_535, 712_460])
  })

  it('falls to the sub when the camera kept no main twin — and asks NOTHING', () => {
    // One copy is not a choice. A dialog with one option is friction
    // pretending to be agency; the press queues the export immediately, the
    // way it always did.
    const offer = resolveClipDownload(clip({ streams: { sub: TWINS.sub } }))
    expect(offer.kind).toBe('offered')
    if (offer.kind !== 'offered') throw new Error('unreachable')
    expect(offer.quality.kind).toBe('direct')
    if (offer.quality.kind !== 'direct') throw new Error('unreachable')
    expect(offer.quality.option.profile).toBe('low')
    expect(offer.quality.option.bytes).toBe(712_460)
  })

  it('treats twins that resolved to ONE id as one copy, not as a choice', () => {
    // A non-choice presented as a choice would owe an explanation for why
    // picking one got the other.
    const same = { sub: { id: 'one', bytes: 9 }, main: { id: 'one', bytes: 9 } } as const
    const offer = resolveClipDownload(clip({ streams: same }))
    if (offer.kind !== 'offered') throw new Error('unreachable')
    expect(offer.quality.kind).toBe('direct')
  })

  it('asks for the copy worth keeping when the catalog resolved no twins at all', () => {
    // The subject requires exactly one profile, so there is no "ask for
    // nothing" here any more. What was SERVED lands on the record and a
    // divergence is rendered rather than hidden (D549 15) — and guessing the
    // cheap one would hand over the worst copy without being asked.
    const offer = resolveClipDownload(clip())
    expect(offer.kind).toBe('offered')
    if (offer.kind !== 'offered') throw new Error('unreachable')
    expect(offer.quality.kind).toBe('direct')
    if (offer.quality.kind !== 'direct') throw new Error('unreachable')
    expect(offer.quality.option.profile).toBe('high')
    expect(offer.quality.option.bytes).toBeNull()
  })
})

describe('the 50 MiB export bound is a fact the tile already knows', () => {
  it('draws a copy over the bound DISABLED rather than dropping it', () => {
    // Dropping it would silently downgrade the keep to the sub file, which is
    // the substitution D549 15 forbids doing quietly.
    const big = { sub: TWINS.sub, main: { id: 'main-id', bytes: CLIP_EXPORT_MAX_BYTES + 1 } }
    const offer = resolveClipDownload(clip({ streams: big }))
    if (offer.kind !== 'offered') throw new Error('unreachable')
    expect(offer.quality.kind).toBe('choice')
    if (offer.quality.kind !== 'choice') throw new Error('unreachable')
    expect(offer.quality.options[0].refusal).toBe('too-large')
    // …and the DEFAULT moves to the copy that can actually be asked for.
    expect(offer.quality.defaultProfile).toBe('low')
  })

  it('accepts a copy sitting exactly ON the bound — the producer tests `>`', () => {
    const exact = { main: { id: 'main-id', bytes: CLIP_EXPORT_MAX_BYTES } }
    const offer = resolveClipDownload(clip({ streams: exact }))
    if (offer.kind !== 'offered') throw new Error('unreachable')
    if (offer.quality.kind !== 'direct') throw new Error('unreachable')
    expect(offer.quality.option.refusal).toBeNull()
  })

  it('never reads an ABSENT size as a refusal', () => {
    // An unread size is no evidence of a big file (D393). A keep that would
    // have worked must not be blocked by a row that said nothing.
    const offer = resolveClipDownload(clip())
    if (offer.kind !== 'offered') throw new Error('unreachable')
    if (offer.quality.kind !== 'direct') throw new Error('unreachable')
    expect(offer.quality.option.refusal).toBeNull()
  })

  it('disables the whole control only when EVERY copy is over the bound', () => {
    const huge = {
      sub: { id: 'sub-id', bytes: CLIP_EXPORT_MAX_BYTES + 1 },
      main: { id: 'main-id', bytes: CLIP_EXPORT_MAX_BYTES + 2 },
    }
    expect(resolveClipDownload(clip({ streams: huge }))).toEqual({ kind: 'tooLarge' })
  })
})

describe('a control that looks available and refuses is the defect this line is about', () => {
  it('is SHOWN and disabled, carrying the provider’s reason, for an unplayable row', () => {
    const offer = resolveClipDownload(clip({ playable: false, unplayableReason: 'no-file-for-window' }))
    expect(offer.kind).toBe('refused')
    if (offer.kind !== 'refused') throw new Error('unreachable')
    expect(offer.reason).toBe('no-file-for-window')
  })

  it('still refuses when the provider gave no reason, rather than inventing one', () => {
    const offer = resolveClipDownload(clip({ playable: false }))
    expect(offer).toEqual({ kind: 'refused', reason: null })
  })

  it('offers nothing at all for a clip of OUR OWN recording', () => {
    // Those are a range of the hub's footage, not a file. They are collected
    // through the export path (D558's `ExportRecord`), which has its own
    // control, its own lifetime and its own quality choice. A second way to
    // get the same thing is how the two diverge.
    const recorded = clip({ sourceId: 'analytics', playback: { kind: 'recorded', deviceId: 107 } })
    expect(resolveClipDownload(recorded)).toEqual({ kind: 'none' })
  })
})

describe('the button says what actually happens on the phone', () => {
  it('is not called “download” — the press creates an EXPORT on the hub', () => {
    // The bytes never reach this device: the recorder renders the file and it
    // is collected from the Library. "Download" would be a small lie the app
    // can simply not tell, on every platform and at every stage.
    expect(CLIP_DOWNLOAD_LABEL_KEY).toBe('v2.clips.saveClip')
  })

  it('names the file after the camera and the clip’s own instant, with an mp4 extension', () => {
    expect(clipDownloadFileName(clip())).toBe('clip-107-1789935554000.mp4')
  })
})
