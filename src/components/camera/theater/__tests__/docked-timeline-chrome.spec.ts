import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A source guard, because the property it protects is STRUCTURAL and no
 * assertion on a rendered tree can express it.
 *
 * Two things must stay true, and each of them was false once:
 *
 *  1. The playback band does not FLOAT (the tools do, with a reserved inset). Every layout defect
 *     they replace came from a control drawn inside a space it did not own —
 *     a ~212pt action row clipped by a ~230pt box, a transport pill anchored to
 *     the now-line and painted over the activity strip. A band that is laid out
 *     by the column cannot do either; a band that reaches for
 *     `StyleSheet.absoluteFill` or the indicator offset has gone back to
 *     guessing.
 *
 *  2. The bands are the TIMELINE's chrome. They are rendered by `TimelineView`
 *     and by nothing else, so "a panel is open" cannot leave one behind. The
 *     alternative — a flag threaded to two sibling bars — is a shape this
 *     codebase has already been bitten by: a layout flag honoured only by the
 *     components somebody remembered to thread it to.
 *
 * These are cheap to assert and they fail loudly on the exact regression.
 */

const SRC = join(process.cwd(), 'src')
const THEATER = join(SRC, 'components', 'camera', 'theater')
const DETAIL_SCREEN = join(SRC, 'screens', 'CameraDetailScreen.tsx')
const STREAM_OVERLAY = join(SRC, 'components', 'camera', 'StreamOverlayControls.tsx')

function walk(dir: string): readonly string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const ALL_SOURCES = walk(SRC)

/**
 * Every source except this one.
 *
 * A guard that forbids a symbol has to name it, so a tree-wide scan that
 * included this file would always fail on its own text.
 */
const POLICED_SOURCES = ALL_SOURCES.filter(
  (file) => !file.endsWith('docked-timeline-chrome.spec.ts'),
)

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/**
 * The body of a named `StyleSheet.create` entry.
 *
 * The check below is about the band's ROOT box, not about every rule in the
 * file: a dropdown anchored to its own button is fine, a band anchored to its
 * parent is the defect.
 */
function styleBlock(source: string, name: string): string {
  const start = source.indexOf(`  ${name}: {`)
  if (start < 0) throw new Error(`no style named ${name}`)
  const end = source.indexOf('\n  },', start)
  return source.slice(start, end)
}

/** Files that import a module by its specifier stem (e.g. `TimelineFooterBar`). */
/**
 * Which SHIPPED sources import a band. Specs are excluded: the property being
 * guarded is "no second surface renders a band in the app", and a mount test
 * that renders the bar in isolation is how the bar's own behaviour is asserted
 * — it ships to nobody and cannot leave a band behind a panel.
 */
function importersOf(stem: string): readonly string[] {
  return ALL_SOURCES.filter((file) => {
    if (file.endsWith(`${stem}.tsx`) || file.endsWith(`${stem}.ts`)) return false
    if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return false
    return new RegExp(`from '[^']*/${stem}\\.js'`).test(read(file))
  })
}

