/**
 * rule-routes — the hrefs of the notification-rule editor routes.
 *
 * Typed as expo-router's own `Href`, so `router.push(ruleHref(...))` needs no
 * cast. With `typedRoutes` generated (`.expo/types`, written by the dev
 * server) `Href` is the union of the app's real routes and a pathname here
 * that has no route file fails to compile; without it `Href` is
 * `string | { pathname, params }` and these objects are that shape.
 */
import type { Href } from 'expo-router'
import type { NcRuleEditorSectionKey, NcRuleKind } from '@camstack/types'

export type RuleHref = Href

export type RuleRouteId = string | 'new'

function kindParam(kind: NcRuleKind | undefined): Readonly<Record<string, string>> {
  return kind ? { kind } : {}
}

export function newRuleHref(): RuleHref {
  return '/rule/new'
}

export function ruleHref(id: RuleRouteId, kind?: NcRuleKind): RuleHref {
  return { pathname: '/rule/[id]', params: { id, ...kindParam(kind) } }
}

/**
 * Where "New rule" goes from a strip filter: a kind the caller may create
 * opens seeded as that kind; `all`, or a kind they may not create, opens the
 * kind picker, which asks rather than guessing.
 */
export function createRuleHref(
  filter: 'all' | NcRuleKind,
  creatable: readonly NcRuleKind[],
): RuleHref {
  return filter !== 'all' && creatable.includes(filter) ? ruleHref('new', filter) : newRuleHref()
}

export function ruleSectionHref(
  id: RuleRouteId,
  section: NcRuleEditorSectionKey,
  kind?: NcRuleKind,
): RuleHref {
  return { pathname: '/rule/[id]/[section]', params: { id, section, ...kindParam(kind) } }
}

export function timelapseRuleHref(id: RuleRouteId): RuleHref {
  return { pathname: '/timelapse-rule/[id]', params: { id } }
}

export function summaryRuleHref(id: RuleRouteId): RuleHref {
  return { pathname: '/summary-rule/[id]', params: { id } }
}

/**
 * A rule's delivery history. `name` rides along so the title can name the
 * rule before — and whether or not — any delivery row has answered.
 */
export function ruleHistoryHref(id: string, name: string): RuleHref {
  return { pathname: '/notifications/rule/[id]/history', params: { id, name } }
}
