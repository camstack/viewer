/**
 * The smallest description of what changed between two JSON values, and its
 * replay on a third — what "re-apply the local change on top of the server
 * row, for the touched fields only" means in `account-settings-sync.ts`.
 *
 * Records are compared key by key, recursively; anything else (arrays,
 * primitives, `null`) is one value, replaced whole. A key removed locally is a
 * `remove` operation, so a deletion survives the merge too.
 */

export type JsonPath = readonly string[]

export type JsonPatchOp =
  | { readonly kind: 'set'; readonly path: JsonPath; readonly value: unknown }
  | { readonly kind: 'remove'; readonly path: JsonPath }

type JsonRecord = Readonly<Record<string, unknown>>

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Structural equality over JSON values (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]))
  }
  if (isJsonRecord(a) && isJsonRecord(b)) {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined)
    const otherKeys = Object.keys(b).filter((k) => b[k] !== undefined)
    return keys.length === otherKeys.length && keys.every((k) => jsonEqual(a[k], b[k]))
  }
  return false
}

/** The operations that turn `base` into `next`. Empty when they are equal. */
export function diffJson(base: unknown, next: unknown, path: JsonPath = []): readonly JsonPatchOp[] {
  if (jsonEqual(base, next)) return []
  if (!isJsonRecord(base) || !isJsonRecord(next)) return [{ kind: 'set', path, value: next }]
  const ops: JsonPatchOp[] = []
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) continue
    ops.push(...diffJson(base[key], next[key], [...path, key]))
  }
  for (const key of Object.keys(base)) {
    if (base[key] !== undefined && next[key] === undefined) ops.push({ kind: 'remove', path: [...path, key] })
  }
  return ops
}

function applyOne(target: unknown, path: JsonPath, op: JsonPatchOp): unknown {
  const [head, ...rest] = path
  if (head === undefined) return op.kind === 'set' ? op.value : undefined
  const record = isJsonRecord(target) ? target : {}
  const child = applyOne(record[head], rest, op)
  const { [head]: _old, ...others } = record
  return child === undefined ? others : { ...others, [head]: child }
}

/** `target` with every operation replayed on it. Never mutates `target`. */
export function applyJsonPatch(target: unknown, ops: readonly JsonPatchOp[]): unknown {
  return ops.reduce<unknown>((acc, op) => applyOne(acc, op.path, op), target)
}
