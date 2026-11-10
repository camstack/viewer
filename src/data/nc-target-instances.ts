/**
 * nc-target-instances — the caller's own notification targets, through the hub's
 * `integration-instances` door pinned to the `notifiers` addon.
 *
 * A user's own target IS an integration instance of `notifiers`; the door is
 * caller-scoped, so the hub injects the caller and the provider keeps a user to
 * their own rows. This module only maps instance rows to the {@link Target} the
 * screens read, and back. The client never sends a caller. The owner key
 * (`ownerUserId`) is stamped by the hub on create from the session; it is still
 * sent in `values` so a hub that does not stamp keeps ownership working.
 *
 * `NcTargetInstanceSchema` mirrors the published `IntegrationInstanceSchema`
 * (`@camstack/types`), reduced to the fields a target needs.
 */
import { z } from 'zod'
import type { Target } from './notification-center.js'

/** The record key the hub stamps with the owner's user id (`TARGET_OWNER_KEY`). */
export const NC_TARGET_OWNER_KEY = 'ownerUserId'
const NOTIFIERS_ADDON = 'notifiers'

export const NcTargetInstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  enabled: z.boolean().optional(),
  formValues: z.record(z.string(), z.unknown()),
})
export type NcTargetInstance = z.infer<typeof NcTargetInstanceSchema>

const InstanceListSchema = z.array(NcTargetInstanceSchema)
const NullableInstanceSchema = NcTargetInstanceSchema.nullable()
const CreatedSchema = z.object({ id: z.string() })
const NO_PROCEDURE = /not.?found|no such procedure|unavailable/i
const TestResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
})

/** The `integrationInstances` procedures this module calls. */
export type NcInstanceMethod =
  | 'listInstances'
  | 'getInstance'
  | 'createInstance'
  | 'updateInstance'
  | 'setInstanceEnabled'
  | 'deleteInstance'
  | 'testInstance'

export interface NcInstancesDeps {
  /** One `integrationInstances.<method>` call; the input already carries `addonId`. */
  readonly integrationInstances: (args: { method: NcInstanceMethod; input: unknown }) => Promise<unknown>
  /** The signed-in user's id; `undefined` when the hub did not answer. */
  readonly sessionUserId: () => Promise<string | undefined>
}

/** An instance row as the screens' {@link Target}. */
export function instanceToTarget(row: NcTargetInstance): Target {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    addonId: NOTIFIERS_ADDON,
    enabled: row.enabled !== false,
    config: { ...row.formValues },
  }
}

function ownerOf(row: NcTargetInstance): unknown {
  return row.formValues[NC_TARGET_OWNER_KEY]
}

/** Own rows only. Without a known user, the hub's `mine` scoping stands and a row must at least carry an owner. */
export function ownRows(rows: readonly NcTargetInstance[], userId: string | undefined): NcTargetInstance[] {
  return rows.filter((row) => {
    const owner = ownerOf(row)
    return userId === undefined ? typeof owner === 'string' && owner.length > 0 : owner === userId
  })
}

export interface NcTargetsClient {
  readonly listTargets: () => Promise<{ targets: Target[] }>
  readonly upsertTarget: (target: Target) => Promise<{ target: Target }>
  readonly deleteTarget: (targetId: string) => Promise<{ success: true }>
  readonly setTargetEnabled: (targetId: string, enabled: boolean) => Promise<{ success: true }>
  readonly testTarget: (targetId: string) => Promise<{ success: boolean; error?: string }>
}

export function makeNcTargetsClient(deps: NcInstancesDeps): NcTargetsClient {
  const call = <T>(method: NcInstanceMethod, input: Record<string, unknown>, out: z.ZodType<T>): Promise<T> =>
    deps
      .integrationInstances({
        method,
        input: { addonId: NOTIFIERS_ADDON, ...input },
      })
      .then((r) => out.parse(r))

  const requireUser = async (): Promise<string> => {
    const id = await deps.sessionUserId()
    if (id === undefined || id.length === 0) throw new Error('authenticated user required')
    return id
  }
  const getOwn = async (id: string, userId: string): Promise<NcTargetInstance | null> => {
    const row = await call('getInstance', { id }, NullableInstanceSchema)
    return row !== null && ownerOf(row) === userId ? row : null
  }
  const requireOwn = async (id: string, userId: string): Promise<NcTargetInstance> => {
    const row = await getOwn(id, userId)
    if (row === null) throw new Error(`target not owned: ${id}`)
    return row
  }

  return {
    listTargets: async () => {
      const [rows, userId] = await Promise.all([
        call('listInstances', { mine: true }, InstanceListSchema),
        deps.sessionUserId(),
      ])
      return { targets: ownRows(rows, userId).map(instanceToTarget) }
    },

    upsertTarget: async (target) => {
      const userId = await requireUser()
      const values = { ...target.config, [NC_TARGET_OWNER_KEY]: userId }
      const existing = target.id.length > 0 ? await getOwn(target.id, userId) : null
      let id: string
      if (existing !== null) {
        id = existing.id
        await call('updateInstance', { id, name: target.name, values }, z.unknown())
      } else {
        id = (await call('createInstance', { name: target.name, kind: target.kind, values }, CreatedSchema))
          .id
      }
      if (target.enabled !== (existing?.enabled !== false)) {
        await call('setInstanceEnabled', { id, enabled: target.enabled }, z.unknown())
      }
      const saved = await call('getInstance', { id }, NullableInstanceSchema)
      if (saved === null) throw new Error(`target not owned: ${id}`)
      return { target: instanceToTarget(saved) }
    },

    deleteTarget: async (targetId) => {
      await requireOwn(targetId, await requireUser())
      await call('deleteInstance', { id: targetId }, z.unknown())
      return { success: true }
    },

    setTargetEnabled: async (targetId, enabled) => {
      await requireOwn(targetId, await requireUser())
      await call('setInstanceEnabled', { id: targetId, enabled }, z.unknown())
      return { success: true }
    },

    testTarget: async (targetId) => {
      await requireOwn(targetId, await requireUser())
      let result: z.infer<typeof TestResultSchema>
      try {
        result = await call('testInstance', { id: targetId, values: {} }, TestResultSchema)
      } catch (e) {
        // `testInstance` is an optional method: a provider without one has no such procedure.
        if (e instanceof Error && NO_PROCEDURE.test(e.message)) {
          return { success: false, error: 'This kind cannot be tested' }
        }
        throw e
      }
      return {
        success: result.success,
        ...(result.error !== undefined ? { error: result.error } : {}),
      }
    },
  }
}
