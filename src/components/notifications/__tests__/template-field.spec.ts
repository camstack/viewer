/**
 * template-field — pure helpers behind the placeholder picker (Task 5, Plan
 * C). Ported from the admin's `template-field.helpers.ts`
 * (`packages/addon-admin-ui/src/components/notifications/__tests__/template-field.helpers.spec.ts`),
 * same behaviours: insertion at a `{start,end}` selection, the dynamic
 * `count_<class>` cursor rule, the renderer's own `\{\{\s*(\w+)\s*\}\}`
 * grammar, the caption-field fixed allow-list, and the
 * kinds/deliveries/systemEventKinds filtering axes.
 *
 * The published `@camstack/types` (1.2.250) exports `NC_TEMPLATE_VARS` and
 * `templateVarsFor`, so the parity sweep below runs HERE too, against the real
 * catalog and the real function — the same arbiter the admin's spec uses.
 *
 * Beside it runs a second, independently-written oracle
 * (`expectedNames` below) over a small hand-authored descriptor set that
 * touches every axis `varsForContext` branches on: the caption
 * (`previewText`/`captionText`) fixed allow-list and its dynamic-descriptor
 * exclusion, the `fields` scope, the kinds/deliveries "an axis the CONTEXT
 * leaves unstated is not a filter" rule, `systemEventKinds` gated ONLY when
 * `ctx.kind === 'system'`, and the `sound`/`sensor` groups. The oracle is
 * written from the stated rules, not copied from the implementation, so a
 * regression in either the rule statement or the port shows up as a mismatch.
 */
import { describe, expect, it } from 'vitest'
import { NC_TEMPLATE_VARS, systemEventKindsOfFamily } from '@camstack/types/client'
import { templateVarsFor } from '@camstack/types'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  NcDeliverySchema,
  NcSystemEventDeliveryModeSchema,
  NcRuleKindSchema,
  NcTemplateFamilySchema,
  NcTemplateFieldSchema,
  NcTemplateVarDescriptorSchema,
  type NcSystemEventKind,
  type NcTemplateVarContext,
  type NcTemplateVarDescriptor,
} from '../../../data/notification-center.js'
import {
  groupTemplateVars,
  insertPlaceholder,
  placeholderToken,
  TEMPLATE_GROUP_ORDER,
  templatePlaceholders,
  templateVarLabel,
  unknownPlaceholders,
  varsForContext,
} from '../template-field.js'

const v = (
  over: Partial<NcTemplateVarDescriptor> & Pick<NcTemplateVarDescriptor, 'name'>,
): NcTemplateVarDescriptor => ({
  label: over.name,
  example: 'x',
  group: 'subject',
  families: ['rule'],
  ...over,
})

describe('insertPlaceholder', () => {
  it('inserts at a collapsed cursor and puts the cursor after the token', () => {
    expect(insertPlaceholder('ab', { start: 1, end: 1 }, '{{camera}}')).toEqual({
      value: 'a{{camera}}b',
      cursor: 11,
    })
  })
  it('replaces a selection', () => {
    expect(insertPlaceholder('hello world', { start: 6, end: 11 }, '{{rule}}')).toEqual({
      value: 'hello {{rule}}',
      cursor: 14,
    })
  })
  it('clamps a stale selection past the end to an append', () => {
    expect(insertPlaceholder('ab', { start: 9, end: 9 }, '{{x}}')).toEqual({
      value: 'ab{{x}}',
      cursor: 7,
    })
  })
})

describe('placeholderToken', () => {
  it('a plain variable is the whole token, cursor after it', () => {
    expect(placeholderToken(v({ name: 'camera' }))).toEqual({
      text: '{{camera}}',
      cursorOffset: 10,
    })
  })
  it('a dynamic prefix leaves the cursor INSIDE, before the braces close', () => {
    expect(
      placeholderToken(v({ name: 'count_', dynamic: { prefix: 'count_', from: 'classes' } })),
    ).toEqual({
      text: '{{count_}}',
      cursorOffset: 8,
    })
  })
})

