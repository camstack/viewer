/**
 * The theater timeline's DOCKED layout model.
 *
 * ## Why this exists
 *
 * Every layout defect this module retires had the same shape: a control that
 * floats has to guess a space it does not own, and guesses wrong the moment the
 * window changes shape. The bottom action row was ~212pt of buttons inside a
 * ~230pt box and got clipped. The transport pill anchored itself above the
 * now-line and painted over the activity strip on every short landscape drawer.
 *
 * The structure that cannot do either has exactly TWO states below the main
 * toolbar:
 *
 *   TIMELINE                       PANEL
 *   playback bar                   the panel owns the whole box, including
 *   timeline content               its own way back
 *   footer bar
 *
 * The cluster detail is one of those panels. It used to be a slide-up `Modal`,
 * which is the same disease in a different costume: a portrait-shaped
 * presentation negotiating for a space it does not own, and therefore wrong the
 * moment the window is short and wide.
 *
 * The two bands are the TIMELINE's chrome, so they live inside `TimelineView`
 * rather than beside the panel. That is deliberate: the alternative is a
 * "panel is open" flag threaded to two sibling bars, and a flag is only ever
 * honoured by the components somebody remembered to thread it to. Inside the
 * timeline, a band cannot survive into panel state at all.
 *
 * Two decisions remain, and both are pure — which is why they live here rather
 * than inline in a component that cannot be mounted at these sizes in the test
 * environment (the exact reason the pill's overlap survived a full redesign
 * without a single test noticing):
 *
 *  1. What the body shows — the timeline (with its bands), or a panel that
 *     REPLACES all of it.
 *  2. Which controls the PLAYBACK BAR shows. Within the timeline state the bar
 *     is ALWAYS present; only its contents vary with the playback mode.
 */

import type { PlaybackMode } from '../../../recording/playback-machine.js'
import type { PositionedCluster } from './event-cluster.js'
import { shouldShowStepControls } from '../recorded-transport.js'

/**
 * Which panel is open.
 *
 * The last seven arrived on 2026-08-01, from the camera-detail screen. Three
 * were `FloatingPanel`s (PTZ, linked devices, the camera switcher) plus the
 * quality picker and the view-options menu — absolute cards anchored to a
 * `topOffset` the SCREEN derived from the animated video-box height — and two
 * were RN `<Modal>`s (storage, event store). Same disease, two costumes: a
 * surface negotiating for a space it does not own.
 *
 * They belong HERE, in the timeline's own state, and not in a second
 * `activePanel` union on the screen, because every one of their triggers is
 * timeline chrome: the toolbar's PTZ / devices / ≡ / quality buttons and the
 * footer's camera button. Two unions would have to agree about which one is
 * open; one cannot disagree with itself.
 *
 * There is no `overlay` member: the overlay sub-panel was dissolved into the
 * view-options menu on 2026-08-02, once every setting the menu held WAS an
 * overlay setting and the entry was one tap of pure indirection.
 *
 * And there is no `ptz`, `devices`, `captureActions` or `export` member any
 * more, since 2026-09-02. Their four buttons left the toolbar when the timeline
 * became the VIEW's timeline rather than one camera's (see
 * `TimelineToolbarInline`), which left four panels nothing could open. They are
 * gone from the union rather than merely unreachable, so the type system — not
 * a convention — is what stops one coming back without a control that means
 * something for a set of cameras. `git show 27d0d98` has the components.
 */
export type TimelinePanelKind =
  | 'filter'
  | 'date'
  | 'clusterDetail'
  | 'cameraSwitcher'
  | 'viewOptions'
  | 'linkedDevices'
  | 'ptz'
  | 'legend'
  | 'storage'
  | 'eventStore'

/**
 * The panels that can take over the timeline body, WITH whatever each needs to
 * render.
 *
 * The cluster detail carries its cluster rather than reading a second piece of
 * state, so "the detail panel is open" and "there is a cluster to show" cannot
 * disagree. As a `Modal` it could: the modal's visibility was
 * `cluster !== null`, which is the same coupling written as a convention
 * instead of a type.
 *
 * Every other member is payload-free, which is what makes the toolbar's active
 * chips DERIVED (`panel?.kind === 'viewOptions'`) instead of a parallel boolean per
 * button — the shape the screen used to carry, where "the PTZ chip is lit" and
 * "the PTZ panel is mounted" were two facts that had to be kept in step.
 */
