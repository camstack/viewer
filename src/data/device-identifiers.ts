/**
 * Provider-declared device identifiers, as `deviceManager.listAll` carries
 * them on a row (`identifiers`).
 *
 * The schema is a viewer-LOCAL mirror of `DeviceIdentifiersSchema` in
 * `@dominevo/types` (`device/device-identifiers.ts`): the `/client` entry does
 * not export it. Keep the patterns in step with that file. A payload this
 * schema refuses is shown as no identifiers at all, like the hub admin does.
 */
import { z } from 'zod'

const MAC_PATTERN = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/
/** `<prefix>:<value>` — prefix a lower-case slug, value lower-case and non-blank. */
const PREFIXED_PATTERN = /^[a-z0-9][a-z0-9._-]*:[^\sA-Z]+$/
const MACHINE_UUID_PATTERN = /^[0-9a-f][0-9a-f-]{7,}$/
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function entrySchema<T extends z.ZodType<string>>(value: T) {
  return z
    .object({
      value,
      origin: z.enum(['read', 'derived']),
      readAt: z.number().int().nonnegative(),
    })
    .strict()
}

export const DeviceIdentifiersSchema = z
  .object({
    mac: z.array(entrySchema(z.string().regex(MAC_PATTERN))).min(1).readonly().optional(),
    serial: entrySchema(z.string().regex(PREFIXED_PATTERN)).optional(),
    'machine-uuid': entrySchema(z.string().regex(MACHINE_UUID_PATTERN)).optional(),
    'vendor-uid': entrySchema(z.string().regex(PREFIXED_PATTERN)).optional(),
    hostname: entrySchema(z.string().regex(HOSTNAME_PATTERN)).optional(),
    ip: entrySchema(z.union([z.ipv4(), z.ipv6()])).optional(),
  })
  .strict()
export type DeviceIdentifiers = z.infer<typeof DeviceIdentifiersSchema>

export type DeviceIdentifierKey = keyof DeviceIdentifiers

/** The order the hub admin's device-info card lists them in. */
const IDENTIFIER_KEY_ORDER: readonly DeviceIdentifierKey[] = [
  'mac',
  'serial',
  'vendor-uid',
  'machine-uuid',
  'hostname',
  'ip',
]

export interface IdentifierRow {
  readonly key: DeviceIdentifierKey
  readonly value: string
}

/** The declared identifiers as rows (one per MAC); a payload the schema refuses gives none. */
export function identifierRows(raw: unknown): readonly IdentifierRow[] {
  const parsed = DeviceIdentifiersSchema.safeParse(raw)
  if (!parsed.success) return []
  const ids = parsed.data
  return IDENTIFIER_KEY_ORDER.flatMap((key): IdentifierRow[] => {
    if (key === 'mac') return (ids.mac ?? []).map((e) => ({ key, value: e.value }))
    const entry = ids[key]
    return entry ? [{ key, value: entry.value }] : []
  })
}
