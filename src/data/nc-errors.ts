/**
 * The notification center's OWN errors — the ones the app raises, as opposed
 * to a hub refusal.
 *
 * A hub refusal is shown verbatim (`RuleErrorBanner`): the hub is the
 * validation authority and its message names the thing to fix. An error the
 * APP raises has no such author, and its English `message` is a log line, not
 * something to put in front of an Italian operator (final review m6). Each one
 * therefore carries the i18n key the screen shows instead.
 */
import type {
  NcRule,
  NcRuleClearableKey,
  NcSummaryRuleClearableKey,
  NcSystemEventDelivery,
  NcTimelapseRuleClearableKey,
} from './notification-center.js'

/** An app-raised error with the translation key a screen shows for it. */
export class NcLocalizedError extends Error {
  readonly i18nKey: string

  constructor(i18nKey: string, message: string) {
    super(message)
    this.name = 'NcLocalizedError'
    this.i18nKey = i18nKey
  }
}

/**
 * No system handle: the request was never sent. The message stays the
 * app-wide `'not connected'` so logs and existing matchers read the same.
 */
export function ncNotConnectedError(): NcLocalizedError {
  return new NcLocalizedError('v2.nc.rules.editor.notConnected', 'not connected')
}

/** Any key an editor may send in `clear`, across the three rule families. */
export type NcAnyClearableKey = NcRuleClearableKey | NcTimelapseRuleClearableKey | NcSummaryRuleClearableKey

/**
 * The hub accepted the save but did NOT remove the fields it was asked to
 * clear — an addon older than the `clear` it was sent strips the key and
 * answers success (final review I4). The editor must stay open with its draft,
 * not report a save that the next read reverts.
 */
export class NcHubTooOldToClearError extends NcLocalizedError {
  readonly keys: readonly NcAnyClearableKey[]

  constructor(keys: readonly NcAnyClearableKey[]) {
    super('v2.nc.rules.editor.hubTooOldToClear', `hub kept fields it was asked to clear: ${keys.join(', ')}`)
    this.name = 'NcHubTooOldToClearError'
    this.keys = keys
  }
}

/**
 * The hub answered an enable switch with success, but the rule it RETURNED is
 * not in the state asked for. The switch must go back to what the hub holds
 * and say so — never show a state the hub did not accept.
 */
export class NcRuleEnableNotAppliedError extends NcLocalizedError {
  constructor(ruleId: string, asked: boolean) {
    super('v2.nc.rules.enableNotApplied', `hub kept rule ${ruleId} ${asked ? 'off' : 'on'}`)
    this.name = 'NcRuleEnableNotAppliedError'
  }
}

/** A saved rule, as far as this check reads it: any of the cleared keys. */
export type NcClearedRuleView<K extends NcAnyClearableKey> = Readonly<Partial<Record<K, unknown>>>

/**
 * Throw when a cleared key is still on the rule the hub RETURNED.
 *
 * Read off the response the phone already holds — no second request. A field
 * the hub removed is absent from the stored rule (every clearable key is
 * `.optional()` with no default, on the hub and in the mirrors).
 */
export function assertClearsLanded<K extends NcAnyClearableKey>(
  rule: NcClearedRuleView<K>,
  clear: readonly K[] | undefined,
): void {
  const kept = (clear ?? []).filter((key) => rule[key] !== undefined)
  if (kept.length > 0) throw new NcHubTooOldToClearError(kept)
}

/** The i18n key for an app-raised error, or `undefined` for a hub refusal. */
export function ncErrorKey(error: unknown): string | undefined {
  return error instanceof NcLocalizedError ? error.i18nKey : undefined
}

/** What the editor says when a hub older than D647 kept a summary rule as instant. */
export const NC_SUMMARY_NOT_KEPT_KEY = 'v2.nc.rules.editor.summaryNotKept'

/**
 * The hub answered a save that asked for a STATE SUMMARY (D647) with a rule
 * that has none: a hub older than D647 strips the key it does not know and
 * stores the rule as it was — instant, a notification per event. Said, never
 * reported as a saved summary the next read would contradict.
 */
export class NcSummaryNotKeptError extends NcLocalizedError {
  /**
   * The rule the hub STORED — as instant. On a create it now exists: the
   * editor must switch to editing it, or the next Save creates a second one.
   */
  readonly rule: NcRule

  constructor(rule: NcRule) {
    super(NC_SUMMARY_NOT_KEPT_KEY, `hub did not keep systemEventDelivery: summary on rule ${rule.id} (the hub is too old to keep a summary)`)
    this.name = 'NcSummaryNotKeptError'
    this.rule = rule
  }
}

/** A rule's delivery, as far as {@link assertSummaryDeliveryLanded} reads it. */
export interface NcSummaryDeliveryView {
  readonly systemEventDelivery?: NcSystemEventDelivery | undefined
}

/** Throw when a summary was sent and the rule the hub RETURNED is not one. */
export function assertSummaryDeliveryLanded(sent: NcSummaryDeliveryView, saved: NcRule): void {
  if (sent.systemEventDelivery?.mode === 'summary' && saved.systemEventDelivery?.mode !== 'summary') {
    throw new NcSummaryNotKeptError(saved)
  }
}