export type TimelinePanel =
  | { readonly kind: 'filter' }
  | { readonly kind: 'date' }
  | { readonly kind: 'clusterDetail'; readonly cluster: PositionedCluster }
  | { readonly kind: 'cameraSwitcher' }
  | { readonly kind: 'viewOptions' }
  /** The camera's linked companion devices. A panel of THIS body, like
   *  `viewOptions` — it was hosted by the wall's overlay instead, which is why
   *  its toolbar chip could not derive an active state and never lit. */
  | { readonly kind: 'linkedDevices' }
  /** PTZ pad. A panel of THIS body for the same reason as `linkedDevices`. */
  | { readonly kind: 'ptz' }
  | { readonly kind: 'legend' }
  | { readonly kind: 'storage' }
  | { readonly kind: 'eventStore' }

/** The body shows the timeline itself: playback bar, heatmap + scroller, footer. */
export interface TimelineBodyTimeline {
  readonly kind: 'timeline'
}

/** The body is taken over by a panel — neither the timeline nor its two bands
 *  are drawn underneath. */
export interface TimelineBodyPanel {
  readonly kind: 'panel'
  readonly panel: TimelinePanel
}

export type TimelineBody = TimelineBodyTimeline | TimelineBodyPanel

/**
 * What the box under the main toolbar renders. Exclusive by type: there is no
 * state in which a panel and the timeline are both drawn, so a panel never has
 * to be positioned around content it covers — it has the whole box.
 */
export function resolveTimelineBody(panel: TimelinePanel | null): TimelineBody {
  return panel === null ? { kind: 'timeline' } : { kind: 'panel', panel }
}

/** Which of the playback bar's optional controls are rendered. */
export interface PlaybackBarLayout {
  /** The bar's leading chip: the LIVE badge, or the return-to-live button. */
  readonly leading: 'liveBadge' | 'goLive'
  /**
   * The live lock, drawn INSIDE the leading control — never as a second Live
   * button. Locked, the timeline can be browsed while the picture stays where
   * it is; unlocked, navigating is playing, which is the older behaviour.
   *
   * `hidden` off the live edge: recorded playback's leading slot is return-to-
   * live, and a lock chip beside it is the two-control defect. It is a state of
   * the one leading slot rather than a `showLiveLock` flag precisely because a
   * parallel boolean is a thing that can disagree with `leading`.
   *
   * `hidden` AT the live edge too, when the surface offers no lock binding at
   * all (`liveLocked === null`) — see the parameter.
   */
  readonly liveLock: 'locked' | 'unlocked' | 'hidden'
  /** ±10s jog — recorded navigation only. */
  readonly showJog: boolean
  /**
   * What that pair DOES, when it is drawn.
   *
   * `time` — ±10 s through the archive, the ordinary recorded verb.
   * `clip` — the previous / next clip, when a clip holds the frame (D575).
   *   ±10 s is a verb about somewhere to GO before and after; a clip is a unit
   *   with its own edges, and what is before and after it is another clip.
   *
   * One field with two values rather than a `showClipSteps` beside `showJog`:
   * this module exists to make a visible control that does nothing
   * unrepresentable, and two booleans about one pair are exactly what can
   * disagree.
   */
  readonly jogMeans: 'time' | 'clip'
  /** Frame-step — recorded AND paused (the server steps AU-exact at rate 0),
   *  AND the surface can actually step. A wall of N has no frame-stepping verb
   *  on the playback bus, and a visible control that does nothing is the defect
   *  this whole module exists to make unrepresentable. */
  readonly showStep: boolean
  /** The speed selector — recorded playback only. */
  readonly showRate: boolean
  /**
   * What the ONE record control on the trailing side does — or `hidden` when
   * there is no such control.
   *
   *   • `liveCapture`     — the live edge: record the decoded live picture from
   *                         the press onwards. Forward in time, from now.
   *   • `exportSelection` — a recorded mode: anchor a period at the playhead and
   *                         draw the other end with the scrub. Either
   *                         direction, over footage that already exists.
   *   • `hidden`          — a PAUSED live surface. Live pause is a poster
   *                         teardown with no WebRTC behind it, so there is no
   *                         decoded picture to record.
   *
   * ONE field, not a `showCapture` boolean beside a `selection` tri-state. The
   * two used to be separate, both drew the same red dot in the same slot, and
   * the operator read them as one button that behaved differently for no
   * visible reason — pressing it in a recorded mode reported "cannot record the
   * live view", because the screen's handler ran the live path regardless of
   * mode. The MODE picks the flow, here, once; nothing downstream branches on
   * it again.
   */
  readonly record: 'hidden' | 'liveCapture' | 'exportSelection'
}

