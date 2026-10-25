import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A loading spinner has to be somewhere the operator can see it.
 *
 * Both of this screen's loaders were absolutely positioned with a symmetric
 * negative inset (`top/left/right/bottom: -6`), which centres them on the SAME
 * box as the button they belong to. A `small` `ActivityIndicator` is smaller
 * than a 40pt disc, so it rendered behind the play glyph and was invisible —
 * on the toolbar bar and on the video both. The operator's report was simply
 * "il loader non è per niente visibile", and they were right: nothing was drawn
 * where anything could be seen.
 *
 * The fix is positional, so the guard is positional: a loader anchors to
 * `left: '100%'` — outside the button's box — and never to a symmetric inset.
 *
 * A source guard because this repo's viewer cannot mount a component (vitest
 * collects only `*.spec.ts`, environment `node`, no renderer — see
 * `docs/roadmap.md`), and because the property is a rule rather than a pixel:
 * the exact offset may change, "outside the button" must not.
 */

const CAMERA = join(process.cwd(), 'src', 'components', 'camera')
const read = (rel: string): string => readFileSync(join(CAMERA, rel), 'utf8')

describe('the transport loader is a ring around its button', () => {
  it('the playback bar draws the ring, not an indicator of its own', () => {
    const src = read('theater/TimelinePlaybackBar.tsx')
    expect(src).toContain('TransportSpinnerRing')
    // Two shapes failed before this one: an ActivityIndicator on a symmetric
    // negative inset (invisible behind the glyph) and the same one pushed to
    // `left: '100%'` (visible, but detached from the control it describes).
    expect(src).not.toContain('ActivityIndicator')
  })

  it('the ring is sized from the button and centred on it', () => {
    const src = read('theater/TransportSpinnerRing.tsx')
    // Overshooting the button and pulling back by half the overshoot is what
    // keeps the ring concentric; a plain absolute fill would sit top-left.
    expect(src).toContain('marginLeft: -(outer - size) / 2')
    expect(src).toContain('marginTop: -(outer - size) / 2')
    // A full circle would look static — the dash gap is what shows rotation.
    expect(src).toContain('strokeDasharray')
  })

  it('the ring never eats the tap — a slow seek is when pause is wanted', () => {
    expect(read('theater/TransportSpinnerRing.tsx')).toContain('pointerEvents="none"')
  })

  it('the STREAM transport carries no loader at all', () => {
    // Removed on the operator's call: the timeline's transport is where seek
    // progress belongs, and two loaders for one state is one too many.
    const src = read('StreamOverlayControls.tsx')
    expect(src).not.toContain('ActivityIndicator')
    expect(src).not.toContain('playSpinner')
  })
})

describe('the stream transport moved off the middle of the picture', () => {
  it('play/pause is not a centred overlay — it lives in a corner cluster', () => {
    const src = read('OverlayDiscGroup.tsx')
    expect(src).toContain('bottomLeft')
    expect(src).toContain('bottomRight')
    // `center` was a full-bleed absolute layer holding a 52pt button over the
    // one part of the frame the operator is watching.
    expect(src).not.toMatch(/\bcenter:\s*\{\s*\n\s*position: 'absolute'/)
  })

  it('the oversized-button prop is gone, not left dangling', () => {
    // Nothing passes `big` any more. A prop kept "in case" reads as a supported
    // size and is the kind of leftover that outlives the reason for it.
    const src = read('StreamOverlayControls.tsx')
    expect(src).not.toContain('readonly big?')
  })
})
