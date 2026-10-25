/**
 * Source guards for three operator-visible facts that no rendered assertion in
 * this repo can reach, because each of them is a WIRING between components the
 * mount harness cannot stand up (the timeline pulls the whole data layer).
 *
 *  1. The speed menu lists its rates in the order its GEOMETRY implies. It
 *     opens upward (be40ca0c), so the first row is furthest from the thumb and
 *     the list must be fastest-first. The rate CONSTANT stays ascending — a
 *     reversed constant would silently re-order every other reader of it — so
 *     the only thing that can go wrong here is the bar quietly going back to
 *     mapping the constant, which reads identical at the call site.
 *
 *  2. The speed menu carries no audio sentence any more. *"soprattutto rimuovi
 *     la label di Audio non disponibile nel selettore"* — the operator,
 *     2026-09-23. Removed from the SELECTOR, and its two locale keys with it:
 *     a key nobody renders is a leftover that reads as a feature.
 *
 *  3. The running clip's state reaches the CARD. It travels
 *     TheaterTimeline → TimelineScroller → ClusterSlot → ClusterCard, four
 *     files, and a prop dropped anywhere along that chain is invisible — the
 *     list simply never highlights anything, exactly as it did before the
 *     feature existed.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const THEATER = join(SRC, 'components', 'camera', 'theater')

function read(...parts: readonly string[]): string {
  return readFileSync(join(...parts), 'utf8')
}

const BAR = read(THEATER, 'TimelinePlaybackBar.tsx')
const CARD = read(THEATER, 'ClusterCard.tsx')
const SCROLLER = read(THEATER, 'TimelineScroller.tsx')
const TIMELINE = read(THEATER, 'TheaterTimeline.tsx')
const SCREEN = read(SRC, 'screens', 'CameraDetailScreen.tsx')
const DOWNLOAD = read(SRC, 'clips', 'clip-download.ts')

describe('the speed menu lists its rates the way it OPENS', () => {
  it('builds its rows from the direction-aware order, not from the raw constant', () => {
    // The direction is the one the menu REALLY opened in: on web the menu is
    // portalled and flips downward when there is no room above it.
    expect(BAR).toContain('playbackRateMenuOrder(direction, rateChoices)')
  })

  it('does not map the ascending constant directly — that is the regression', () => {
    expect(BAR).not.toContain('PLAYBACK_RATE_OPTIONS.map')
  })

  it('takes its rows from the CAMERA’s ladder and no local constant (D612)', () => {
    // `PLAYBACK_RATE_OPTIONS` is deleted, not merely unused: a second rate
    // list is a second authority, and this one offered 4× on cameras that can
    // never be paced above 1×.
    expect(BAR).toContain('clipRateChoices(clipControls)')
    expect(read(SRC, 'components', 'camera', 'recorded-transport.ts')).not.toContain(
      'PLAYBACK_RATE_OPTIONS',
    )
  })

  it('draws only what the camera can do, and hides the chip when that is one rate', () => {
    // This assertion used to be the opposite — greyed rows plus a line
    // explaining the cap — and the operator retired it on 2026-09-23:
    // "nascondi il selettore e basta. Mostrare quella label non ha alcun senso
    // proprio per niente". `rateCapped` is deleted from both locales, not
    // merely unused: a string that describes a design nobody ships reads as
    // verification of it.
    expect(BAR).toContain('clipRateMenuShown(clipControls)')
    expect(BAR).not.toContain('v2.playback.rateCapped')
    // The per-row flag stays: a PENDING answer still draws the legacy ladder,
    // and a rate in that list may turn out not to be allowed.
    expect(BAR).toContain('clipRateAllowed(clipControls.controls, option)')
    expect(BAR).toContain('v2.playback.rateUnavailable')
  })

  it('the camera’s answer reaches the bar from the screen through the timeline', () => {
    // Four files, and a prop dropped anywhere along the chain is invisible:
    // the menu simply keeps offering everything, exactly as it did before.
    expect(SCREEN).toContain('clipControls={clipStage.controls}')
    expect(TIMELINE).toContain('readonly clipControls?: ClipControlsView')
    expect(TIMELINE).toContain('clipControls: props.clipControls')
    expect(BAR).toContain('readonly clipControls?: ClipControlsView')
  })

  it('still opens UPWARD, which is what makes fastest-first the right order', () => {
    // The two are one decision. If the menu ever flips, the order flips with
    // it through `playbackRateMenuOrder`, and this comment is the reason.
    const POPOVER = read(THEATER, 'PlaybackBarPopover.tsx')
    expect(POPOVER).toContain('it opens UPWARD')
    // …and the portalled one PREFERS up, flipping only when there is no room.
    expect(POPOVER).toContain("placePopover(anchor, size, viewport, 'up')")
  })
})

describe('the audio sentence is gone from the selector', () => {
  it('the bar renders neither audio string', () => {
    expect(BAR).not.toContain('v2.playback.audioMuted')
    expect(BAR).not.toContain('v2.playback.audioOn')
  })

  it('neither locale still carries the keys', () => {
    for (const locale of ['en.json', 'it.json']) {
      const text = readFileSync(join(process.cwd(), 'locales', locale), 'utf8')
      expect(text).not.toContain('"audioMuted"')
      expect(text).not.toContain('"audioOn"')
    }
  })
})

describe('the running clip reaches the card it is about', () => {
  it('the screen names WHICH clip holds the frame, not just that one does', () => {
    expect(SCREEN).toContain('clipOnFrameId=')
  })

  it('the timeline builds a per-card map from both axes', () => {
    expect(TIMELINE).toContain('clipRowFromHeld')
    expect(TIMELINE).toContain('clipRowFromEpoch')
    expect(TIMELINE).toContain('clipPlaybackByCardId: clipPlaybacks')
  })

  it('the scroller hands each slot its own entry', () => {
    expect(SCROLLER).toContain('clipPlayback={clipPlaybackByCardId?.get(cluster.id)}')
    expect(SCROLLER).toContain('clipPlayback={clipPlayback}')
  })

  it('the card draws BOTH facts: the highlight and the strip', () => {
    // Two claims, two pieces of chrome. A card that only drew the bar would
    // leave "which row is playing" unanswered whenever the length is unknown.
    expect(CARD).toContain('<ClipRowProgress')
    expect(CARD).toContain('const playing = clipPlayback !== undefined')
    expect(CARD).toContain('borderColor: playing || selected ? colors.primary : colors.border')
  })
})

/**
 *  4. The tile's keep control goes through the EXPORT path.
 *
 *     The interim fetched the provider's Range route to this device because a
 *     docblock said D558's server slice did not exist. It landed on
 *     2026-09-21. A comment asserting a design does not exist, when it does,
 *     reads as verification and is how the interim survived — so the claim is
 *     asserted gone, and so is the module that acted on it.
 */