/**
 * The controls for a playback mode.
 *
 * `live` is not "the bar is hidden": the bar is docked and permanent, and at the
 * live edge it carries the LIVE badge plus play/pause and nothing else. Every
 * recorded mode (`seeking` / `playback` / `gap` / `error`) carries the full
 * recorded cluster — including `gap`, where the operator is parked over missing
 * footage and jogging out of it is exactly what they need.
 */
export function playbackBarLayout(
  mode: PlaybackMode,
  paused: boolean,
  /** The lock's state, or `null` when this surface has NO lock to offer.
   *  `null` is a third answer and not a shade of `false`: the on-demand overlay
   *  has a day tape and no preview pane, so an armed lock there turns every
   *  press on that tape into a cursor that moves while the picture does not.
   *  An absent binding means an absent control, never a disabled one — the rule
   *  `onStepFrame` and `record` already follow on this bar. */
  liveLocked: boolean | null = false,
  canStep = true,
  /** The record control is RUNNING: a live capture is being written, or a
   *  selection is armed. One flag for both flows, because the bar draws the
   *  same pair of buttons either way and the flow is decided by `mode`. */
  recording = false,
  /**
   * A clip holds the frame (D575). Defaults to `false` so a surface that has
   * not been taught about clips keeps exactly the behaviour it had — absent
   * must never start drawing a verb nobody wired.
   */
  clipHeld = false,
): PlaybackBarLayout {
  // A HELD CLIP IS NOT THE LIVE EDGE, whatever the session behind it is doing.
  //
  // This read `mode === 'live'` alone, and every recorded control hangs off
  // it: `showJog`, `showStep`, `showRate`, and the leading slot. Opening a
  // clip does not move the session — on a battery camera the session is
  // *deliberately* still at the live edge (`battery-stream-gate.ts`) — so the
  // bar kept drawing the LIVE badge and withdrew the whole transport for the
  // one thing on screen that is neither live nor the recorder's footage.
  //
  // The operator's words: *"serve la playback bar con il go live e tutto il
  // resto. Anche per andare alla prossima Clips o navigare internamente alla
  // Clips dove possibile"* — three controls, all of which the clip feeder has
  // implemented since D575 and none of which the bar offered.
  //
  // `goLive` is also the clip's way OUT: it leaves the clip in one dispatch
  // and forgets it (D570), so the frame stops being a room with no door.
  const live = mode === 'live' && !clipHeld
  // What the SESSION's record control would be, before a clip is considered.
  // `armed` is derived from THIS rather than from the field below: withdrawing
  // the record control must not, by itself, resurrect the landing controls an
  // armed selection withdrew.
  const sessionRecord = live ? (paused ? 'hidden' : 'liveCapture') : 'exportSelection'
  // A FILE on the frame is not recordable, and the bar's trailing slot holds
  // ONE control. A live capture would record the stored file off the <video>
  // (`shouldEndLiveCapture` already ends one for exactly this), and an export
  // selection would cut the recorder's footage under a picture that is not it
  // — the screen withholds both bindings for a held clip, and saying it HERE
  // is what makes the slot's single occupant a rule rather than a custom. It
  // is also what the fit estimator prices (`playback-bar-fit.ts`: ONE trailing
  // icon button): the LOOP switch takes that slot while a clip is held.
  const record = clipHeld ? 'hidden' : sessionRecord
  // An armed selection withdraws the controls that would LAND the player on its
  // own: frame-step and the rate chip both resume or advance playback, and the
  // playhead moving is what the operator asked NOT to happen while they draw the
  // range. The ±10 s jog is the exception — while a selection is armed the
  // machine turns a seek into a PREVIEW (the selection's free end), so the jog
  // is the precise way to trim the span and nothing plays. A live capture
  // withdraws nothing: the live edge does not draw those controls at all, and
  // the picture keeps playing while it records.
  const armed = sessionRecord === 'exportSelection' && recording
  return {
    leading: live ? 'liveBadge' : 'goLive',
    liveLock: live && liveLocked !== null ? (liveLocked ? 'locked' : 'unlocked') : 'hidden',
    // The jog survives an armed selection: it moves the selection's free end,
    // which is exactly what the operator is doing. Step and rate stay withdrawn.
    // (A held clip's jog is clip stepping, which would land elsewhere: withdrawn.)
    showJog: !live && !(armed && clipHeld),
    jogMeans: clipHeld ? 'clip' : 'time',
    showStep: canStep && !live && !armed && shouldShowStepControls(paused),
    showRate: !live && !armed,
    record,
  }
}
