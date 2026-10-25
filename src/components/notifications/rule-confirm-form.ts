/**
 * rule-confirm-form — the AI confirm gate (`NcRule.confirm`) as form state.
 *
 * The gate's three states are distinct and each must round-trip:
 *
 * | stored | form | written back |
 * | --- | --- | --- |
 * | absent | the disabled default | absent — nothing is invented |
 * | `enabled: false` + a prompt/expectation | disabled, configuration kept | the same object — an admin PAUSING the gate keeps what they wrote |
 * | `enabled: true` | enabled | the same object |
 *
 * `timeoutMs` / `onTimeout` / `maxImagePx` carry `.default()`s in the schema,
 * so a parsed gate always has them; the form holds them as plain values and
 * writes them back as they are.
 */
import {
  NC_CONFIRM_DEFAULT_MAX_IMAGE_PX,
  NC_CONFIRM_DEFAULT_TIMEOUT_MS,
  type NcConfirm,
  type NcConfirmExpect,
} from '../../data/notification-center.js'

export type NcConfirmOnTimeout = NcConfirm['onTimeout']

export interface NcConfirmFormState {
  readonly enabled: boolean
  /** Absent = the `purpose:'vision'` cluster default. */
  readonly profileId: string | undefined
  /** The operator's question; blank = derived from the rule. */
  readonly prompt: string
  /** Absent = the model's own yes/no decides. */
  readonly expect: NcConfirmExpect | undefined
  readonly timeoutMs: number
  readonly onTimeout: NcConfirmOnTimeout
  readonly maxImagePx: number
}

/** What an absent gate opens as — off, with the hub's own defaults. */
export const NC_CONFIRM_FORM_DEFAULT: NcConfirmFormState = {
  enabled: false,
  profileId: undefined,
  prompt: '',
  expect: undefined,
  timeoutMs: NC_CONFIRM_DEFAULT_TIMEOUT_MS,
  onTimeout: 'fire',
  maxImagePx: NC_CONFIRM_DEFAULT_MAX_IMAGE_PX,
}

export function confirmToForm(confirm: NcConfirm | undefined): NcConfirmFormState {
  if (confirm === undefined) return NC_CONFIRM_FORM_DEFAULT
  return {
    enabled: confirm.enabled,
    profileId: confirm.profileId,
    prompt: confirm.prompt ?? '',
    expect: confirm.expect,
    timeoutMs: confirm.timeoutMs,
    onTimeout: confirm.onTimeout,
    maxImagePx: confirm.maxImagePx,
  }
}

/** True when a DISABLED form says nothing beyond the defaults. */
function isUntouchedDefault(form: NcConfirmFormState): boolean {
  return (
    !form.enabled &&
    form.profileId === undefined &&
    form.prompt.trim().length === 0 &&
    form.expect === undefined &&
    form.timeoutMs === NC_CONFIRM_FORM_DEFAULT.timeoutMs &&
    form.onTimeout === NC_CONFIRM_FORM_DEFAULT.onTimeout &&
    form.maxImagePx === NC_CONFIRM_FORM_DEFAULT.maxImagePx
  )
}

/** Back to the wire shape — `undefined` for the untouched disabled default. */
export function formToConfirm(form: NcConfirmFormState): NcConfirm | undefined {
  if (isUntouchedDefault(form)) return undefined
  // Blank is omitted; anything else is written EXACTLY as stored/typed, so an
  // untouched prompt round-trips byte identical.
  const hasPrompt = form.prompt.trim().length > 0
  return {
    enabled: form.enabled,
    ...(form.profileId !== undefined ? { profileId: form.profileId } : {}),
    ...(hasPrompt ? { prompt: form.prompt } : {}),
    ...(form.expect !== undefined ? { expect: form.expect } : {}),
    timeoutMs: form.timeoutMs,
    onTimeout: form.onTimeout,
    maxImagePx: form.maxImagePx,
  }
}
