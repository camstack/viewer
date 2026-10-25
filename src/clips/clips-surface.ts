/**
 * clips-surface — what the camera-detail chrome IS, once the body is clips.
 *
 * ## The second case is not a smaller version of the first
 *
 * > *"una camera senza registrazione: si naviga le clip."* — the operator.
 *
 * A camera with no continuous recording has no coverage. The timeline, the
 * scrub and the playhead are not *empty* there — they are **meaningless**, and
 * the difference matters because an empty timeline still invites a gesture:
 * dragging it commits a seek into our recorder's footage, which for this camera
 * is either nothing or (on a camera that records as well) a completely
 * unrelated moment. Drawing a time axis that has nothing to say is worse than
 * drawing none.
 *
 * ## The discriminator is the SOURCE, not the camera
 *
 * It would be natural to branch on "does this camera have recording coverage".
 * That is the wrong question, and 592 is the counter-example this repo can
 * measure: it records continuously to the hub AND holds 357 files on its own
 * SD card. With the onboard source picked (D569 — one camera, one source), every
 * card on the body is a FILE. No epoch reaches a file, so the playhead has
 * nothing to do with what is on screen, coverage or no coverage. Branching on
 * coverage would hand one camera two different surfaces for one list.
 *
 * So the rule is: **a body of files has no time axis.** Both of the operator's
 * cases fall out of it — the camera with recording and the camera without get
 * the same surface for the same reason, because the reason is the source.
 *
 * ## A clip on the frame has an axis of its OWN (2026-09-22)
 *
 * This module used to say that a held clip has no playhead and no scrub,
 * because "no epoch addresses a position inside it, so a drag there would seek
 * the session behind the clip". The first half is true and the conclusion does
 * not follow: a clip is seekable **file-relative**, and the server has spoken
 * that axis since D575. `timeline-session.ts` routes `seek`, `scrubStart`,
 * `scrubTo`, `scrubCommit`, `setRate` and `stepFrame` to the CLIP feeder
 * whenever a clip holds the pointer — its own tests pin exactly that ("seek /
 * scrubCommit / rate / step stay on the clip feeder and its own axis", "a
 * scrub started during a clip drags the CLIP, not a recorded feeder").
 *
 * So the drag could never have reached the session. What actually happened is
 * that the viewer suppressed the controls for a capability the server already
 * had, and the operator asked for it back in as many words: *"possiamo
 * mostrarlo anche durante una clip per mostrare l'avanzamento della clip con
 * possibilità di seek"*, and *"serve la playback bar con il go live e tutto il
 * resto"*.
 *
 * Hence the third surface. A held clip is not a reduced timeline and not a
 * list: it is the FILE's own chrome — a position inside the file, a drag along
 * it, the transport band (whose `goLive` is what leaves the clip, D570), and
 * prev/next through the list it came from. The `axis` field exists so no
 * consumer has to guess which of the two axes a playhead or a drag is speaking
 * — the thing that made "no epoch reaches a file" read as "nothing reaches a
 * file" for a month.
 *
 * ## Each control asks the question it DEPENDS on (D606)
 *
 * The rule above is about the BODY, and for one release it was applied to the
 * player as well: the native clips list answered `transport: false`, so a
 * camera whose picture was on screen lost play/pause, go-live and the rate
 * chip because the CARDS underneath had no epoch. The operator found it the
 * way these are always found — *"quando una camera a batteria non dorme non è
 * la stessa modalità di stop: invece della playback bar abbiamo il pulsante
 * sullo stream. È inconsistente."* — and the workaround that had papered over
 * it (`overlay-play-pause.ts`'s battery short-circuit, now deleted) already
 * wrote the rule down: **a battery hold is a STREAM state, not a time
 * control.**
 *
 * So the three questions are separated at last, and each field names its own:
 *
 *  - {@link transport} — about the PLAYER. The frame always has an occupant,
 *    a session or a file, and it always has a transport. It is therefore
 *    **constant true**, and which verbs the band offers is the occupant's
 *    business (`playbackBarLayout` reads the mode and `clipHeld`), never the
 *    body's. It stays a field rather than becoming an assumption so a fifth
 *    surface still has to say so out loud.
 *  - {@link playhead} and {@link scrub} — about the BODY's axis. A body of
 *    files has no epoch under it, so an indicator over it and a drag through
 *    it stay withdrawn. That half of the original reasoning is untouched.
 *  - {@link heatmap} — about the DAY, which both bodies address: a file has a
 *    wall-clock start even though it is not laid out against one. The strip is
 *    drawn on the clips list too (*"la heatmap rimane con i salti verso le
 *    clip dove si è cliccato"*) and its press means something different there
 *    — see {@link ClipsHeatmapVerb}.
 *
 * This retires `timeAxis`, which was the only field left answering two
 * questions: it said "the body is laid out against time" and was read for
 * exactly one thing, whether to draw the heatmap. The claim it made is still
 * available, sharper, as `axis !== 'epoch'`.
 *
 * Pure: no React, no i18n, no network.
 */

