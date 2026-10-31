/**
 * selection-commit — what pressing the selection's confirm button DOES.
 *
 * The selection (an anchor and a free end) is drawn the same way for two acts:
 * keep it as an export, or delete it from the archive. The act is the
 * selection's KIND, and this module is the one place that turns kind + range
 * into a hub call — so "delete is admin-only" is a property of a function that
 * can be asserted, not a `?:` in a component.
 *
 * The hub refuses `deleteFootprint` for a non-admin anyway (`auth: 'admin'`);
 * refusing here as well is convenience, not the gate — but a viewer that could
 * arm and confirm it would offer a button that always fails, and a destructive
 * one at that.
 */
import type { CreateExportInput } from '../data/use-exports.js'
import {
  EXPORT_SELECTION_LIFE_MS,
  EXPORT_SELECTION_PROFILE,
  type ExportSelectionRange,
} from './export-selection.js'

export type SelectionKind = 'export' | 'delete'

/** The `recordingArchive.deleteFootprint` input for a window. */
export interface DeleteFootprintRequest {
  readonly deviceId: number
  readonly fromMs: number
  readonly toMs: number
}

export type SelectionCommit =
  | { readonly action: 'export'; readonly input: CreateExportInput }
  | { readonly action: 'delete'; readonly request: DeleteFootprintRequest }
  /** A delete asked by someone the hub has not confirmed as an admin. */
  | { readonly action: 'refuse'; readonly reason: 'not-admin' }

/**
 * The exact `createExport` input a timeline selection produces.
 *
 * Pure and exported so the bounds can be asserted without a hub: `fromMs`/
 * `toMs` come from an ALREADY-ordered range (`resolveExportSelection`), and
 * this function does no reordering of its own — one place normalises, and it is
 * not this one.
 */
export function buildExportSelectionInput(
  deviceId: number,
  range: ExportSelectionRange,
): CreateExportInput {
  return {
    deviceId,
    profiles: [EXPORT_SELECTION_PROFILE],
    fromMs: range.fromMs,
    toMs: range.toMs,
    options: {
      includeAudio: true,
      maxLifeMs: EXPORT_SELECTION_LIFE_MS,
      deleteAfterDownload: false,
    },
  }
}

export function planSelectionCommit(
  kind: SelectionKind,
  isAdmin: boolean,
  deviceId: number,
  range: ExportSelectionRange,
): SelectionCommit {
  if (kind === 'export') {
    return { action: 'export', input: buildExportSelectionInput(deviceId, range) }
  }
  if (!isAdmin) return { action: 'refuse', reason: 'not-admin' }
  return { action: 'delete', request: { deviceId, fromMs: range.fromMs, toMs: range.toMs } }
}

/** One camera a scoped selection acts on. */
export interface SelectionTarget {
  readonly deviceId: number
  readonly name: string
}

/** What a selection over N cameras does: one commit per camera, in scope order. */
export type ScopeSelectionPlan =
  | { readonly action: 'export'; readonly commits: readonly ExportCommit[] }
  | { readonly action: 'delete'; readonly commits: readonly DeleteCommit[] }
  | { readonly action: 'refuse'; readonly reason: 'not-admin' | 'no-cameras' }

type ExportCommit = Extract<SelectionCommit, { readonly action: 'export' }>
type DeleteCommit = Extract<SelectionCommit, { readonly action: 'delete' }>

/**
 * The commits a selection produces over a SET of cameras.
 *
 * The hub's export and footprint-delete are per camera, so a range over N
 * cameras is N of the same call — never a new multi-camera procedure. With one
 * target this is exactly {@link planSelectionCommit}'s answer in a list of one,
 * which is what keeps the single-camera selection unchanged. The permission
 * rule is also the same one: a delete is refused for anyone the hub has not
 * confirmed as an admin, before any commit exists.
 */
export function planScopeSelectionCommit(
  kind: SelectionKind,
  isAdmin: boolean,
  targets: readonly SelectionTarget[],
  range: ExportSelectionRange,
): ScopeSelectionPlan {
  if (targets.length === 0) return { action: 'refuse', reason: 'no-cameras' }
  if (kind === 'export') {
    return {
      action: 'export',
      commits: targets.map((target) => ({
        action: 'export' as const,
        input: buildExportSelectionInput(target.deviceId, range),
      })),
    }
  }
  if (!isAdmin) return { action: 'refuse', reason: 'not-admin' }
  return {
    action: 'delete',
    commits: targets.map((target) => ({
      action: 'delete' as const,
      request: { deviceId: target.deviceId, fromMs: range.fromMs, toMs: range.toMs },
    })),
  }
}
