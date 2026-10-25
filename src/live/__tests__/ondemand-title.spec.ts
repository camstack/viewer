/**
 * The overlay's title is the CAMERA, not the feature.
 *
 * It said "Riproduzione" (the i18n key `v2.onDemandPlayer.title`), which names
 * the window's kind and not its subject — and the whole reason the window
 * exists is that a second camera is playing beside the first one. A title that
 * cannot tell them apart is the one piece of chrome that had to.
 */
import { describe, expect, it } from 'vitest'
import { onDemandTitle } from '../ondemand-title.js'

const CAMERAS = [
  { id: 101, name: 'Camera front door' },
  { id: 107, name: 'Camera bedroom' },
]

describe('onDemandTitle', () => {
  it('names the camera the overlay is showing', () => {
    expect(onDemandTitle(CAMERAS, 107, 'Riproduzione')).toBe('Camera bedroom')
  })

  it('falls back when the camera is not in the list yet', () => {
    // The list arrives from a query. Before it answers, the window still has to
    // draw a header — and an empty one reads as a broken component.
    expect(onDemandTitle([], 101, 'Riproduzione')).toBe('Riproduzione')
  })

  it('falls back for a camera that has gone', () => {
    expect(onDemandTitle(CAMERAS, 9_999, 'Riproduzione')).toBe('Riproduzione')
  })

  it('falls back rather than showing a blank strip', () => {
    // A camera with an empty name is a real row: the operator cleared the
    // field. Rendering it would leave the header looking like a failure.
    expect(onDemandTitle([{ id: 101, name: '   ' }], 101, 'Riproduzione')).toBe(
      'Riproduzione',
    )
  })
})
