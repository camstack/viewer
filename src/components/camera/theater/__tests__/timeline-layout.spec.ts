import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * The two decisions the docked timeline layout rests on.
 *
 * Both used to be implicit in JSX that cannot be mounted at these sizes in this
 * environment — which is exactly how a transport pill painted over the activity
 * strip through a full redesign without a single test noticing.
 */

import {
  resolveTimelineBody,
  playbackBarLayout,
  type TimelinePanel,
} from '../timeline-layout.js'
import type { PlaybackMode } from '../../../../recording/playback-machine.js'
import { clusterByZoom } from '../event-cluster.js'

/** A REAL cluster (no cast): the detail panel is the only one with a payload. */
const CLUSTER = clusterByZoom(
  [{ id: 'e1', deviceId: 5, timestamp: Date.now() - 60_000, className: 'person' }],
  { topMs: Date.now(), zoomIndex: 2, sizePx: 50, gapPx: 10 },
)[0]

const PANELS: readonly TimelinePanel[] = [
  { kind: 'filter' },
  { kind: 'date' },
  { kind: 'legend' },
  { kind: 'cameraSwitcher' },
  { kind: 'clusterDetail', cluster: CLUSTER },
]
const RECORDED_MODES: readonly PlaybackMode[] = ['seeking', 'playback', 'gap', 'error']

describe('timeline body', () => {
  it('is the timeline when no panel is open', () => {
    expect(resolveTimelineBody(null)).toEqual({ kind: 'timeline' })
  })

  it('is EXCLUSIVELY the panel when one is open — never both', () => {
    for (const panel of PANELS) {
      const body = resolveTimelineBody(panel)
      expect(body.kind).toBe('panel')
      // The union carries no "timeline still underneath" case: a panel owns the
      // whole box below the toolbar, bands included.
      if (body.kind === 'panel') expect(body.panel).toBe(panel)
    }
  })

  it('carries the cluster THROUGH, so the detail panel always has one', () => {
    // The old modal was `visible={cluster !== null}` — the same coupling written
    // as a convention between two pieces of state. The payload now rides IN the
    // panel, which makes the invalid state unconstructible.
    //
    // That half is enforced by `tsc`, not here: splitting the cluster back out
    // of the union is a TYPE change, and this file would still run. Verified by
    // doing it — five compile errors, three of them in this spec. What runtime
    // can assert is that nothing drops the payload on the way through.
    const body = resolveTimelineBody({ kind: 'clusterDetail', cluster: CLUSTER })
    expect(body.kind).toBe('panel')
    if (body.kind === 'panel' && body.panel.kind === 'clusterDetail') {
      expect(body.panel.cluster).toBe(CLUSTER)
    } else {
      throw new Error('expected the cluster-detail panel')
    }
  })
})

describe('playback bar controls', () => {
  it('is PRESENT at the live edge, carrying the LIVE badge and nothing recorded', () => {
    const layout = playbackBarLayout('live', false)
    expect(layout.leading).toBe('liveBadge')
    expect(layout.showJog).toBe(false)
    expect(layout.showStep).toBe(false)
    expect(layout.showRate).toBe(false)
    // The record control captures the decoded live picture — only while that
    // picture is actually playing. The trailing slot is empty of the speed
    // selector here.
    expect(layout.record).toBe('liveCapture')
  })

  it('hides the record control while the live picture is paused (poster, no stream)', () => {
    expect(playbackBarLayout('live', true).record).toBe('hidden')
  })

  it('never runs the live-capture flow in a recorded mode', () => {
    // The defect this replaces: the recorded bar drew a rec dot whose handler
    // called `startLiveCapture()` regardless of mode, and the screen answered
    // "cannot record the live view" — there is no live view to record.
    for (const mode of RECORDED_MODES) {
      expect(playbackBarLayout(mode, false).record, mode).toBe('exportSelection')
      expect(playbackBarLayout(mode, true).record, mode).toBe('exportSelection')
    }
  })

  it('carries the recorded cluster in EVERY non-live mode', () => {
    for (const mode of RECORDED_MODES) {
      const layout = playbackBarLayout(mode, false)
      expect(layout.leading, mode).toBe('goLive')
      expect(layout.showJog, mode).toBe(true)
      expect(layout.showRate, mode).toBe(true)
    }
  })

  it('offers frame-step only while paused (the server steps AU-exact at rate 0)', () => {
    expect(playbackBarLayout('playback', true).showStep).toBe(true)
    expect(playbackBarLayout('playback', false).showStep).toBe(false)
    // Never at the live edge, paused or not — there is nothing to step.
    expect(playbackBarLayout('live', true).showStep).toBe(false)
  })
})

/**
 * Live and lock are ONE control, and it exists only at the live edge.
 *
 * A second Live button — or a lock chip that stays in recorded playback next
 * to "go to live" — is the failure this asserts against. The bar has one
 * leading slot: at live it IS the lock toggle; off live it is return-to-live
 * and the lock is gone.
 */
