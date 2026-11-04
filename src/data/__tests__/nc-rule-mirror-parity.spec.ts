/**
 * The rule mirrors against the PUBLISHED cap, field for field.
 *
 * `notification-center.ts` hand-copies the hub's rule schemas (this app ships
 * on its own train and must parse what a newer hub serves). Zod STRIPS a key
 * the mirror does not declare, and the editor writes the parsed rule back, so
 * every unmirrored field is a field an edit from the phone deletes — the
 * media policy, the snooze buttons and the throttle granularity were each lost
 * that way before someone noticed. An unknown ENUM member is worse: the whole
 * rule fails `safeParse` and vanishes from the list.
 *
 * So the check is structural and exhaustive rather than a list of remembered
 * fields: both schemas are walked into `path: shape` lines (object keys, enum
 * members, array/record/union structure) and the two sets must be equal. The
 * published `@camstack/types` is what this app resolves at runtime, so a hub
 * field this build lacks turns this red the day the types are bumped.
 */
import { describe, expect, it } from 'vitest'
import {
  NcRuleInputSchema as PublishedRuleInput,
  NcRulePatchSchema as PublishedRulePatch,
  NcRuleSchema as PublishedRule,
} from '@camstack/types'
import { NcRuleInputSchema, NcRulePatchSchema, NcRuleSchema } from '../notification-center.js'

type Obj = Readonly<Record<string, unknown>>

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null
}

/** A Zod 4 schema's `def` — read structurally, so two zod copies compare. */
function defOf(schema: unknown): Obj | undefined {
  if (!isObj(schema)) return undefined
  const internals = schema['_zod']
  if (!isObj(internals)) return undefined
  const def = internals['def']
  return isObj(def) ? def : undefined
}

/** Wrappers whose only structure is the schema they wrap. */
const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional'])

function walk(schema: unknown, path: string, out: string[]): void {
  const def = defOf(schema)
  if (def === undefined) {
    out.push(`${path}: <unknown>`)
    return
  }
  const type = String(def['type'])
  if (WRAPPERS.has(type)) {
    // `optional` vs `default` is not a key difference and both parse the same
    // wire; the wrapper KIND is recorded so a lost `.optional()` still shows.
    walk(def['innerType'], `${path}?`, out)
    return
  }
  switch (type) {
    case 'object': {
      const shape = def['shape']
      if (!isObj(shape)) break
      out.push(`${path}: object`)
      for (const key of Object.keys(shape).sort()) walk(shape[key], `${path}.${key}`, out)
      return
    }
    case 'array':
      walk(def['element'], `${path}[]`, out)
      return
    case 'record':
      walk(def['keyType'], `${path}{key}`, out)
      walk(def['valueType'], `${path}{value}`, out)
      return
    case 'union': {
      const options = def['options']
      if (!Array.isArray(options)) break
      out.push(`${path}: union(${options.length})`)
      options.forEach((option, index) => walk(option, `${path}|${index}`, out))
      return
    }
    case 'enum': {
      const entries = def['entries']
      out.push(`${path}: enum[${isObj(entries) ? Object.keys(entries).sort().join(',') : '?'}]`)
      return
    }
    case 'literal': {
      const values = def['values']
      out.push(`${path}: literal[${Array.isArray(values) ? values.map(String).join(',') : '?'}]`)
      return
    }
    default:
      out.push(`${path}: ${type}`)
      return
  }
  out.push(`${path}: ${type}<malformed>`)
}

function lines(schema: unknown): string[] {
  const out: string[] = []
  walk(schema, '$', out)
  return out
}

/**
 * Lines the viewer carries AHEAD of the published types, by name — and only
 * while they are ahead. A field added to the cap reaches the phone before the
 * `@camstack/types` release that carries it (the mirror must parse what the
 * newer hub serves, or a phone save strips it). Each entry here is checked to
 * be ABSENT from the published types: the day the release lands, this list
 * fails the suite until the entry is removed, so it cannot outlive its reason.
 */
const AHEAD_OF_PUBLISHED: readonly string[] = []

/** Lines one side has and the other lacks — empty both ways is parity. */
function drift(viewer: unknown, published: unknown): { onlyViewer: string[]; onlyHub: string[] } {
  const mine = new Set(lines(viewer))
  const theirs = new Set(lines(published))
  return {
    onlyViewer: [...mine].filter((line) => !theirs.has(line) && !AHEAD_OF_PUBLISHED.includes(line)),
    onlyHub: [...theirs].filter((line) => !mine.has(line)),
  }
}

describe('rule mirrors — every published field, member for member', () => {
  it('the walker actually sees the published shape (not vacuous)', () => {
    const published = lines(PublishedRuleInput)
    expect(published.length).toBeGreaterThan(100)
    expect(published).toContain('$.actions?: object')
    expect(published).toContain('$.confirm?: object')
  })

  it('every AHEAD entry is still ahead — remove it once the types release carries it', () => {
    const published = new Set(lines(PublishedRuleInput))
    const viewer = new Set(lines(NcRuleInputSchema))
    for (const line of AHEAD_OF_PUBLISHED) {
      expect(published.has(line), `${line} is published now — drop it from AHEAD_OF_PUBLISHED`).toBe(false)
      expect(viewer.has(line), `${line} is not in the mirror — the entry is stale`).toBe(true)
    }
  })

  it('NcRuleInputSchema', () => {
    expect(drift(NcRuleInputSchema, PublishedRuleInput)).toEqual({ onlyViewer: [], onlyHub: [] })
  })

  it('NcRuleSchema (persisted)', () => {
    expect(drift(NcRuleSchema, PublishedRule)).toEqual({ onlyViewer: [], onlyHub: [] })
  })

  it('NcRulePatchSchema carries every input key (the hub adds disabledTargetIds, not authored here)', () => {
    const topKeys = (schema: unknown): string[] => {
      const shape = defOf(schema)?.['shape']
      return isObj(shape) ? Object.keys(shape).sort() : []
    }
    const hub = topKeys(PublishedRulePatch).filter((key) => key !== 'disabledTargetIds')
    expect(hub.length).toBeGreaterThan(10)
    expect(topKeys(NcRulePatchSchema)).toEqual(hub)
  })
})