describe('unknownPlaceholders', () => {
  const known = [
    v({ name: 'camera' }),
    v({ name: 'count_', dynamic: { prefix: 'count_', from: 'classes' } }),
  ]
  it('uses the renderer grammar, spaces included', () => {
    expect(templatePlaceholders('{{ camera }} {{a.b}} {{rule}}')).toEqual(['camera', 'rule'])
  })
  it('names what the hub would print as empty, once each', () => {
    expect(unknownPlaceholders('{{camera}} {{tiles}} {{tiles}} {{count_person}}', known)).toEqual([
      'tiles',
    ])
  })
  it('a bare dynamic prefix is unknown (it needs a class)', () => {
    expect(unknownPlaceholders('{{count_}}', known)).toEqual(['count_'])
  })
})

describe('varsForContext', () => {
  const vars = [
    v({ name: 'camera', families: ['rule', 'timelapse'] }),
    v({ name: 'ai', families: ['rule', 'summary'], fields: ['body'] }),
    v({ name: 'count', families: ['rule'], kinds: ['occupancy'] }),
    v({
      name: 'percentage',
      families: ['rule'],
      kinds: ['system'],
      systemEventKinds: ['device-battery-low'],
    }),
  ]
  it('filters by family, field, kind and system-event kind', () => {
    const names = (ctx: Parameters<typeof varsForContext>[1]) =>
      varsForContext(vars, ctx).map((d) => d.name)
    expect(names({ family: 'rule', field: 'title', kind: 'detection' })).toEqual(['camera'])
    expect(names({ family: 'rule', field: 'body', kind: 'detection' })).toEqual(['camera', 'ai'])
    expect(names({ family: 'rule', field: 'title', kind: 'occupancy' })).toEqual([
      'camera',
      'count',
    ])
    expect(
      names({
        family: 'rule',
        field: 'title',
        kind: 'system',
        systemEventKinds: ['device-battery-low'],
      }),
    ).toEqual(['camera', 'percentage'])
    expect(
      names({
        family: 'rule',
        field: 'title',
        kind: 'system',
        systemEventKinds: ['addon-update-available'],
      }),
    ).toEqual(['camera'])
  })
})

