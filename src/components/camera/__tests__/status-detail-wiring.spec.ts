/**
 * Both places the glyphs live actually open the layer — and each mounts it on a
 * box wide enough to hold it.
 *
 * A source guard rather than a mount, because what is asserted here is
 * PLACEMENT: the popover takes no width of its own, so the only thing that can
 * put it off-screen (landscape, inside the 240–340pt timeline drawer) or hide
 * it (the camera card's `overflow: 'hidden'`) is being mounted on the wrong
 * parent. The toolbar mounts it on its own container, AFTER the controls row;
 * the card mounts it inside the picture, above the footer that holds the
 * glyphs.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

const TOOLBAR = read('camera/theater/TimelineToolbarInline.tsx')
const CARD = read('CameraCard.tsx')

describe('the theater toolbar', () => {
  it('makes both glyphs buttons, keeping them compact glyphs', () => {
    expect(TOOLBAR).toContain('<StatusBadgeButton subject="battery"')
    expect(TOOLBAR).toContain('<StatusBadgeButton subject="link"')
    expect(TOOLBAR).toContain('<BatteryBadge battery={props.battery} colors={colors} size={ICON} compact neutral="foreground" />')
  })

  it('hangs the layer off the toolbar CONTAINER, below the row', () => {
    const popover = TOOLBAR.indexOf('<StatusDetailPopover')
    // After the controls row closes — the popover is a sibling of the row, not
    // inside it (otherwise the row's overflow/layout clips the layer).
    const rowClose = TOOLBAR.lastIndexOf('</View>', popover)
    expect(popover).toBeGreaterThan(0)
    expect(rowClose).toBeGreaterThan(0)
    expect(popover).toBeGreaterThan(rowClose)
    expect(TOOLBAR).toContain('placement="below"')
    // The container out-ranks the timeline body it hangs over: the fault band
    // (10), the history notice (9) and the playback bar's dropdown (15).
    expect(TOOLBAR).toContain('zIndex: 20')
  })
})

describe('the camera card', () => {
  it('makes both glyphs buttons', () => {
    expect(CARD).toContain('<StatusBadgeButton subject="battery"')
    expect(CARD).toContain('<StatusBadgeButton subject="link"')
  })

  it('mounts the layer INSIDE the picture, which the card cannot clip away', () => {
    const media = CARD.indexOf('<View style={styles.media}>')
    const popover = CARD.indexOf('<StatusDetailPopover')
    const footer = CARD.indexOf('<View style={styles.footer}>')
    expect(media).toBeGreaterThan(0)
    expect(popover).toBeGreaterThan(media)
    expect(popover).toBeLessThan(footer)
    expect(CARD).toContain('placement="insideBottom"')
  })

  it('never wraps a badge that draws nothing in a labelled button', () => {
    // A wire and an unread link draw no glyph: a button around them would be an
    // empty target that a screen reader still announces.
    expect(CARD).toContain('networkLinkBadgeVisible(networkLink) && networkLink ?')
    expect(TOOLBAR).toContain('networkLinkBadgeVisible(props.networkLink) && props.networkLink ?')
  })
})
