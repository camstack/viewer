/**
 * record-control — which flow the bar's ONE record button drives, and what it
 * hands that button.
 *
 * The operator's rule, and the whole content of this module: *the record button
 * has two effects. At the live edge it records forward from now; in a recorded
 * mode it works on the scrub.* The SHAPE is the same either way — press, then
 * Discard beside Accept-with-the-duration — so the gesture is learned once and
 * neither flow needs announcing.
 *
 * It lives here, pure, rather than inline in `TheaterTimeline`, because the
 * defect it retires was exactly a mode-blind branch in a component nothing can
 * mount in this test environment: the recorded bar drew a rec dot whose handler
 * called `startLiveCapture()` regardless of mode, and the screen answered
 * "cannot record the live view" over a picture that was recorded footage. A
 * rule that decides this can be asserted; a `?:` in a 2 000-line component
 * cannot.
 *
 * There is no third state and no picker. The mode already says which flow is
 * possible, so asking would be asking a question with one answer.
 */
import type { PlaybackMode } from './playback-machine.js'
import type { ExportSelectionRange, ExportSelectionView, SelectionCoverage } from './export-selection.js'
import { resolveRecordMenu, type RecordMenuAction } from './record-menu.js'
import type { SelectionKind } from './selection-commit.js'

/**
 * What the bar needs to draw the record cycle, and nothing more.
 *
 * ONE binding for BOTH flows: the bar never asks which one it is showing. What
 * differs is only what the three callbacks DO, and that belongs to whoever owns
 * the flow — the screen owns the capture session (it owns the player), the
 * playback machine owns the selection's anchor, `export-selection.ts` owns its
 * arithmetic and the hub call is the screen's.
 */
export interface RecordControlBinding {
  /** What the running thing is: a live clip, or a selection to export / delete.
   *  Drives the confirm chip's wording and colour. */
  readonly kind: 'capture' | SelectionKind
  /** What pressing the idle button offers (`record-menu.ts`). */
  readonly menu: readonly RecordMenuAction[]
  /** The operator chose one entry of {@link menu}. */
  readonly onMenuAction: (action: RecordMenuAction) => void
  /** `1m20s` of the selected period, for "Save 1m20s" / "Delete 1m20s". */
  readonly spanLabel: string
  /** Something is RUNNING — a capture is being written, or a selection is
   *  armed. Accept/Discard instead of the record dot. */
  readonly active: boolean
  /** `m:ss` of what Accept would keep: the elapsed capture, or the length of
   *  the selected period. Drawn ON the Accept chip, never as a separate label —
   *  the operator must see how much they are about to keep before they press. */
  readonly durationLabel: string
  /** Accept is allowed: long enough to be worth a file, and (for a selection)
   *  not provably empty of footage. */
  readonly canAccept: boolean
  /** A selection that crosses a hole in the footage: the export will be shorter
   *  than the band. Tinted, never silently accepted. Always false for a live
   *  capture — that records the picture that just played, so there is no
   *  coverage question to ask of it. */
  readonly warn: boolean
  /** Accept is in flight — it goes inert, Discard does not. */
  readonly busy: boolean
  readonly onAccept: () => void
  readonly onDiscard: () => void
}

/** The live-capture half: recording the decoded picture, forward from the press. */
export interface LiveCaptureFlow {
  readonly capturing: boolean
  /** Elapsed since the press, `m:ss` — the same formatter the selection uses. */
  readonly elapsedLabel: string
  readonly onStart: () => void
  /** Stop and keep it (the share sheet). */
  readonly onKeep: () => void
  /** Stop and throw it away. */
  readonly onDiscard: () => void
}

/** The export half: anchoring a period of the archive and saving it. */
export interface ExportSelectionFlow {
  /** Which act the ARMED selection is for. */
  readonly kind: SelectionKind
  /** Anchor a period at the epoch the player is showing, for an act. */
  readonly onBegin: (kind: SelectionKind) => void
  /** Create the export. The coverage verdict travels with the range so the
   *  caller can warn about a hole before queueing anything. */
  readonly onSave: (range: ExportSelectionRange, coverage: SelectionCoverage) => void
  readonly onDiscard: () => void
  /** A create is in flight. */
  readonly saving: boolean
}

/** What the screen adds on top of the two flows: the role, and the snapshot. */
export interface RecordExtras {
  /** The hub has CONFIRMED an admin. Unknown is false. */
  readonly isAdmin: boolean
  /** Cut the frame on screen. Absent ⟺ the player cannot hand one over. */
  readonly onSnapshot?: () => void
}

/**
 * Resolve the record button for a mode.
 *
 * `undefined` ⟺ the button has nothing to offer in this mode — the grid wall
 * has no decoded picture of its own and no single camera, and a paused live
 * surface has no decoded picture either (live pause is a poster teardown). An
 * absent binding means an ABSENT control, not a disabled one (the rule every
 * other per-camera control on the bar follows).
 *
 * The menu is `resolveRecordMenu`'s: a recorded mode can never reach
 * `live.onStart`, and the live edge can never reach `selection.onBegin` — the
 * actions are routed here, once, instead of by the button.
 */
export function resolveRecordControl(
  mode: PlaybackMode,
  live: LiveCaptureFlow | undefined,
  selection: ExportSelectionFlow | undefined,
  /** The selection as `export-selection.ts` derived it — the range, its
   *  coverage verdict and its label, from the SAME derivation the band on the
   *  strip is drawn from. */
  view: ExportSelectionView,
  extras: RecordExtras,
): RecordControlBinding | undefined {
  const { onSnapshot } = extras
  if (mode === 'live') {
    const menu = resolveRecordMenu({
      mode,
      isAdmin: extras.isAdmin,
      canSnapshot: onSnapshot !== undefined,
      canSelect: false,
      canRecordLive: live !== undefined,
    })
    if (menu.length === 0) return undefined
    return {
      kind: 'capture',
      menu,
      onMenuAction: (action): void => {
        if (action === 'snapshot') onSnapshot?.()
        else if (action === 'recordLive') live?.onStart()
      },
      active: live?.capturing ?? false,
      durationLabel: live?.elapsedLabel ?? '0:00',
      spanLabel: live?.elapsedLabel ?? '0:00',
      // A capture always has something in it — it is the picture that just
      // played — and there is no coverage question to ask of it.
      canAccept: true,
      warn: false,
      busy: false,
      onAccept: (): void => live?.onKeep(),
      onDiscard: (): void => live?.onDiscard(),
    }
  }
  const menu = resolveRecordMenu({
    mode,
    isAdmin: extras.isAdmin,
    canSnapshot: onSnapshot !== undefined,
    canSelect: selection !== undefined,
    canRecordLive: false,
  })
  if (menu.length === 0) return undefined
  const { range, coverage } = view
  return {
    kind: selection?.kind ?? 'export',
    menu,
    onMenuAction: (action): void => {
      if (action === 'snapshot') onSnapshot?.()
      else if (action === 'selectExport') selection?.onBegin('export')
      else if (action === 'deleteRecording' && extras.isAdmin) selection?.onBegin('delete')
    },
    active: view.armed,
    durationLabel: view.durationLabel,
    spanLabel: view.spanLabel,
    canAccept: view.canSave,
    warn: view.warn,
    busy: selection?.saving ?? false,
    onAccept: (): void => {
      if (range === null) return
      selection?.onSave(range, coverage)
    },
    onDiscard: (): void => selection?.onDiscard(),
  }
}