/** Which of D569's two exclusive derivations filled the body. */
export type ClipsDerivation = 'derived' | 'cap'

/**
 * WHICH axis the playhead and the drag speak.
 *
 * `epoch` — cluster time; a seek names a moment and the recorder resolves it.
 * `clip`  — milliseconds from the start of the file on screen; the clip feeder
 *           resolves it and no epoch is involved.
 * `none`  — the body is a list; there is nothing to point at.
 *
 * `epoch` is also the one statement that the BODY is laid out against cluster
 * time — the claim `timeAxis` used to make as a second field that could
 * disagree with this one.
 */
export type ClipsAxis = 'epoch' | 'clip' | 'none'

/**
 * What a press on the DAY STRIP means.
 *
 * The strip itself is drawn on every surface: both bodies address the day, and
 * a file has a wall-clock start even though it is not laid out against one.
 * What changes is the target — and it has to be a declared verb rather than a
 * boolean, because the two are not the same gesture with a different range.
 *
 * `seek`     — move OUR recorded pointer to that instant. The body is bands or
 *              derived cards over the hub's own footage, and the instant
 *              exists in it.
 * `pickClip` — open the FILE covering that instant. The body is a list the
 *              camera wrote; the recorder either has nothing there or has an
 *              unrelated moment, so seeking it would play the right time from
 *              the wrong source — the very thing `clip-tap.ts` exists to
 *              prevent. The operator asked for exactly this: *"la heatmap
 *              rimane con i salti verso le clip dove si è cliccato"*.
 * `none`     — not drawn. ONE case: a clip holds the frame over an epoch body.
 *              A press would have to leave the clip first, and nothing in this
 *              app does that except go-live (D570) — so a strip here is the
 *              timeline seeking underneath a held clip, which is the defect
 *              this module was written for. Withheld, not disabled: there is
 *              no target to disable, and the way out is the band's go-live.
 */
export type ClipsHeatmapVerb = 'seek' | 'pickClip' | 'none'

export interface ClipsSurfaceInput {
  readonly clipsMode: boolean
  readonly derivation: ClipsDerivation
  /**
   * A CLIP is in the camera's frame right now.
   *
   * It matters on the DERIVED surface, where the chrome is otherwise live: a
   * clip file has its own duration and no epoch addresses a position inside
   * it, so a drag there would seek the session behind the clip. There used to
   * be a second gate in the screen for exactly this, decided separately from
   * this function — two authorities over one question, which is how the
   * timeline kept driving a held frame while a comment three files away said
   * it could not (2026-09-21).
   */
  readonly clipHeld?: boolean
}

/**
 * The chrome, as one independent claim per piece of it.
 *
 * Separate fields rather than one enum because each is read by a different
 * piece of chrome and a future fifth surface must be forced to answer for each
 * — an enum would let it inherit a set of answers nobody chose. Two of them
 * are declared VERBS rather than booleans ({@link axis},
 * {@link heatmap}) for the same reason in the other direction: a boolean there
 * would make two different gestures look like one gesture switched off.
 */
