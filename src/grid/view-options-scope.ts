/**
 * view-options-scope — the GROUPS of the per-camera view-options surface, and
 * who configures each row in each context.
 *
 * ## Two questions, deliberately separated
 *
 * 1. WHAT is this row about? → its {@link ViewOptionGroup}. The groups are the
 *    same everywhere: the same header, in the same order, in the single-camera
 *    menu, in a grid cell's menu and in the grid bar's menu. A row keeps its
 *    place, so an operator who learned where the audio meter lives finds it in
 *    the same group on the wall.
 * 2. WHERE is it configured HERE? → {@link GRID_ROW_OWNER}, read through
 *    {@link isRowVisible}. In a grid, some rows are ONE value for the whole wall
 *    (the bar owns them) and the rest stay per-camera (the cell's menu owns
 *    them, and the TILE draws them).
 *
 * ## The history, so it is not repeated
 *
 * The bar and the cell menu once offered the same four rows against two
 * different documents — the grid's and the camera's — and whichever the operator
 * touched last was the one that looked broken. The first fix (2026-08-13) split
 * them with this module but ALSO hid five rows under an `unpainted` class,
 * because no tile drew them: the audio meter, the occupancy chips, the stream
 * stats, the motion regions and the motion badge.
 *
 * Hiding was the wrong half of the answer. The rows are per-camera and the
 * operator wants them per-camera on the wall too, so the tiles now DRAW them
 * (native wall and hosted embed alike) and the class is gone: every row is
 * either `bar` or `cell`, and a `cell` row is one a tile paints. If a future row
 * cannot be painted where it is offered, the fix is to paint it — not to add
 * back a bucket for controls that do nothing.
 *
 * Pure — no React, no store (this repo has no renderer; see `docs/roadmap.md`).
 */
import {
  OVERLAY_LAYERS,
  type OverlayLayer,
} from '../components/camera/overlay/overlay-config.js'


/** Every row the per-camera view-options surface can draw. */
export const VIEW_OPTION_ROWS = [
  /** The DETECTOR's layers of the box overlay: objects, discarded, stationary.
   *  One row because they answer one question ("how much of what the detector
   *  produced do I want on the picture?") and one owner because a wall where
   *  every tile drew a different amount is a wall nobody can read. */
  'detectionLayers',
  /** The MOTION layer of the same control — changed-pixel regions. Its own row
   *  only because its OWNER differs on the wall (see `GRID_ROW_OWNER`); it is
   *  rendered as chips in the same control, never as a second selector. */
  'motionLayer',
  /** The highlight border switch AND its trigger rows — one section. */
  'highlightBorder',
  /** Audio meter placement. */
  'audioMeter',
  /** Occupancy chips placement. */
  'occupancy',
  /** WebRTC/playback health read-out. */
  'stats',
  /** How many people watch this camera live right now. */
  'liveViewers',
  /** Phone / tablet battery pill (global — one device, not per camera). */
  'deviceInfo',
  /** How timeline cluster cards label their kinds (icon vs text). */
  'clusterLabel',
  /** WHICH of this camera's clip sources the clips list reads — its own
   *  recordings, or the camera's onboard storage. One at a time, per camera. */
  'clipSource',
  /** WHICH of this camera's RECORDING sources the timeline bar is painted
   *  from — ours, or the camera's own. Separate axis from `clipSource`: a
   *  camera whose clips come from the card may still be recorded by us. */
  'recordingSource',
  /** The pinned sensor readouts — this camera's live fields, or a linked
   *  device's. The open-ended, genuinely per-camera set. */
  'readouts',
  /** The per-camera function switches (D62). */
  'switches',
  /** The storage / event-store entries. */
  'management',
] as const

export type ViewOptionRow = (typeof VIEW_OPTION_ROWS)[number]

/**
 * The logical groups, in display order. Identical in every context — that is
 * the point: the context changes WHERE a row is edited, never what it is or
 * which heading it sits under.
 */
