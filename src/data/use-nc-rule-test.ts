/**
 * use-nc-rule-test — the two ways an ADMIN tests a rule from the phone.
 *
 *  - {@link useNcTestRule} fires a SAVED rule for real (`nc.testRule` on the
 *    bridge): the notification is delivered, marked [TEST]. The screen asks
 *    first, because it really sends.
 *  - {@link useNcDryRunRule} evaluates the CURRENT draft against the last
 *    {@link NC_DRY_RUN_LOOKBACK_MINUTES} minutes of persisted records through the
 *    cap (`notificationRules.testRule`), exactly as the admin editor does. It
 *    sends nothing and has no side effects; it is a mutation only to carry the
 *    whole rule object.
 *
 * Both are `auth: 'admin'` on the hub. Hiding them from a non-admin is
 * convenience; the hub is the gate. Neither invalidates anything: a test
 * changes no rule.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import {
  NC_DRY_RUN_LOOKBACK_MINUTES,
  NcDryRunResultSchema,
  type NcDryRunRecord,
  type NcRuleInput,
  type NcRuleTestResult,
} from './notification-center.js'
import { ncClientForTrpc } from './use-notification-center.js'
import { ncNotConnectedError } from './nc-errors.js'

export interface NcTestRuleVars {
  readonly ruleId: string
  /** The camera to attribute the event to when the rule scopes none. */
  readonly deviceId?: number
}

/** Fire a saved rule for real. Throws on a refusal so the screen can say why. */
export function useNcTestRule(): UseMutationResult<NcRuleTestResult, Error, NcTestRuleVars> {
  const { controller } = useConnection()
  return useMutation<NcRuleTestResult, Error, NcTestRuleVars>({
    mutationFn: async ({ ruleId, deviceId }): Promise<NcRuleTestResult> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      return ncClientForTrpc(system.trpcClient).testRule(ruleId, deviceId)
    },
  })
}

export interface NcDryRunVars {
  /** The draft, through the same conversion a save sends (`ruleDryRunInput`). */
  readonly rule: NcRuleInput
}

/** Dry-run the draft. Resolves the evaluated records, newest first as served. */
export function useNcDryRunRule(): UseMutationResult<readonly NcDryRunRecord[], Error, NcDryRunVars> {
  const { controller } = useConnection()
  return useMutation<readonly NcDryRunRecord[], Error, NcDryRunVars>({
    mutationFn: async ({ rule }): Promise<readonly NcDryRunRecord[]> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const raw: unknown = await system.trpcClient.notificationRules.testRule.mutate({
        rule: withoutActions(rule),
        lookbackMinutes: NC_DRY_RUN_LOOKBACK_MINUTES,
      })
      return NcDryRunResultSchema.parse(raw).results
    },
  })
}

/** The draft minus `actions`, which is what a dry run is asked to evaluate.
 *  A dry run judges which records MATCH; it runs no action. The hub's rule now
 *  takes `actions` as bindings to shared sequences, a shape this editor's
 *  inline sequences are not — sending them would fail the whole dry run on a
 *  field the dry run never reads. */
export function withoutActions(rule: NcRuleInput): Omit<NcRuleInput, 'actions'> {
  const { actions: _actions, ...rest } = rule
  return rest
}