describe('the live lock folds into the leading control', () => {
  const ALL_MODES: readonly PlaybackMode[] = ['live', ...RECORDED_MODES]

  it('is UNLOCKED at the live edge unless the caller says otherwise', () => {
    expect(playbackBarLayout('live', false).liveLock).toBe('unlocked')
  })

  it('reports the armed lock on the LIVE badge', () => {
    const layout = playbackBarLayout('live', false, true)
    expect(layout.leading).toBe('liveBadge')
    expect(layout.liveLock).toBe('locked')
  })

  it('hides the lock in recorded playback — go-live is return, not lock', () => {
    for (const mode of RECORDED_MODES) {
      const layout = playbackBarLayout(mode, false, true)
      expect(layout.leading, mode).toBe('goLive')
      expect(layout.liveLock, mode).toBe('hidden')
    }
  })

  it('never resolves to a SECOND live control, locked or not', () => {
    for (const mode of ALL_MODES) {
      for (const locked of [false, true]) {
        const layout = playbackBarLayout(mode, false, locked)
        // One leading slot, one value.
        expect(['liveBadge', 'goLive'], `${mode}/${locked}`).toContain(layout.leading)
        // …and no parallel show-the-live-button flag that could disagree with it.
        expect(
          Object.keys(layout).filter((key) => /live/i.test(key)),
          `${mode}/${locked}`,
        ).toEqual(['liveLock'])
      }
    }
  })

  /**
   * A surface that offers no live lock at all — `null`, which is a third
   * answer and not a shade of `false`.
   *
   * The on-demand overlay is one: it is a movable window over another page,
   * its tape is a day strip with no preview pane, and arming the lock there
   * makes every press on that tape preview-only — the cursor moves, the
   * picture does not, and nothing on the window says why. A control that
   * accepts a press and throws the result away is worse than an absent one, so
   * the binding is ABSENT rather than disabled: the same rule `onStepFrame`
   * already follows on this bar.
   */
  it('a surface with no lock binding gets no lock, at the live edge too', () => {
    expect(playbackBarLayout('live', false, false).liveLock).toBe('unlocked')
    expect(playbackBarLayout('live', false, null).liveLock).toBe('hidden')
    expect(playbackBarLayout('live', false, null).leading).toBe('liveBadge')
  })

  it('and an absent lock changes NOTHING else about the bar', () => {
    for (const mode of ALL_MODES) {
      const bound = playbackBarLayout(mode, true, false)
      const absent = playbackBarLayout(mode, true, null)
      expect({ ...absent, liveLock: bound.liveLock }, mode).toEqual(bound)
    }
  })

  it('leaves the recorded cluster decisions untouched', () => {
    // The lock changes WHERE the picture is, never which transport the bar
    // offers for the mode it is in.
    for (const mode of ALL_MODES) {
      const plain = playbackBarLayout(mode, true)
      const locked = playbackBarLayout(mode, true, true)
      expect({ ...locked, liveLock: plain.liveLock }, mode).toEqual(plain)
    }
  })
})

describe('TimelinePlaybackBar — one leading control, never two chips', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/camera/theater/TimelinePlaybackBar.tsx'), 'utf8')
  /**
   * The leading slot is a three-way ternary and each branch names itself, so
   * this guard can read one branch at a time instead of guessing where one
   * ends. Change a marker and this fails loudly rather than going blind.
   */
  const between = (from: string, to: string): string => {
    const start = src.indexOf(from)
    const end = src.indexOf(to)
    expect(start, from).toBeGreaterThan(-1)
    expect(end, to).toBeGreaterThan(start)
    return src.slice(start, end)
  }
  const GO_LIVE = '/* leading:goLive */'
  const PLAIN = '/* leading:liveBadge, no lock binding */'
  const LOCK = '/* leading:liveBadge + lock */'
  const goLiveChip = between(GO_LIVE, PLAIN)
  const plainChip = between(PLAIN, LOCK)
  // The leading branches are one fragment (`leadingEl`), which ends where the
  // centre's is declared.
  const lockChip = between(LOCK, 'const centreEl = (')

  it('the LIVE chip is the lock toggle — not a View badge beside a lock Pressable', () => {
    expect(lockChip).toContain('<Pressable')
    expect(lockChip).toContain('onToggleLiveLock()')
    expect(lockChip).toContain('<Lock')
    expect(lockChip).toContain('<LockOpen')
    expect(lockChip).not.toContain('<View')
  })

  it('go-live has no lock sibling — the lock is hidden off the live edge', () => {
    expect(goLiveChip).toContain('onGoLive()')
    expect(goLiveChip).not.toContain('onToggleLiveLock()')
    expect(goLiveChip).not.toContain('<Lock')
    expect(goLiveChip).not.toContain('<LockOpen')
  })

  /**
   * ABSENT, not disabled. A surface that binds no lock draws a LIVE badge that
   * takes no press at all — not a greyed padlock, which would say the mode
   * exists here and is merely unavailable.
   */
  it('no lock binding draws a badge that is not pressable and has no padlock', () => {
    expect(plainChip).toContain('<View')
    expect(plainChip).not.toContain('<Pressable')
    expect(plainChip).not.toContain('onToggleLiveLock')
    expect(plainChip).not.toContain('<Lock')
    expect(plainChip).not.toContain('disabled')
  })
})