export const VIEW_OPTION_GROUPS = [
  /** Everything the analysis pipeline puts on the picture: boxes, motion, the
   *  highlight border. */
  'detection',
  /** Live read-outs of the stream itself: audio level, occupancy, stats. */
  'liveIndicators',
  /** Device values pinned to a corner — this camera's or a linked device's. */
  'sensors',
  /** Timeline chrome (cluster card labels). */
  'timeline',
  /** The per-camera function switches (D62). */
  'functions',
  /** Storage and event-store entries. */
  'management',
] as const

export type ViewOptionGroup = (typeof VIEW_OPTION_GROUPS)[number]

/** Which group each row belongs to. Total by construction. */
export const ROW_GROUP = {
  detectionLayers: 'detection',
  motionLayer: 'detection',
  highlightBorder: 'detection',
  audioMeter: 'liveIndicators',
  occupancy: 'liveIndicators',
  stats: 'liveIndicators',
  liveViewers: 'liveIndicators',
  deviceInfo: 'liveIndicators',
  clusterLabel: 'timeline',
  clipSource: 'timeline',
  recordingSource: 'timeline',
  readouts: 'sensors',
  switches: 'functions',
  management: 'management',
} as const satisfies Readonly<Record<ViewOptionRow, ViewOptionGroup>>

/**
 * The i18n key of each group's header, or `null` when the group's own component
 * already draws one (the switch group titles itself — a second header above it
 * would be the same words twice).
 */
export const GROUP_HEADER_KEY = {
  detection: 'v2.viewOptions.groupDetection',
  liveIndicators: 'v2.overlay.liveSection',
  sensors: 'v2.overlay.readoutsSection',
  timeline: 'v2.cameraMenu.timelineSection',
  functions: null,
  management: 'v2.cameraMenu.managementTitle',
} as const satisfies Readonly<Record<ViewOptionGroup, string | null>>

/** The rows of one group, in `VIEW_OPTION_ROWS` order. */
export function rowsInGroup(group: ViewOptionGroup): readonly ViewOptionRow[] {
  return VIEW_OPTION_ROWS.filter((row) => ROW_GROUP[row] === group)
}

/** Where the surface is mounted. `'single'` is the camera player's timeline
 *  panel (every row is per-camera there); `'grid-cell'` is the card over the
 *  wall, where the bar owns part of the list. */
export type ViewOptionsContext = 'single' | 'grid-cell'

/**
 * Who answers for a row when the surface is hosted by a grid cell.
 *
 *   • `bar`  — ONE value for the whole wall, edited in the control bar's menu.
 *   • `cell` — per camera, edited here, and PAINTED by the tile.
 */
export type GridRowOwner = 'cell' | 'bar'

export const GRID_ROW_OWNER = {
  // One set for the wall: a grid where every tile could draw a different amount
  // of detector output is a wall nobody can read at a glance.
  detectionLayers: 'bar',
  // Per camera: only some cameras are worth watching the raw motion of, and the
  // tile ALREADY draws the regions for the ones that are, from that camera's own
  // document. The bar has no write path to N camera documents, so promoting this
  // to the wall would mean either inventing one (the "one picture, two
  // documents" bug this module exists to end) or silently dropping a capability
  // that ships today. Compactness is bought elsewhere: the panel renders the
  // visible layers as ONE chip row whichever rows they came from.
  motionLayer: 'cell',
  // One border policy for the wall — the bar owns the master switch AND the
  // triggers, because "which camera just lit up" only means something if every
  // tile lights up for the same reason.
  highlightBorder: 'bar',
  // The three live indicators: per camera, drawn by the tile.
  audioMeter: 'cell',
  occupancy: 'cell',
  stats: 'cell',
  liveViewers: 'cell',
  // Phone battery is ONE value for the whole wall (and the single player).
  deviceInfo: 'bar',
  // The grid timeline is ONE band for every camera on the wall, so its card
  // labels are a wall-wide choice.
  clusterLabel: 'bar',
  // …and the clip source is NOT the bar's, for the mirror-image reason: it is
  // per camera by the operator's own rule ("come provider di quella camera"),
  // and a wall-wide pick would point two dozen cameras at a source one of them
  // has.
  clipSource: 'cell',
  // Per camera for the same reason the clip source is: a wall-wide pick
  // would point two dozen cameras at a source one of them has.
  recordingSource: 'cell',
  readouts: 'cell',
  switches: 'cell',
  management: 'cell',
} as const satisfies Readonly<Record<ViewOptionRow, GridRowOwner>>

