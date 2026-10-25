/**
 * The account-settings PORT — what the viewer needs from wherever an
 * operator's account settings are kept (the hub's `preferences.*` methods in
 * production, an in-memory map in specs).
 *
 * Settings live at two levels (operator decision 2026-10-21): DEVICE (never
 * leaves this install) and ACCOUNT (per user, per hub, stored on the hub and
 * synced to every device that signs in as that user). Each account setting is
 * in exactly ONE of three namespaces; a namespace's document is a record of
 * SECTIONS — one per viewer store that contributes — whose values are the
 * store's own persisted shape.
 *
 * Every write carries the revision it was based on. A stale base is answered
 * with the row as it is now, never with an error, so the caller can merge and
 * retry (`account-settings-sync.ts`).
 */

/** The three account namespaces. Each account setting is in exactly one. */
export const ACCOUNT_NAMESPACES = ['viewer.app', 'viewer.cameras', 'viewer.grids'] as const

export type AccountNamespace = (typeof ACCOUNT_NAMESPACES)[number]

/** A namespace document: section name → that section's JSON value. */
export type AccountDocument = Readonly<Record<string, unknown>>

/** One stored namespace. `revision` grows on every accepted write. */
export interface AccountRow {
  readonly namespace: AccountNamespace
  readonly value: AccountDocument
  readonly revision: number
  /** Epoch ms of the accepted write. */
  readonly updatedAt: number
}

/** The answer to a write: stored, or the row a stale base lost to. */
export type AccountPutResult =
  | { readonly kind: 'stored'; readonly row: AccountRow }
  | { readonly kind: 'conflict'; readonly current: AccountRow }

/** The last revision this device holds, per namespace. */
export type AccountRevisions = Readonly<Partial<Record<AccountNamespace, number>>>

export interface AccountSettingsPort {
  /** The rows that exist among `namespaces` (an absent row is simply missing). */
  get(namespaces: readonly AccountNamespace[]): Promise<readonly AccountRow[]>
  /**
   * Write a whole namespace document. `baseRevision` is the revision the value
   * was built on; `null` means "this device has never seen a row" and is
   * accepted only when none exists.
   */
  put(namespace: AccountNamespace, value: AccountDocument, baseRevision: number | null): Promise<AccountPutResult>
  /** The rows whose revision is newer than the one given for them. */
  changedSince(revisions: AccountRevisions): Promise<readonly AccountRow[]>
}

export function isAccountNamespace(value: unknown): value is AccountNamespace {
  return typeof value === 'string' && ACCOUNT_NAMESPACES.some((ns) => ns === value)
}

/** Why the hub cannot hold this account's settings. */
export type AccountUnavailableReason = 'hub' | 'credential'

/** Thrown by the port when the hub cannot serve preferences at all. */
export class AccountUnavailableError extends Error {
  readonly reason: AccountUnavailableReason
  constructor(reason: AccountUnavailableReason, cause: unknown) {
    super(reason === 'hub' ? 'This hub does not keep account settings' : 'This sign-in cannot reach account settings')
    this.name = 'AccountUnavailableError'
    this.reason = reason
    this.cause = cause
  }
}

export function isAccountUnavailableError(e: unknown): e is AccountUnavailableError {
  return e instanceof AccountUnavailableError
}
