/**
 * highlight-border — the border has no switch of its own: it is on when any
 * trigger (motion, audio, detection) is on (planning#749).
 *
 * The overlay document used to carry a master `highlightBorder` flag next to
 * the per-camera triggers; the two could disagree (the border "enabled" with
 * every trigger off, or the triggers set and the border off, which is the
 * "my triggers do nothing" report). Now the triggers are the only state.
 *
 * ## Migrating a master-off document
 *
 * A stored `highlightBorder: false` meant "no border anywhere". The parse turns
 * it into `legacyMasterOff`; {@link settleMasterOff} then says what to write:
 * every trigger of every camera that stored one goes off, and the document
 * flips to `highlightDefaultOff`, so a camera with NO stored triggers starts
 * all-off too (instead of the factory motion default). A master-on document
 * keeps its triggers untouched.
 *
 * Pure module — no React.
 */
import type { GridHighlightSettings } from '../../../store/grid-store.js'
import { withHighlightDefaults } from '../../../store/grid-store.js'
import type { OverlayConfig } from './overlay-config.js'

/** The patch that turns every border trigger off (levels and holds kept). */
export const ALL_TRIGGERS_OFF: Pick<GridHighlightSettings, 'motion' | 'audio' | 'detection'> = {
  motion: false,
  audio: 'off',
  detection: false,
}

/** The border draws when any trigger is on. */
export function highlightBorderEnabled(
  h: Pick<GridHighlightSettings, 'motion' | 'audio' | 'detection'>,
): boolean {
  return h.motion || h.audio !== 'off' || h.detection
}

/** A camera's effective triggers: what it stored, else the defaults — or
 *  all-off for a document migrated from a master-off one. */
export function resolveTriggers(
  stored: Partial<GridHighlightSettings> | undefined,
  config: Pick<OverlayConfig, 'highlightDefaultOff'>,
): GridHighlightSettings {
  if (stored !== undefined) return withHighlightDefaults(stored)
  return withHighlightDefaults(config.highlightDefaultOff ? ALL_TRIGGERS_OFF : undefined)
}

/** What a pending master-off migration writes, or null when there is none. */
export interface MasterOffSettlement {
  /** The document to store: the one-shot flag consumed, the permanent one set. */
  readonly overlay: OverlayConfig
  /** Every camera that stored triggers gets this patch. */
  readonly triggerPatch: typeof ALL_TRIGGERS_OFF
}

export function settleMasterOff(config: OverlayConfig): MasterOffSettlement | null {
  if (!config.legacyMasterOff) return null
  return {
    overlay: { ...config, legacyMasterOff: false, highlightDefaultOff: true },
    triggerPatch: ALL_TRIGGERS_OFF,
  }
}

/** The pieces of a camera's stored prefs the migration touches. */
export type StoredHighlights = Readonly<Record<number, Partial<GridHighlightSettings> | undefined>>

export interface MasterOffMigration {
  readonly overlay: OverlayConfig
  /** The new triggers of every camera that stored some (others are untouched). */
  readonly highlights: Readonly<Record<number, GridHighlightSettings>>
}

/**
 * The whole master-off migration as one pure step: every stored camera's
 * triggers go off (levels, holds, classes and any other field are kept), and
 * the document trades its one-shot flag for the permanent default. `null` when
 * there is nothing to do — so a second run, and a master-on document, are
 * no-ops.
 */
export function migrateMasterOff(
  config: OverlayConfig,
  stored: StoredHighlights,
): MasterOffMigration | null {
  const settled = settleMasterOff(config)
  if (settled === null) return null
  const highlights: Record<number, GridHighlightSettings> = {}
  for (const [id, h] of Object.entries(stored)) {
    if (h === undefined) continue
    highlights[Number(id)] = { ...withHighlightDefaults(h), ...settled.triggerPatch }
  }
  return { overlay: settled.overlay, highlights }
}