/** The rows the GRID BAR is responsible for drawing — derived from the record
 *  above, never listed a second time. `GridMenuPanel` keys a total map by this
 *  union, so a row promoted to `bar` breaks the build until the bar has it. */
export type GridBarRow = {
  [K in ViewOptionRow]: (typeof GRID_ROW_OWNER)[K] extends 'bar' ? K : never
}[ViewOptionRow]

export const GRID_BAR_ROWS: readonly GridBarRow[] = VIEW_OPTION_ROWS.filter(
  (row): row is GridBarRow => GRID_ROW_OWNER[row] === 'bar',
)

/** Should the per-camera surface draw this row in this context? The
 *  single-camera menu is complete; a grid cell drops what the bar owns. */
export function isRowVisible(row: ViewOptionRow, context: ViewOptionsContext): boolean {
  return context === 'single' || GRID_ROW_OWNER[row] === 'cell'
}

/** The rows this context hides — the inverse of {@link isRowVisible}, for tests
 *  and for anything that wants to say WHY a menu is shorter here. */
export function hiddenRows(context: ViewOptionsContext): readonly ViewOptionRow[] {
  return VIEW_OPTION_ROWS.filter((row) => !isRowVisible(row, context))
}

/** Does this group still have a row to draw in this context? A header with no
 *  rows under it reads as a menu that failed to load. */
export function isGroupVisible(group: ViewOptionGroup, context: ViewOptionsContext): boolean {
  return rowsInGroup(group).some((row) => isRowVisible(row, context))
}

/** The groups the GRID BAR draws, in display order — the bar wears the same
 *  headers as the cell menu, so a row that moved did not change what it is. */
export const GRID_BAR_GROUPS: readonly ViewOptionGroup[] = VIEW_OPTION_GROUPS.filter((group) =>
  rowsInGroup(group).some((row) => GRID_ROW_OWNER[row] === 'bar'),
)

/** The bar's rows within one group, in display order. */
export function barRowsInGroup(group: ViewOptionGroup): readonly GridBarRow[] {
  return GRID_BAR_ROWS.filter((row) => ROW_GROUP[row] === group)
}

// ── The box overlay's layers, mapped onto the rows above ─────────────────────

/**
 * Which ROW owns each {@link OverlayLayer}.
 *
 * The operator asked for ONE multi-selector offering motion / objects /
 * discarded / stationary, and that is what every surface renders. But "one
 * control" is a rendering decision and "one owner" is a persistence decision,
 * and they are not the same decision: on the wall the detector layers are the
 * grid's and the motion layer is still each camera's. Splitting the rows here
 * lets the panel ask {@link visibleLayers} for its chips and stay honest about
 * which document each chip writes.
 */
export const LAYER_ROW = {
  motion: 'motionLayer',
  objects: 'detectionLayers',
  discarded: 'detectionLayers',
  stationary: 'detectionLayers',
} as const satisfies Readonly<Record<OverlayLayer, ViewOptionRow>>

/** The layers the PER-CAMERA surface offers in this context, in display order:
 *  all four in the single view, motion alone in a grid cell. */
export function visibleLayers(context: ViewOptionsContext): readonly OverlayLayer[] {
  return OVERLAY_LAYERS.filter((layer) => isRowVisible(LAYER_ROW[layer], context))
}

/** The layers the GRID BAR offers — derived from the owner record, never listed
 *  a second time. */
export const BAR_LAYERS: readonly OverlayLayer[] = OVERLAY_LAYERS.filter(
  (layer) => GRID_ROW_OWNER[LAYER_ROW[layer]] === 'bar',
)