describe('varsForContext against an independent oracle, exhaustively over a hand-authored set', () => {
  // A small catalog that exercises every axis the function branches on:
  //  - `camera` / `rule` / `from` / `to`: plain, no restriction beyond family —
  //    `rule`/`from`/`to` are also in BOTH caption allow-lists, `camera` in
  //    only `previewText`'s.
  //  - `ai`: `fields: ['body']` — never reachable from `title`, and never from
  //    a caption field (not in the fixed allow-list even though its family
  //    matches).
  //  - `count_`: `dynamic` — reachable everywhere by family/field/kind, but
  //    EXCLUDED from both caption fields regardless (caption branch drops
  //    every dynamic descriptor outright).
  //  - `zoneCount`: `kinds: ['occupancy']` — the "undefined axis passes" rule:
  //    absent when `ctx.kind === 'occupancy'`... no wait, present only then,
  //    but ALSO present when `ctx.kind` is undefined.
  //  - `immediateOnly`: `deliveries: ['immediate']` — same undefined-passes
  //    shape on the delivery axis.
  //  - `batteryPct`: `kinds: ['system']`, `systemEventKinds: ['device-battery-low']`,
  //    group `sensor` — systemEventKinds gates ONLY when `ctx.kind === 'system'`
  //    literally; when `ctx.kind` is undefined the `kinds` axis already passes
  //    it through and `systemEventKinds` is never consulted.
  //  - `dogBark`: `families: ['rule']`, group `sound`, `deliveries: ['immediate']`.
  const camera = v({ name: 'camera', families: ['rule', 'timelapse', 'summary'], group: 'subject' })
  const rule = v({ name: 'rule', families: ['rule', 'summary'], group: 'rule' })
  const from = v({ name: 'from', families: ['rule', 'summary'], group: 'time' })
  const to = v({ name: 'to', families: ['rule', 'summary'], group: 'time' })
  const ai = v({ name: 'ai', families: ['rule', 'summary'], fields: ['body'], group: 'ai' })
  const dynamicCount = v({
    name: 'count_',
    families: ['rule'],
    group: 'occupancy',
    dynamic: { prefix: 'count_', from: 'classes' },
  })
  const zoneCount = v({ name: 'zoneCount', families: ['rule'], kinds: ['occupancy'], group: 'occupancy' })
  const immediateOnly = v({
    name: 'immediateOnly',
    families: ['rule'],
    deliveries: ['immediate'],
    group: 'sound',
  })
  const batteryPct = v({
    name: 'batteryPct',
    families: ['rule'],
    kinds: ['system'],
    systemEventKinds: ['device-battery-low'],
    group: 'sensor',
  })
  const dogBark = v({
    name: 'dogBark',
    families: ['rule'],
    deliveries: ['immediate'],
    group: 'sound',
  })
  const catalog: readonly NcTemplateVarDescriptor[] = [
    camera,
    rule,
    from,
    to,
    ai,
    dynamicCount,
    zoneCount,
    immediateOnly,
    batteryPct,
    dogBark,
  ]

  const CAPTION_VARS: Readonly<Record<'previewText' | 'captionText', readonly string[]>> = {
    previewText: ['camera', 'rule', 'from', 'to'],
    captionText: ['rule', 'from', 'to'],
  }

  /** Independent oracle — states the rules fresh, does not import the helper
   *  under test, so a mismatch can as easily indict the oracle's own reading
   *  of the rule as the port; every mismatch found while writing this was
   *  chased to ground before being accepted as a passing case. */
  function expectedNames(
    vars: readonly NcTemplateVarDescriptor[],
    ctx: NcTemplateVarContext,
  ): string[] {
    return vars
      .filter((d) => d.families.includes(ctx.family))
      .filter((d) => {
        if (ctx.field === 'previewText' || ctx.field === 'captionText') {
          return CAPTION_VARS[ctx.field].includes(d.name) && !d.dynamic
        }
        if (d.fields && !d.fields.includes(ctx.field)) return false
        // D637: a system rule is one of three families, or `mixed`. A SERVED
        // descriptor names the frozen pre-D637 `system`, which covers them all.
        const kind = ctx.kind
        const systemRule =
          kind === 'device-events' || kind === 'system' || kind === 'alarm' || kind === 'mixed'
        if (
          d.kinds &&
          kind !== undefined &&
          !d.kinds.some((k) => k === kind) &&
          !(systemRule && d.kinds.includes('system'))
        )
          return false
        if (d.deliveries && ctx.delivery !== undefined && !d.deliveries.includes(ctx.delivery))
          return false
        if (systemRule && d.systemEventKinds) {
          const chosen = ctx.systemEventKinds ?? []
          if (chosen.length > 0) {
            if (!d.systemEventKinds.some((k) => chosen.includes(k))) return false
          } else if (kind !== 'mixed') {
            // Nothing chosen yet: a family watches its own family's kinds.
            const own = systemEventKindsOfFamily(kind)
            if (!d.systemEventKinds.some((k) => own.some((o) => o === k))) return false
          }
        }
        return true
      })
      .map((d) => d.name)
      .sort()
  }

  const families = ['rule', 'timelapse', 'summary'] as const
  const fields = ['title', 'body', 'previewText', 'captionText'] as const
  const kinds = [
    undefined,
    'detection',
    'sensor',
    'occupancy',
    'sound',
    'device-events',
    'system',
    'alarm',
    'mixed',
  ] as const
  const deliveries = [
    undefined,
    'immediate',
    'track-end',
    'device-event',
    'package-event',
    'system-event',
  ] as const
  const systemEventKindSets = [
    undefined,
    ['device-battery-low'],
    ['addon-update-available'],
  ] as const

  it('agrees with the oracle on every context the mirrored schema allows', () => {
    const mismatches: string[] = []
    for (const family of families) {
      for (const field of fields) {
        for (const kind of kinds) {
          for (const delivery of deliveries) {
            for (const systemEventKinds of systemEventKindSets) {
              const ctx: NcTemplateVarContext = {
                family,
                field,
                kind,
                delivery,
                systemEventKinds: systemEventKinds ? [...systemEventKinds] : undefined,
              }
              const actual = varsForContext(catalog, ctx)
                .map((d) => d.name)
                .sort()
              const expected = expectedNames(catalog, ctx)
              if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                mismatches.push(
                  `${JSON.stringify(ctx)}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
                )
              }
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('a caption field never offers a fields-scoped, kinds-scoped or dynamic var, even when the name would otherwise be in scope', () => {
    const names = (ctx: NcTemplateVarContext) =>
      varsForContext(catalog, ctx)
        .map((d) => d.name)
        .sort()
    // ai (fields:['body']) and dynamicCount (dynamic) are never in the fixed
    // allow-list; batteryPct/zoneCount/immediateOnly/dogBark are also absent
    // by name, independent of their own axis restrictions.
    expect(names({ family: 'rule', field: 'previewText' })).toEqual(['camera', 'from', 'rule', 'to'])
    expect(names({ family: 'rule', field: 'captionText' })).toEqual(['from', 'rule', 'to'])
  })

  it('systemEventKinds is read only for a system rule kind — any family, or mixed (D637)', () => {
    const names = (ctx: NcTemplateVarContext) =>
      varsForContext(catalog, ctx)
        .map((d) => d.name)
        .sort()
    // kind undefined: the kinds axis already passes batteryPct through, and
    // systemEventKinds is never consulted even though the context carries an
    // unrelated set.
    expect(
      names({ family: 'rule', field: 'title', kind: undefined, systemEventKinds: ['addon-update-available'] }),
    ).toContain('batteryPct')
    // No chosen kinds: a FAMILY watches its own family's kinds — a battery
    // variable belongs to device events, not to the installation family —
    // and `mixed` watches all of them.
    expect(names({ family: 'rule', field: 'title', kind: 'system' })).not.toContain('batteryPct')
    expect(names({ family: 'rule', field: 'title', kind: 'device-events' })).toContain('batteryPct')
    expect(names({ family: 'rule', field: 'title', kind: 'alarm' })).not.toContain('batteryPct')
    expect(names({ family: 'rule', field: 'title', kind: 'mixed' })).toContain('batteryPct')
    // kind 'system', a disjoint chosen set: excluded.
    expect(
      names({ family: 'rule', field: 'title', kind: 'system', systemEventKinds: ['addon-update-available'] }),
    ).not.toContain('batteryPct')
    // A chosen battery kind on a device-events rule: offered.
    expect(
      names({ family: 'rule', field: 'title', kind: 'device-events', systemEventKinds: ['device-battery-low'] }),
    ).toContain('batteryPct')
  })
})

describe('groupTemplateVars', () => {
  it('keeps the fixed group order and drops empty groups', () => {
    const groups = groupTemplateVars([
      v({ name: 'rule', group: 'rule' }),
      v({ name: 'camera', group: 'subject' }),
    ])
    expect(groups.map((g) => g.group)).toEqual(['subject', 'rule'])
  })
})

// ── Labels (Task 6) ──────────────────────────────────────────────────────

/** Resolve a dotted i18n key against a locale JSON tree, without a cast. */
function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** The keys directly under a dotted locale path (empty when absent). */
function localeChildKeys(tree: unknown, key: string): string[] {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return []
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return node !== null && typeof node === 'object' ? Object.keys(node).sort() : []
}

describe('template variable labels', () => {
  it(
    'every variable of the SERVER catalog has an en AND an it label',
    () => {
      const names = NC_TEMPLATE_VARS.map((descriptor) => descriptor.name)
      // A regex that silently matched nothing would make this vacuous.
      expect(names.length).toBeGreaterThan(40)
      const missing = names.flatMap((name) =>
        (['en', 'it'] as const).flatMap((locale) =>
          lookupLocale(locale === 'en' ? enLocale : itLocale, `v2.nc.templateVars.${name}`) ===
          undefined
            ? [`${locale}:${name}`]
            : [],
        ),
      )
      expect(missing).toEqual([])
    },
  )

  it('en and it label exactly the same variables', () => {
    const en = localeChildKeys(enLocale, 'v2.nc.templateVars')
    expect(en.length).toBeGreaterThan(40)
    expect(localeChildKeys(itLocale, 'v2.nc.templateVars')).toEqual(en)
  })

  it('every picker group has a heading in both locales', () => {
    const missing = TEMPLATE_GROUP_ORDER.flatMap((group) =>
      [enLocale, itLocale].flatMap((tree, i) =>
        lookupLocale(tree, `v2.nc.templateField.groups.${group}`) === undefined
          ? [`${i === 0 ? 'en' : 'it'}:${group}`]
          : [],
      ),
    )
    expect(missing).toEqual([])
  })

  it('the picker strings exist in both locales', () => {
    for (const key of [
      'v2.nc.templateField.noVars',
      'v2.nc.templateField.unknown',
      'v2.nc.templateField.preview',
      'v2.nc.rules.editor.templateHint',
    ]) {
      expect(lookupLocale(enLocale, key), key).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), key).toBeTypeOf('string')
    }
  })

  it('translates by NAME', () => {
    const t = (key: string, options: { defaultValue: string }): string =>
      key === 'v2.nc.templateVars.camera' ? 'Telecamera' : options.defaultValue
    expect(templateVarLabel(t, v({ name: 'camera', label: 'Camera' }))).toBe('Telecamera')
  })

  it('an unlisted name falls back to the hub label', () => {
    const t = (_key: string, options: { defaultValue: string }): string => options.defaultValue
    expect(templateVarLabel(t, v({ name: 'zzz', label: 'Hub label' }))).toBe('Hub label')
  })

  it('the old hint that i18next could interpolate is gone', () => {
    expect(JSON.stringify(enLocale)).not.toContain('templatePlaceholder')
    expect(JSON.stringify(itLocale)).not.toContain('templatePlaceholder')
  })
})

describe('varsForContext is the SAME answer as templateVarsFor, exhaustively', () => {
  // Ported from the admin's parity spec now that the published types carry the
  // catalog and the function: every family × field × kind × delivery × a
  // system-event kind from each branch the catalog makes, through the MIRROR
  // (the catalog is parsed by the viewer's descriptor schema first, which is
  // itself the check that the mirror accepts every descriptor the hub serves).
  const catalog = NcTemplateVarDescriptorSchema.array().parse(NC_TEMPLATE_VARS)
  const kinds = [undefined, ...NcRuleKindSchema.options]
  const deliveries = [undefined, ...NcDeliverySchema.options]
  const systemEventDeliveries = [undefined, ...NcSystemEventDeliveryModeSchema.options]
  const systemEventKindSets: readonly (readonly NcSystemEventKind[] | undefined)[] = [
    undefined,
    ['device-battery-low'],
    ['addon-update-available'],
    ['alarm-triggered'],
    ['alarm-pending'],
    ['backup-completed'],
    ['wrapper-update-available'],
  ]

  it('the mirror parses the whole catalog', () => {
    expect(catalog).toHaveLength(NC_TEMPLATE_VARS.length)
    expect(catalog.length).toBeGreaterThan(40)
  })

  it('agrees on every context the schema allows', () => {
    const mismatches: string[] = []
    for (const family of NcTemplateFamilySchema.options) {
      for (const field of NcTemplateFieldSchema.options) {
        for (const kind of kinds) {
          for (const delivery of deliveries) {
            for (const systemEventKinds of systemEventKindSets) {
              // D647: the delivery axis — absent (instant), instant, summary.
              for (const systemEventDelivery of systemEventDeliveries) {
                const ctx: NcTemplateVarContext = {
                  family,
                  field,
                  kind,
                  delivery,
                  systemEventKinds: systemEventKinds ? [...systemEventKinds] : undefined,
                  systemEventDelivery,
                }
                const local = varsForContext(catalog, ctx).map((d) => d.name).sort()
                const shared = templateVarsFor(ctx).map((d) => d.name).sort()
                if (JSON.stringify(local) !== JSON.stringify(shared)) {
                  mismatches.push(`${JSON.stringify(ctx)}: local=${JSON.stringify(local)} shared=${JSON.stringify(shared)}`)
                }
              }
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})