describe('the docked bands do not float', () => {
  it('TimelinePlaybackBar owns no absolute layer', () => {
    const source = read(join(THEATER, 'TimelinePlaybackBar.tsx'))
    expect(source).not.toContain('absoluteFill')
    expect(styleBlock(source, 'container')).not.toContain('position')
  })

  /**
   * The floating tools hover over the list, and that is allowed ONLY as a
   * pair: an overlay layer that is a sibling of the scroller (inside its
   * content it was clipped) AND a reserved inset so the last cards can scroll
   * above it. A float with no inset leaves the content under it unreachable.
   */
  it('TimelineFloatingTools hovers ONLY while the list reserves its footprint', () => {
    const tools = read(join(THEATER, 'TimelineFloatingTools.tsx'))
    const view = read(join(THEATER, 'TimelineView.tsx'))
    const host = read(join(THEATER, 'TheaterTimeline.tsx'))
    expect(tools).toContain("pointerEvents=\"box-none\"")
    expect(view).toContain('<TimelineFloatingTools')
    expect(host).toContain('contentTopInset: floatingToolsTopInset()')
    expect(read(join(THEATER, 'TimelineScroller.tsx'))).toContain('contentTopInset')
    expect(host).toContain('contentBottomInset: floatingToolsBottomInset()')
    // At the BOTTOM, standard toolbar height; only the bar takes touches.
    expect(tools).toContain('styles.bar')
    expect(tools).toMatch(/styles\.bar, \{ bottom:/)
    expect(tools).not.toMatch(/styles\.bar, \{ top:/)
    expect(tools).not.toContain('liveRowOffset')
    expect(tools).not.toContain('bottomRight')
    expect((tools.match(/<GlassSurface/g) ?? []).length).toBe(1)
    expect(existsSync(join(THEATER, 'TimelineFooterBar.tsx'))).toBe(false)
  })

  it('TimelinePlaybackBar never anchors to the now-line', () => {
    expect(read(join(THEATER, 'TimelinePlaybackBar.tsx'))).not.toContain('indicatorOffsetPx')
  })

  it('the cluster detail is a PANEL, not a window of its own', () => {
    // It was a slide-up <Modal>: a portrait-shaped presentation negotiating for
    // a space it does not own, wrong the moment the window is short and wide.
    // A modal is also the one float that never LOOKS broken, so nothing but a
    // guard keeps it from coming back.
    //
    // Matched on USE, not on the name: the panel and the body both recount this
    // history in prose, and a guard that forbids saying the word would only
    // teach the next person to delete the explanation.
    expect(existsSync(join(THEATER, 'detail', 'ClusterDetailModal.tsx'))).toBe(false)
    for (const file of POLICED_SOURCES) {
      expect(read(file), file).not.toMatch(/ClusterDetailModal\.js'|<ClusterDetailModal/)
    }
    const panel = read(join(THEATER, 'TimelineClusterPanel.tsx'))
    // The import specifier, not the word: the docblock explains what a RN
    // <Modal> did wrong here and must stay free to say so.
    expect(panel).not.toMatch(/[{,]\s*Modal\s*[,}]/)
    expect(panel).toContain('TimelinePanelHost')
  })

  it('the indicator LINE paints under the cluster cards; the lane dots stay on top', () => {
    // Paint order in React Native is sibling order, and this one was wrong:
    // the whole indicator rendered AFTER the scroller, so the line sliced
    // through every card it crossed (operator, 2026-08-02 — "la linea deve
    // andare sotto i cluster"). The line is a reference mark and belongs UNDER
    // the content; the crossing dots must never be buried by a card sliding
    // beneath the line. A rendered tree cannot
    // express z-order here, so the guard pins the JSX sibling order.
    //
    // The two layers became named components on 2026-09-23
    // (`timeline-cursor.ts`). They read the EPOCH axis only — over a held file
    // neither is drawn at all — but the sibling order they must keep did not
    // change, so the guard follows the names rather than being deleted with
    // the styles it used to spell.
    const view = read(join(THEATER, 'TimelineView.tsx'))
    const line = view.indexOf('<TimelineCursorLine')
    const scroller = view.indexOf('<TimelineScroller')
    const pill = view.indexOf('<TimelineCursorLaneDots')
    expect(line).toBeGreaterThan(-1)
    expect(scroller).toBeGreaterThan(-1)
    expect(pill).toBeGreaterThan(-1)
    expect(line).toBeLessThan(scroller)
    expect(scroller).toBeLessThan(pill)
  })

  it('the retired fit-to-headroom anchor is gone from the tree', () => {
    for (const file of POLICED_SOURCES) {
      expect(read(file), file).not.toContain('anchorTransportPill')
      expect(read(file), file).not.toContain('transport-anchor.js')
    }
  })
})

describe('the bands belong to the timeline', () => {
  /**
   * Scoped to the THEATER, narrowed on 2026-09-12 (D483).
   *
   * The invariant is about this timeline's PANEL system: inside the theater a
   * band must vanish when a panel opens, `TimelineView` is what decides that,
   * and a second in-theater renderer would have to be told "a panel is open" —
   * the flag this structure exists to avoid.
   *
   * That reason does not reach a surface with no panels. The on-demand player
   * (`components/camera/OnDemandPlayer.tsx`) mounts `TimelinePlaybackBar` as a
   * plain transport row: no `TimelinePanelHost`, no panel state, nothing that
   * could need telling. Forbidding that import would forbid the reuse the bar
   * was extracted FOR, and the alternative — a second transport row with its
   * own rate options, scrub-direction glyph and live-lock control — is the
   * duplication this file is trying to prevent, not an example of it.
   *
   * So the guard keeps its full force where the reason applies (a second
   * renderer under `theater/` still fails) and stops policing a directory it
   * was never aimed at.
   */
  it('are rendered, WITHIN THE THEATER, by TimelineView and by nothing else', () => {
    const inTheater = (files: readonly string[]): readonly string[] =>
      files.filter((f) => f.startsWith(THEATER))
    expect(inTheater(importersOf('TimelinePlaybackBar'))).toEqual([
      join(THEATER, 'TimelineView.tsx'),
    ])
    expect(inTheater(importersOf('TimelineFloatingTools'))).toEqual([
      join(THEATER, 'TheaterTimeline.tsx'),
      join(THEATER, 'TimelineView.tsx'),
    ])
  })

  it('the floating tools are pure TIMELINE chrome', () => {
    // Volume and talk belong to the stream. If they return here the tools stop
    // being something that can vanish with the timeline.
    const tools = read(join(THEATER, 'TimelineFloatingTools.tsx'))
    for (const streamControl of ['muted', 'onToggleMute', 'talking', 'onToggleTalk']) {
      expect(tools, streamControl).not.toContain(streamControl)
    }
  })

  it('TimelineView is mounted only where a panel is the alternative', () => {
    expect(importersOf('TimelineView')).toEqual([join(THEATER, 'TheaterTimeline.tsx')])
    const host = read(join(THEATER, 'TheaterTimeline.tsx'))
    // The single branch: panel, or the timeline with its bands.
    expect(host).toContain("body.kind === 'panel'")
    expect(host).toContain('<TimelineBodyPanel')
    expect(host).toContain('<TimelineView')
  })
})

/**
 * Play/pause is ONE state fed to two surfaces. The overlay disc is shown only
 * while the playback bar is off-screen (fill + closed drawer). Two buttons
 * that could disagree about whether the stream is paused would be a bug with
 * no visible cause — the duplication is only allowed to reach the AFFORDANCE,
 * and only when the bar is not already there.
 */
describe('one transport state, two affordances', () => {
  it('the stream overlay still OFFERS the stream controls', () => {
    // Volume and talk must remain reachable on the video, because in fill
    // mode the drawer that holds the playback bar starts closed. Play/pause
    // is the exception: it is gated off whenever the bar is on screen.
    const overlay = read(STREAM_OVERLAY)
    for (const control of ['onTogglePause', 'onToggleMute', 'onToggleTalk']) {
      expect(overlay, control).toContain(`readonly ${control}: () => void`)
    }
    expect(overlay).toContain('readonly showPlayPause:')
  })

  it('both surfaces are fed by a single resolved binding', () => {
    const screen = read(DETAIL_SCREEN)
    const declared = screen.match(/const effectivePaused =/g) ?? []
    expect(declared).toHaveLength(1)
    // The declaration plus both call sites.
    const references = screen.match(/effectivePaused/g) ?? []
    expect(references.length).toBeGreaterThanOrEqual(3)
    expect(screen).toContain('paused={effectivePaused}')
    expect(screen).toContain('onTogglePause={onToggleEffectivePause}')
    // The timeline's play/pause reaches the WALL as well as the picture
    // (`workspace-playback.ts`), so it arrives wrapped — but the wrapper is
    // built FROM the same `onToggleEffectivePause`, which is what this claim is
    // about: one resolved binding, never a second pause state.
    expect(screen).toContain('onTogglePlayPause={wallPlayback.onTogglePlayPause}')
    expect(screen).toContain('onTogglePlayPause: onToggleEffectivePause,')
  })

  it('neither surface owns pause state of its own', () => {
    for (const file of [STREAM_OVERLAY, join(THEATER, 'TimelinePlaybackBar.tsx')]) {
      // Local UI state (a dropdown's open flag) is fine; playback state is not.
      expect(read(file), file).not.toMatch(/useState[^\n]*[Pp]aused/)
    }
  })
})