/**
 * The export selection takes over the bar's TRAILING side.
 *
 * The trailing slot already holds one control per mode (the live rec dot, the
 * recorded speed chip). While a selection is armed it holds two — Save and
 * Discard — and in landscape the bar is the narrowest surface in the app, so
 * the speed chip has to go rather than be crowded. It costs nothing: a selection
 * is not playing, so there is no rate to choose, and the jog/step controls would
 * LAND the player and end the selection's whole premise.
 */
describe('playbackBarLayout — ONE record control, two flows', () => {
  it('recorded and idle: the control anchors a period, the transport is intact', () => {
    const layout = playbackBarLayout('playback', false, false, true, false)
    expect(layout.record).toBe('exportSelection')
    expect(layout.showRate).toBe(true)
    expect(layout.showJog).toBe(true)
  })

  it('armed: the speed chip and the frame-step go, the ±10 s jog stays to trim the span', () => {
    const layout = playbackBarLayout('playback', false, false, true, true)
    expect(layout.record).toBe('exportSelection')
    expect(layout.showRate).toBe(false)
    expect(layout.showJog).toBe(true)
    expect(layout.showStep).toBe(false)
  })

  it('a live capture withdraws nothing: the live edge draws none of those controls', () => {
    const layout = playbackBarLayout('live', false, false, true, true)
    expect(layout.record).toBe('liveCapture')
    expect(layout.leading).toBe('liveBadge')
  })

  it('every recorded mode drives the selection flow, gaps and errors included', () => {
    for (const mode of ['seeking', 'playback', 'gap', 'error'] as const) {
      expect(playbackBarLayout(mode, false).record, mode).toBe('exportSelection')
    }
  })
})

describe('a clip in the frame turns the jog pair into clip stepping', () => {
  /**
   * > *"possiamo usare la playback bar per supportarli"* — the operator, on
   * prev/next for a clip playing in the camera's own frame (D575).
   *
   * They used to live on the separate clip sheet, which a frame clip no longer
   * draws — so `clipStage.step` became unreachable and the operator had no way
   * from one clip to the next but the list.
   *
   * The JOG pair carries them rather than a new pair: ±10 s is a verb about the
   * ARCHIVE — somewhere to go before and after — and a clip is a unit with its
   * own edges, where what is before and after is another clip. Same two slots,
   * same position, same fit ladder, no width to find.
   *
   * ONE field with two values rather than two booleans: this module exists to
   * make a visible control that does nothing unrepresentable, and a
   * `showClipSteps` beside `showJog` is exactly the pair that can disagree.
   */
  it('means CLIP when a clip holds the frame', () => {
    const l = playbackBarLayout('playback', false, null, true, false, true)
    expect(l.showJog).toBe(true)
    expect(l.jogMeans).toBe('clip')
  })

  it('means TIME in ordinary recorded playback', () => {
    const l = playbackBarLayout('playback', false, null, true, false, false)
    expect(l.showJog).toBe(true)
    expect(l.jogMeans).toBe('time')
  })

  it('draws no pair at the live edge with NOTHING held', () => {
    expect(playbackBarLayout('live', false, false, true, false, false).showJog).toBe(false)
  })

  it('DOES draw it when a clip holds the frame at the live edge — the picture is a file', () => {
    // This asserted the opposite ("clip or not") and that is the bug the
    // operator reported: opening a clip does not move the session, and on a
    // battery camera the session is deliberately still at the live edge
    // (`battery-stream-gate.ts`), so `mode` stays `'live'` while a FILE is on
    // screen. Every recorded control hangs off that one flag, so the bar drew
    // a LIVE badge over a clip and withdrew the whole transport.
    const l = playbackBarLayout('live', false, false, true, false, true)
    expect(l.showJog).toBe(true)
    expect(l.jogMeans).toBe('clip')
    expect(l.showRate).toBe(true)
    // Frame-step stays bound to PAUSED, as everywhere else: the server steps
    // AU-exact at rate 0, so a step button on a playing clip would do nothing.
    expect(l.showStep).toBe(false)
    expect(playbackBarLayout('live', true, false, true, false, true).showStep).toBe(true)
    // And the way OUT: go-live leaves the clip in one dispatch (D570). A LIVE
    // badge here would be a label claiming the file IS the live edge.
    expect(l.leading).toBe('goLive')
    expect(l.liveLock).toBe('hidden')
  })

  it('withdraws it while a selection is armed, clip or not', () => {
    // The jog survives an armed selection (it trims the span), but stepping to
    // another clip lands the player somewhere else entirely.
    expect(playbackBarLayout('playback', false, null, true, true, true).showJog).toBe(false)
  })

  it('defaults to TIME when the caller says nothing', () => {
    // A surface that has not been taught about clips must not start drawing a
    // clip verb — absent is the old behaviour, exactly.
    expect(playbackBarLayout('playback', false, null, true, false).jogMeans).toBe('time')
  })
})
