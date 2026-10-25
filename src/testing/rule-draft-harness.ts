/**
 * The rule editor's Rule + Notification sub-screens over ONE draft, opened the
 * way the routes open it (`useRuleDraft` over the real store). Mount specs use
 * it in place of the single-screen editor that no longer exists; the Rule
 * section is there because its target picker is their readiness node.
 */
import React from 'react'
import { NotificationSection } from '../screens/notifications/rule-editor/sections/NotificationSection.js'
import { RuleSection } from '../screens/notifications/rule-editor/sections/RuleSection.js'
import { useRuleDraft } from '../screens/notifications/rule-editor/use-rule-draft.js'
import { useNcRuleDraftStore } from '../store/nc-rule-draft-store.js'
import type { NcViewerRule } from '../data/notification-center.js'

export interface RuleDraftHarnessProps {
  readonly ruleId: string
}

export function RuleDraftHarness({ ruleId }: RuleDraftHarnessProps): React.ReactElement | null {
  const editor = useRuleDraft({ id: ruleId })
  if (editor.status !== 'ready' || !editor.draft || !editor.kind) return null
  const props = {
    draft: editor.draft,
    patch: editor.patch,
    kind: editor.kind,
    catalog: [],
    rule: editor.rule,
  }
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(RuleSection, props),
    React.createElement(NotificationSection, props),
  )
}

/** Serve `nc.listRules` with this one rule; every other action goes to `fallback`. */
export function withRuleList(
  rule: NcViewerRule,
  actionOf: (input: unknown) => string,
  fallback: (input?: unknown) => unknown,
): { readonly 'addons.custom': (input?: unknown) => unknown } {
  return {
    'addons.custom': (input?: unknown): unknown =>
      actionOf(input) === 'nc.listRules' ? { rules: [rule] } : fallback(input),
  }
}

/** The draft store is module state: a draft left open would seed the next test. */
export function resetRuleDrafts(): void {
  useNcRuleDraftStore.setState({ drafts: {} })
}
