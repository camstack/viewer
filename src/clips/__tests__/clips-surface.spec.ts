import { describe, it, expect } from 'vitest'

import { resolveClipsSurface } from '../clips-surface.js'

/**
 * A camera with no continuous recording has no coverage, so it has no time
 * axis: the timeline, the scrub and the playhead are not EMPTY there, they are
 * meaningless. This file pins what that surface is instead.
 */

describe('the ordinary timeline is untouched', () => {
  it('keeps every transport when clips mode is off', () => {
    const s = resolveClipsSurface({ clipsMode: false, derivation: 'derived' })
    expect(s).toEqual({
      kind: 'timeline',
      heatmap: 'seek',
      axis: 'epoch',
      playhead: true,
      scrub: true,
      transport: true,
      stepsClips: false,
    })
  })
})

describe('clips over OUR OWN footage still live on a time axis', () => {
  const s = resolveClipsSurface({ clipsMode: true, derivation: 'derived' })

  it('keeps the playhead, the scrub and the transport', () => {
    // A derived clip IS a range of the hub's recording. Tapping it seeks the
    // recorded session, the playhead lands inside it, and the sequencer chains
    // one into the next. Removing the transport would take away the controls
    // that are actually driving what is on screen.
    expect(s.playhead).toBe(true)
    expect(s.scrub).toBe(true)
    expect(s.transport).toBe(true)
  })

  it('and does not offer clip stepping — the sequencer already advances', () => {
    expect(s.stepsClips).toBe(false)
  })
})

describe('clips that are FILES have no time axis, and only the controls that MEASURE it are withdrawn', () => {
  const s = resolveClipsSurface({ clipsMode: true, derivation: 'cap' })

  it('draws no playhead and takes no timeline drag', () => {
    // The cards are files on the camera's own storage. No epoch reaches them,
    // so a playhead over them would be a position in footage that has nothing
    // to do with what is on screen — and on a camera with no recording at all
    // it is a position in nothing. Meaningless, not empty: an empty timeline
    // invites a scrub, and a scrub here lands on our recorder's footage.
    expect(s.playhead).toBe(false)
    expect(s.scrub).toBe(false)
  })

  it('KEEPS the transport band — that addresses the player, not the body', () => {
    // This block asserted `transport: false` until 2026-09-22, and that claim
    // is the defect the operator reported: *"quando una camera a batteria non
    // dorme non è la stessa modalità di stop: invece della playback bar
    // abbiamo il pulsante sullo stream. È inconsistente."* The picture in the
    // frame while this list is on screen is the live session; play/pause,
    // go-live and the rate chip drive IT, and the cards underneath have no
    // standing to withdraw them. The workaround that papered over it
    // (`overlay-play-pause.ts`'s battery short-circuit) is deleted with it.
    expect(s.transport).toBe(true)
  })

  it('keeps the DAY STRIP, and a press on it opens the file at that instant', () => {
    // Also overturned on 2026-09-22. `timeAxis: false` used to hide the strip
    // on the grounds that a drag would seek our recorder — true of the verb,
    // not of the strip. A file has a wall-clock start, so the day addresses
    // it; the press picks the FILE (`clip-pick.ts`). The operator asked for
    // exactly this: *"la heatmap rimane con i salti verso le clip dove si è
    // cliccato"*.
    expect(s.heatmap).toBe('pickClip')
  })

  it('offers STEPPING instead — that is what “navigate the clips” means with no axis to anchor it', () => {
    expect(s.stepsClips).toBe(true)
  })

  it('is the same surface whether or not the camera also records continuously', () => {
    // The discriminator is the SOURCE, not the camera. 107 records to the hub
    // AND holds 357 files on its own card; with the onboard source picked,
    // every card is a file and the recorder's coverage says nothing about any
    // of them. Branching on coverage would give one camera two surfaces for
    // one list.
    expect(resolveClipsSurface({ clipsMode: true, derivation: 'cap' })).toEqual(s)
  })
})

/**
 * A clip in the frame gets the FILE's own chrome, on every surface.
 *
 * Two separate lessons are buried here and both are worth keeping.
 *
 * First: the operator reported the scrub still running in clips view after a
 * first fix, and he was right — that fix gated the SCREEN's callbacks on the
 * clip stage while this function, the one that decides what the chrome IS,
 * answered separately and was read for one field out of five. Two authorities,
 * and the timeline obeyed neither.
 *
 * Second, and the opposite mistake: the fix for that then took the drag away
 * ENTIRELY, on the grounds that "no epoch addresses a position inside a clip".
 * True, and beside the point — the clip feeder has taken file-relative seeks
 * since D575. The drag was never going to reach the session; it was simply
 * removed. Both errors have the same shape: deciding what the frame can do
 * somewhere other than where the frame's capability actually lives.
 */
