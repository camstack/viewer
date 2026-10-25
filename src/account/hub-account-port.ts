/**
 * The REAL {@link AccountSettingsPort}: the hub's `preferences.*` methods
 * (D894) — `get`, `put`, `delete`, `changedSince`, always on the signed-in
 * user's OWN rows (the hub never takes a user id).
 *
 * What it answers is pinned by the in-memory reference
 * (`memory-account-port.ts`) and by `__tests__/hub-account-port.spec.ts`:
 *
 *   get(namespaces)            the rows that exist among them
 *   put(ns, value, base)       `stored` with the new row, or `conflict` with the
 *                              current row — `base: null` is the hub's
 *                              `baseRevision: 0` ("must not exist yet")
 *   changedSince(revisions)    the rows newer than what this device holds
 *
 * Two hub answers have no twin in the port and are folded here:
 *
 *   - a conflict whose `current` is `null` (another device DELETED the row
 *     after this one read it): the edit is re-sent as a create
 *     (`baseRevision: 0`), as the reference port stores over a missing row;
 *   - a row for a namespace this build does not know (a newer viewer wrote
 *     one): dropped, never handed to a store.
 *
 * A hub that cannot serve preferences — an older hub without the router, a
 * credential without `preferences-self`, a hub whose store is not up — throws
 * {@link AccountUnavailableError}; the engine then stays local-only and says
 * why, instead of reporting a sync error every minute.
 *
 * Every row is validated here (Zod, as the hub clients in `src/data/` do): a
 * row's `value` is untrusted until the stores parse it.
 */
import { z } from 'zod'
import type { PreferenceRow } from '@camstack/types'
import { isMissingProcedureError, trpcErrorCode } from '../auth/missing-procedure.js'
import {
  AccountUnavailableError,
  isAccountNamespace,
  type AccountUnavailableReason,
  type AccountNamespace,
  type AccountPutResult,
  type AccountRevisions,
  type AccountRow,
  type AccountSettingsPort,
} from './account-settings-port.js'

/**
 * The procedures this port calls. A documented structural boundary, like
 * `sign-in-methods.ts`: the installed SDK's router type does not carry the
 * hub's core `preferences.*` router, so answers are `unknown` and parsed below.
 */
export interface PreferencesClient {
  readonly preferences: {
    readonly get: { query: (input: { namespaces?: string[] }) => Promise<unknown> }
    readonly put: {
      mutate: (input: {
        namespace: string
        value: Record<string, unknown>
        baseRevision?: number
        deviceId?: string
      }) => Promise<unknown>
    }
    readonly delete: { mutate: (input: { namespace: string }) => Promise<unknown> }
    readonly changedSince: {
      query: (input: { revisionByNamespace: Record<string, number> }) => Promise<unknown>
    }
  }
}

// Mirrors `PreferenceRowSchema` (`@camstack/types`, not in the client entry);
// `satisfies` keeps the two from drifting apart silently.
const RowSchema = z.object({
  namespace: z.string(),
  value: z.record(z.string(), z.unknown()),
  revision: z.number().int().positive(),
  updatedAt: z.number().int(),
  updatedByDevice: z.string().nullable(),
}) satisfies z.ZodType<PreferenceRow>

const GetOutputSchema = z.object({ rows: z.array(z.unknown()) })
const PutOutputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), row: z.unknown() }),
  z.object({ status: z.literal('conflict'), current: z.unknown() }),
])
const DeleteOutputSchema = z.object({ deleted: z.boolean() })
const ChangedSinceOutputSchema = z.object({ rows: z.array(z.unknown()), deleted: z.array(z.string()) })

/** One wire row as the port's row, or `null` for a namespace this build does not hold. */
function toRow(raw: unknown): AccountRow | null {
  const row = RowSchema.parse(raw)
  if (!isAccountNamespace(row.namespace)) return null
  return { namespace: row.namespace, value: row.value, revision: row.revision, updatedAt: row.updatedAt }
}

function toRows(raw: readonly unknown[]): readonly AccountRow[] {
  return raw.map(toRow).filter((r): r is AccountRow => r !== null)
}

function requireRow(raw: unknown, ns: AccountNamespace): AccountRow {
  const row = toRow(raw)
  if (row === null || row.namespace !== ns) throw new Error(`preferences.put answered for another namespace than ${ns}`)
  return row
}

/** The hub's refusals that mean "no preferences here", as opposed to a failed call. */
function unavailableReason(e: unknown): AccountUnavailableReason | null {
  if (isMissingProcedureError(e)) return 'hub'
  const code = trpcErrorCode(e)
  if (code === 'FORBIDDEN') return 'credential'
  if (code === 'PRECONDITION_FAILED') return 'hub'
  return null
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e: unknown) {
    const reason = unavailableReason(e)
    throw reason === null ? e : new AccountUnavailableError(reason, e)
  }
}

export interface HubAccountPort extends AccountSettingsPort {
  /** Remove one namespace on the hub; `false` when it did not exist. */
  delete(namespace: AccountNamespace): Promise<boolean>
}

export interface HubAccountPortDeps {
  /** The live client, or `null` while there is no connection (the call then fails, offline-style). */
  readonly client: () => PreferencesClient | null
  /** This install's stable id, stamped on every write (`updatedByDevice`). */
  readonly deviceId: () => Promise<string>
}

export function createHubAccountPort(deps: HubAccountPortDeps): HubAccountPort {
  const client = (): PreferencesClient => {
    const c = deps.client()
    if (c === null) throw new Error('not connected')
    return c
  }

  const putOnce = async (
    namespace: AccountNamespace,
    value: Readonly<Record<string, unknown>>,
    baseRevision: number,
  ): Promise<z.infer<typeof PutOutputSchema>> => {
    const deviceId = await deps.deviceId()
    const raw = await call(() =>
      client().preferences.put.mutate({ namespace, value: { ...value }, baseRevision, deviceId }),
    )
    return PutOutputSchema.parse(raw)
  }

  return {
    get: async (namespaces) => {
      if (namespaces.length === 0) return []
      const raw = await call(() => client().preferences.get.query({ namespaces: [...namespaces] }))
      return toRows(GetOutputSchema.parse(raw).rows)
    },

    put: async (namespace, value, baseRevision): Promise<AccountPutResult> => {
      let out = await putOnce(namespace, value, baseRevision ?? 0)
      if (out.status === 'conflict' && out.current === null && baseRevision !== null) {
        // The row was deleted under us: write it again as a create.
        out = await putOnce(namespace, value, 0)
      }
      if (out.status === 'saved') return { kind: 'stored', row: requireRow(out.row, namespace) }
      if (out.current === null) throw new Error(`${namespace}: the hub refused the write and holds no row`)
      return { kind: 'conflict', current: requireRow(out.current, namespace) }
    },

    changedSince: async (revisions: AccountRevisions) => {
      const revisionByNamespace: Record<string, number> = {}
      for (const [ns, revision] of Object.entries(revisions)) {
        if (isAccountNamespace(ns) && typeof revision === 'number') revisionByNamespace[ns] = revision
      }
      const raw = await call(() => client().preferences.changedSince.query({ revisionByNamespace }))
      return toRows(ChangedSinceOutputSchema.parse(raw).rows)
    },

    delete: async (namespace) => {
      const raw = await call(() => client().preferences.delete.mutate({ namespace }))
      return DeleteOutputSchema.parse(raw).deleted
    },
  }
}