describe('a clip is KEPT by creating an export, not by downloading it here', () => {
  it('the timeline calls the export hook and no longer the direct-fetch one', () => {
    expect(TIMELINE).toContain('useClipExport')
    expect(TIMELINE).not.toContain('useClipSave')
  })

  it('the interim hook is deleted, not left beside the new one', () => {
    // Two ways to keep a clip is how the two diverge, and the dead one reads
    // as a supported alternative.
    expect(existsSync(join(SRC, 'clips', 'use-clip-save.ts'))).toBe(false)
  })

  it('the stale "server slice is not built" claim is gone from the record', () => {
    // The literal sentences the old docblock asserted, not a paraphrase: the
    // new one QUOTES them to say they were wrong, so a substring guard on
    // "no export record" would fail on the correction itself.
    expect(DOWNLOAD).not.toContain('**That server slice is not built.**')
    expect(DOWNLOAD).not.toContain(' *  - no export record;')
    // …and the module now says what the control actually does.
    expect(DOWNLOAD).toContain('It creates an EXPORT')
  })

  it('the modal is mounted by the timeline and fed the picker options', () => {
    expect(TIMELINE).toContain('<ClipExportModal')
    expect(TIMELINE).toContain('setQualityPick')
  })

  it('a single copy short-circuits the modal', () => {
    // A dialog with one option is friction pretending to be agency.
    expect(TIMELINE).toContain("if (quality.kind === 'choice')")
    expect(TIMELINE).toContain('startClipExport(entry.clip, quality.option.profile)')
  })
})

/**
 *  5. The per-clip `clipTransport` message is GONE, not parked.
 *
 *     The hub removed it with D612 — it declared per clip what cannot vary
 *     per clip — and a parser for a message nobody sends reads as
 *     verification that the message exists. Twice in this repo a leftover
 *     that described the right design was the reason dead code survived.
 */
describe('the message nobody sends has no reader left', () => {
  const FILES: readonly (readonly string[])[] = [
    [SRC, 'recording', 'recording-messages.ts'],
    [SRC, 'live', 'live-view-types.ts'],
    [SRC, 'live', 'LiveViewWebView.tsx'],
    [SRC, 'live', 'LiveView.web.tsx'],
    [SRC, 'clips', 'use-clip-stage.ts'],
    [join(process.cwd(), 'embed', 'src', 'playback'), 'recorded-track-session.ts'],
    [join(process.cwd(), 'embed', 'src', 'pages'), 'EmbedPlayerPage.tsx'],
  ]

  it("no host message type, no report type, no relay — anywhere on the path", () => {
    for (const parts of FILES) {
      const text = read(...parts)
      expect(text, parts.join('/')).not.toContain('ClipTransportReport')
      expect(text, parts.join('/')).not.toContain('onClipTransport')
      expect(text, parts.join('/')).not.toContain("'clipTransport'")
    }
  })

  it('the stage no longer exposes a per-clip declaration sink', () => {
    expect(read(SRC, 'clips', 'use-clip-stage.ts')).not.toContain('reportTransport')
  })
})