describe('resolveClipsSurface — a held clip is the FILE\'s own surface', () => {
  /**
   * This block asserted the opposite until 2026-09-22: that holding a clip
   * TAKES the scrub away, "because a drag there would seek the session behind
   * the clip". It cannot: `timeline-session.ts` has routed seek / scrub / rate
   * / step to the clip feeder, on the file's own axis, since D575, and its own
   * tests pin that. The viewer was suppressing controls for something the
   * server could already do, and the operator asked for them back.
   */
  const held = (clipsMode: boolean, derivation: 'derived' | 'cap') =>
    resolveClipsSurface({ clipsMode, derivation, clipHeld: true })

  it('points at the FILE, and says so — the position is measured in the clip', () => {
    for (const [mode, der] of [
      [false, 'derived'],
      [true, 'derived'],
      [true, 'cap'],
    ] as const) {
      const s = held(mode, der)
      expect(s.axis, `${String(mode)}/${der}`).toBe('clip')
    }
  })

  it('draws NO cursor over the body — the operator took it off (2026-09-23)', () => {
    // *"Rimuoviamo decisamente il cursore per la modalità clip"*. The cursor
    // would sit on the clip LIST, which refuses the finger on this surface
    // (`scrub: false`, and the live snap refused with it in TheaterTimeline),
    // so it reads as a control that ignores you. The file's position is on
    // the transport band's progress bar and on the running row's own strip —
    // both on the file's axis, both take a gesture.
    for (const [mode, der] of [
      [false, 'derived'],
      [true, 'derived'],
      [true, 'cap'],
    ] as const) {
      expect(held(mode, der).playhead, `${String(mode)}/${der}`).toBe(false)
    }
  })

  it('keeps the timeline DRAG off the player — that gesture browses the list', () => {
    // Two different gestures, and conflating them is the mistake this case
    // exists to prevent: while a clip is held the body under the drag is the
    // clip LIST, so wiring the drag to a file-relative seek would mean
    // scrolling to find the next clip moved the picture. Seeking inside the
    // file is the transport's progress control, which reads `axis`.
    for (const [mode, der] of [
      [false, 'derived'],
      [true, 'derived'],
      [true, 'cap'],
    ] as const) {
      expect(held(mode, der).scrub, `${String(mode)}/${der}`).toBe(false)
    }
  })

  it('is the SAME surface whatever the body behind it was — one file, one chrome', () => {
    // Every field but the day strip, which is the body's and not the file's.
    const chrome = ({ heatmap: _h, ...rest }: ReturnType<typeof held>) => rest
    expect(chrome(held(false, 'derived'))).toEqual(chrome(held(true, 'cap')))
    expect(chrome(held(true, 'derived'))).toEqual(chrome(held(true, 'cap')))
  })

  it('carries the transport band and clip stepping', () => {
    const s = held(true, 'cap')
    expect(s.kind).toBe('clip')
    // go-live lives in the transport, and go-live is what LEAVES the clip
    // (D570). Without the band the frame has no way out but the back button.
    expect(s.transport).toBe(true)
    expect(s.stepsClips).toBe(true)
  })

  it('never claims the BODY is laid out against time — the file is not', () => {
    // The claim `timeAxis` used to make, now read off the axis itself so the
    // two cannot disagree.
    expect(held(true, 'derived').axis).not.toBe('epoch')
    expect(held(false, 'derived').axis).not.toBe('epoch')
  })

  it('withholds the day strip over an EPOCH body, and keeps it over a list of files', () => {
    // The strip belongs to the BODY, which a file taking the frame does not
    // change — so this is the ONE field of the held arm that is not total.
    // Over bands, a press would have to leave the clip first and nothing but
    // go-live does that (D570), so there is no strip rather than one that
    // seeks underneath the picture. Over a list, a press picks another file,
    // which is the same total transition prev/next already makes.
    expect(held(false, 'derived').heatmap).toBe('none')
    expect(held(true, 'derived').heatmap).toBe('none')
    expect(held(true, 'cap').heatmap).toBe('pickClip')
  })

  it('leaves the drag on the epoch axis when no clip holds the frame', () => {
    const live = resolveClipsSurface({ clipsMode: false, derivation: 'derived' })
    expect(live.scrub).toBe(true)
    expect(live.axis).toBe('epoch')
    expect(
      resolveClipsSurface({ clipsMode: false, derivation: 'derived', clipHeld: false }).axis,
    ).toBe('epoch')
  })

  it('a LIST with nothing held points at nothing', () => {
    expect(resolveClipsSurface({ clipsMode: true, derivation: 'cap' }).axis).toBe('none')
  })
})
