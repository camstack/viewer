import { describe, it, expect } from 'vitest'
import { nativeDerivedClips, positionDerivedClips } from '../clips-from-clusters.js'
import { buildClipAxis } from '../../../../clips/clip-axis.js'
import type { Clip } from '../../../../clips/clip-model.js'

const T0 = 1789933690000

function nativeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    clipId: 'native:reolink:onboard:0:abc',
    deviceId: 107,
    startMs: T0,
    endMs: T0 + 30_000,
    sourceId: 'native:reolink:onboard',
    kind: 'native',
    playback: { kind: 'native', deviceId: 107, clipId: 'native:reolink:onboard:0:abc' },
    labels: ['animal'],
    thumbnailMintUrl: '/addon/provider-reolink/clip-thumb/592/687d6b38',
    ...overrides,
  }
}

function axisFor(clips: readonly Clip[]) {
  return buildClipAxis(clips, { topMs: T0 + 120_000, sizePx: 96, gapPx: 24, minGapMs: 2_000 })
}

describe('nativeDerivedClips', () => {
  it('carries a native clip with NO cluster behind it', () => {
    // There is no cluster: a native clip is a file the camera wrote, and no
    // track of ours explains it. That is the honest shape, and it is the branch
    // `positionDerivedClips` has to grow.
    const [entry] = nativeDerivedClips([nativeClip()])
    expect(entry?.cluster).toBeNull()
    expect(entry?.clip.clipId).toBe('native:reolink:onboard:0:abc')
  })

  it('claims NO recorded still', () => {
    // `stillAtMs` is an instant inside OUR footage. A native clip is not in it,
    // and a card that addressed one would ask the recorder for a frame of a
    // file it has never seen.
    expect(nativeDerivedClips([nativeClip()])[0]?.stillAtMs).toBeUndefined()
  })

  it('drops a row the provider refuses rather than offering a dead tap', () => {
    const entries = nativeDerivedClips([
      nativeClip(),
      nativeClip({ clipId: 'b', playable: false, unplayableReason: 'still being written' }),
    ])
    expect(entries.map((e) => e.clip.clipId)).toEqual(['native:reolink:onboard:0:abc'])
  })
})

describe('positionDerivedClips — the native branch', () => {
  it('draws a native clip as its own card, with the MINT as its picture', () => {
    // The mint is the only picture a native clip can ever have: the provider
    // holds no thumbnails and cuts one from the file on demand.
    const clips = [nativeClip()]
    const cards = positionDerivedClips(axisFor(clips), nativeDerivedClips(clips))
    expect(cards).toHaveLength(1)
    // Carried as an OFFER, never as `mediaUrl`: that field is handed straight
    // to `<Image src>`, and this route answers 204 far more often than a JPEG
    // (D563, D573).
    expect(cards[0]?.anchorEvent.thumbnailMintUrl).toBe(
      '/addon/provider-reolink/clip-thumb/592/687d6b38',
    )
    expect(cards[0]?.anchorEvent.mediaUrl).toBeUndefined()
  })

  it('never reaches for a RECORDED still on a native card', () => {
    // `footageOnlyCard` stamps `stillMediaPath(deviceId, stillAtMs)` — the
    // recorder's own frame route. On a clip that lives on the camera's SD card
    // that address resolves to footage we do not have, so the card would draw
    // whatever OUR recording held at that instant: a picture of the right
    // moment from the wrong source, which is worse than no picture.
    const clips = [nativeClip({ thumbnailMintUrl: undefined })]
    const cards = positionDerivedClips(axisFor(clips), nativeDerivedClips(clips))
    expect(cards[0]?.anchorEvent.mediaUrl).toBeUndefined()
    expect(cards[0]?.anchorEvent.thumbnailMintUrl).toBeUndefined()
  })

  it('labels the card with what the hub resolved, not with the camera’s word', () => {
    // `labels` is the hub's vocabulary and is what every other card on this
    // timeline is chipped with; `nativeTypes` (`dog_cat`) is the camera's and
    // has no translation in this app.
    const clips = [nativeClip({ labels: ['animal'], nativeTypes: ['dog_cat'] })]
    const cards = positionDerivedClips(axisFor(clips), nativeDerivedClips(clips))
    expect(cards[0]?.classes).toEqual(['animal'])
  })

  it('falls back to MOTION when the hub resolved no label — never to the kind', () => {
    // This asserted `['native']`, and that is what the operator was reading on
    // his cards. `native` is `Clip.kind`'s "this row has no kind of its own,
    // read the labels" value; printing it answers the question it was told not
    // to ask. His rule, 2026-09-22: "solamente le classi, motion se altro".
    const clips = [nativeClip({ labels: undefined })]
    const cards = positionDerivedClips(axisFor(clips), nativeDerivedClips(clips))
    expect(cards[0]?.classes).toEqual(['motion'])
  })

  it('never puts `native` on a card, whatever the row carries', () => {
    for (const labels of [undefined, [], ['person', 'animal']]) {
      const clips = [nativeClip(labels === undefined ? {} : { labels })]
      const cards = positionDerivedClips(axisFor(clips), nativeDerivedClips(clips))
      expect(cards[0]?.classes).not.toContain('native')
      expect(cards[0]?.representative.className).not.toBe('native')
    }
  })

  it('keys the card on the CLIP, so a tap can name it', () => {
    // `cardIdForClip` answers the clip id for a cluster-less entry, and the tap
    // handler resolves that id back to the clip. A card keyed on anything else
    // is a card whose tap finds nothing (the defect that held clips mode after
    // one clip).
    const clips = [nativeClip()]
    const cards = positionDerivedClips(axisFor(clips), nativeDerivedClips(clips))
    expect(cards[0]?.id).toBe('native:reolink:onboard:0:abc')
  })

  it('spans the clip’s own window — a file has fixed boundaries', () => {
    const clips = [nativeClip()]
    const cards = positionDerivedClips(axisFor(clips), nativeDerivedClips(clips))
    expect(cards[0]?.startMs).toBe(T0)
    expect(cards[0]?.endMs).toBe(T0 + 30_000)
  })
})