/**
 *  6. The clip CURSOR and the clip SCROLL FOLLOW cannot come back.
 *
 *     > *"Rimuoviamo decisamente il cursore per la modalità clip e l'hook
 *     > dello scroll, anche verso il live, non deve fare alcuna azione"* — the
 *     > operator, 2026-09-23, after a day of both on v1.0.540.
 *
 *     Both shipped, both worked as designed, and the design was wrong: a mark
 *     pinned over a list that cannot be dragged reads as a control, and a
 *     follow that fights the operator's own scroll is worse than no follow.
 *     They were DELETED rather than disabled — a follow that is wired but
 *     never fires, or a cursor arm nothing draws, is exactly the leftover this
 *     repo has twice let hide a live bug.
 *
 *     Structural, so a source guard: what is being asserted is that certain
 *     code does not exist anywhere, which no rendered tree can say.
 */
describe('a held clip gets no cursor and no follow', () => {
  const CURSOR = read(THEATER, 'timeline-cursor.ts')
  const LAYERS = read(THEATER, 'TimelineCursorLayers.tsx')
  const SURFACE = read(SRC, 'clips', 'clips-surface.ts')
  const VIEW = read(THEATER, 'TimelineView.tsx')

  it('the follow module is deleted, with its spec and its wiring guard', () => {
    expect(existsSync(join(SRC, 'clips', 'clip-follow.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'clips', '__tests__', 'clip-follow.spec.ts'))).toBe(false)
    expect(existsSync(join(THEATER, '__tests__', 'clip-follow-wiring.spec.ts'))).toBe(false)
  })

  it('nothing in the app still reaches for it', () => {
    // The reducer, the target mapping, the stranded predicate and the module
    // path. A single surviving import is a compile error; a surviving STRING
    // in a comment is the leftover that reads as verification.
    for (const text of [TIMELINE, CURSOR, LAYERS, VIEW]) {
      expect(text).not.toContain('clip-follow.js')
      expect(text).not.toContain('reduceClipFollow')
      expect(text).not.toContain('clipFollowEpoch')
      expect(text).not.toContain('clipFollowStranded')
      expect(text).not.toContain("kind: 'userGrabbed'")
      expect(text).not.toContain('onReacquire')
    }
  })

  it('the cursor union has two arms and no clip input', () => {
    // A `clip` arm with nothing drawing it is the other half of the leftover:
    // it would resolve, carry a file-relative reading, and be invisible.
    expect(CURSOR).not.toContain("kind: 'clip'")
    expect(CURSOR).not.toContain('clipProgress')
    expect(CURSOR).not.toContain('clipHeld')
    expect(CURSOR).toContain("export type TimelineCursor = TimelineLiveCursor | TimelineEpochCursor")
    // And the caller feeds it nothing else.
    expect(TIMELINE).toContain('resolveTimelineCursor({ isLive })')
  })

  it('the surface withdraws the cursor while a FILE holds the frame', () => {
    // The clip arm of `resolveClipsSurface` — the only arm that still said
    // `playhead: true` over a body of files.
    const arm = SURFACE.slice(SURFACE.indexOf('if (input.clipHeld === true) {'))
    expect(arm).toContain("axis: 'clip',")
    expect(arm.slice(0, arm.indexOf('stepsClips'))).toContain('playhead: false,')
  })

  it('the pill is a readout, never a pressable', () => {
    // It carried the re-hook control. With the follow gone a press here has
    // nothing to command, and a cursor that looks like a control is D62.
    expect(LAYERS).not.toContain('Pressable')
    expect(LAYERS).not.toContain('accessibilityRole')
    expect(LAYERS).not.toContain('CURSOR_REACQUIRE_TEST_ID')
  })

  it('the re-hook string is gone from both locales', () => {
    // A key nobody renders is a leftover that reads as a feature.
    for (const locale of ['en.json', 'it.json']) {
      expect(readFileSync(join(process.cwd(), 'locales', locale), 'utf8')).not.toContain(
        '"followClip"',
      )
    }
  })

  it('a scroll on that surface cannot snap the player to LIVE either', () => {
    // The "anche verso il live" half. `scrub` was already refused at the
    // source; go-live is the one command the gesture could still issue, and
    // it is the destructive one — go-live is what LEAVES a clip (D570), and
    // the top of a short clips list is one flick away.
    expect(TIMELINE).toContain("onGoLive: clipsSurface.axis === 'clip' ? refuseGoLive : goLiveFelt")
    expect(TIMELINE).toContain("noteTimelineInputIgnored('goLiveOnClip')")
  })
})