export interface ClipsSurface {
  readonly kind: 'timeline' | 'clips' | 'clip'
  /** The day strip, and what a press on it commands. See
   *  {@link ClipsHeatmapVerb} — it is drawn on the clips list too. */
  readonly heatmap: ClipsHeatmapVerb
  /** Which axis {@link playhead} and {@link scrub} are measured on. A consumer
   *  that draws either MUST read this: the same two booleans mean a moment in
   *  cluster time on one surface and an offset into a file on another. */
  readonly axis: ClipsAxis
  /** An indicator that claims "the picture is HERE". */
  readonly playhead: boolean
  /**
   * The TIMELINE DRAG may command a seek. The body's own gesture, on the
   * body's own axis — the day strip is {@link heatmap} and is a different
   * control asking a different question, which is why the two were split.
   */
  readonly scrub: boolean
  /**
   * The play/pause, rate, frame-step and go-live band.
   *
   * CONSTANT TRUE, and kept as a field for it: the band addresses the frame's
   * occupant, the frame always has one, and a surface that wants to withdraw
   * it has to say so here rather than inherit it. The one surface that did
   * withdraw it — the native clips list — cost a battery camera every way of
   * starting its own picture (D606).
   */
  readonly transport: boolean
  /**
   * Prev / next through the clip LIST — what "navigate the clips" means when
   * there is no axis to anchor navigation to. See `clipStageStep`: it walks
   * the list's own order, steps over rows the provider refused, and does not
   * wrap, so the ends of the list read as ends.
   */
  readonly stepsClips: boolean
}

export function resolveClipsSurface(input: ClipsSurfaceInput): ClipsSurface {
  // The one body whose day strip addresses FILES rather than our footage.
  // Read by the held arm too — the strip belongs to the BODY, which a clip
  // taking the frame does not change.
  const fileBody = input.clipsMode && input.derivation === 'cap'
  // A FILE on the frame is its own surface, whatever the body behind it is.
  // This arm is first and total on purpose: `clip-stage.ts` makes `session`
  // and `clip` arms of one union, and a second place deciding "which of the
  // two is on screen" is exactly the double authority that kept the timeline
  // seeking under a held clip.
  if (input.clipHeld === true) {
    return {
      kind: 'clip',
      // The strip is the BODY's, and the body is whatever it was before the
      // file took the frame. Over a list of files a press picks another file,
      // which is the same total transition prev/next already makes. Over an
      // epoch body it would have to leave the clip first, and nothing but
      // go-live does that — so there is no strip there rather than a strip
      // that seeks underneath the picture.
      heatmap: fileBody ? 'pickClip' : 'none',
      // …but it has a position, and the server resolves it (D575). `axis` is
      // what tells the transport band that its progress control measures
      // milliseconds into the FILE, not cluster time.
      axis: 'clip',
      // NOT drawn — 2026-09-23, after a day of it on the operator's phone.
      // *"Rimuoviamo decisamente il cursore per la modalità clip"*. The mark
      // sits on a LIST that commands nothing here (`scrub: false`, and the
      // live snap refused with it), so a cursor over it reads as a control
      // that ignores the finger — the one thing D62 says is worse than no
      // control. Where the clip IS, is the row's own strip on the card
      // (`clip-row-playback.ts`) and the transport band's progress bar; both
      // are on the file's axis and both take a gesture.
      playhead: false,
      // Still false, and this is not the old reasoning. `scrub` is the
      // TIMELINE DRAG, and while a clip is held the body under that drag is
      // the clip LIST — dragging it browses the list, which is how the next
      // clip is found. Seeking inside the file is a different gesture on a
      // different control (the transport's progress bar, which reads `axis`),
      // and wiring the list drag to it would mean scrolling the list moved the
      // picture.
      scrub: false,
      // Includes go-live, which is what LEAVES the clip in one dispatch (D570)
      // — the frame has to have a way out that is not the back button.
      transport: true,
      // And the list it came from is still there to step through.
      stepsClips: true,
    }
  }
  if (!input.clipsMode) {
    return {
      kind: 'timeline',
      heatmap: 'seek',
      axis: 'epoch',
      playhead: true,
      scrub: true,
      transport: true,
      stepsClips: false,
    }
  }
  if (input.derivation === 'derived') {
    // Clips cut out of OUR recording. Every card is a range the recorded
    // transport already reaches by epoch, so the playhead is over the thing on
    // screen and the transport is driving it. Taking the controls away here
    // would remove the controls for the picture.
    return {
      kind: 'clips',
      heatmap: 'seek',
      axis: 'epoch',
      playhead: true,
      scrub: true,
      transport: true,
      stepsClips: false,
    }
  }
  // A body of FILES. No epoch runs under the cards, so nothing that MEASURES
  // the body is drawn — but the picture in the frame is the live session, and
  // its controls are not the body's to withdraw (D606).
  return {
    kind: 'clips',
    heatmap: 'pickClip',
    axis: 'none',
    playhead: false,
    scrub: false,
    transport: true,
    stepsClips: true,
  }
}