/**
 * The SERVED still has to reach the card.
 *
 * ## What the fleet actually sends
 *
 * A Reolink onboard row, read off the hub on 2026-09-21 (camera 3628):
 *
 * ```json
 * { "id": "native:reolink:onboard:0:…", "source": "native:reolink:onboard",
 *   "thumbnail": "/addon/provider-reolink/clip-thumb/3628/c325d136…",
 *   "supportSub": true, "streams": { … } }
 * ```
 *
 * A `thumbnail` — a still the provider ALREADY holds, which `parseClips` maps
 * to `thumbnailUrl` — and **no mint field at all**. `nativeClipCard` copied
 * only `thumbnailMintUrl`, so the card reached `clipStillSource` with nothing
 * on it, the hook was called with `null`, and not one still was ever
 * requested: the operator's session showed no thumbnails and the telemetry
 * counted zero asks, which is how this was finally located.
 *
 * Every fixture above carries a mint, which is why a green suite never saw it.
 */
describe('nativeDerivedClips — the still address', () => {
  const served = '/addon/provider-reolink/clip-thumb/3628/c325d136'

  function cardFor(clip: Clip) {
    return positionDerivedClips(axisFor([clip]), nativeDerivedClips([clip]))[0]
  }

  it('carries a SERVED still onto the card — the fleet sends this and no mint', () => {
    const card = cardFor(nativeClip({ thumbnailUrl: served, thumbnailMintUrl: undefined }))
    expect(card?.representative.thumbnailUrl).toBe(served)
    expect(card?.representative.thumbnailMintUrl).toBeUndefined()
  })

  it('still carries the mint when that is all the row has', () => {
    const mint = '/addon/provider-reolink/clip-thumb/592/687d6b38'
    const card = cardFor(nativeClip({ thumbnailUrl: undefined, thumbnailMintUrl: mint }))
    expect(card?.representative.thumbnailMintUrl).toBe(mint)
  })

  it('carries BOTH when the row has both — the picker prefers the served one', () => {
    const mint = '/addon/provider-reolink/clip-thumb/592/687d6b38'
    const card = cardFor(nativeClip({ thumbnailUrl: served, thumbnailMintUrl: mint }))
    expect(card?.representative.thumbnailUrl).toBe(served)
    expect(card?.representative.thumbnailMintUrl).toBe(mint)
  })
})
