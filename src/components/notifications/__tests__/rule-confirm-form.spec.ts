import { describe, expect, it } from 'vitest'
import { NcConfirmSchema } from '../../../data/notification-center.js'
import { confirmToForm, formToConfirm, NC_CONFIRM_FORM_DEFAULT } from '../rule-confirm-form.js'

describe('AI confirm gate — form model', () => {
  it('an absent gate opens as the disabled default', () => {
    expect(confirmToForm(undefined)).toEqual(NC_CONFIRM_FORM_DEFAULT)
    expect(NC_CONFIRM_FORM_DEFAULT.enabled).toBe(false)
  })

  it('absent stays absent: the untouched disabled default writes nothing', () => {
    expect(formToConfirm(confirmToForm(undefined))).toBeUndefined()
  })

  it('an enabled gate with an expectation round-trips byte-identical', () => {
    const stored = NcConfirmSchema.parse({
      enabled: true,
      profileId: 'vision-1',
      prompt: 'Is a car parked in the driveway?',
      expect: { op: '>=', count: 2 },
      timeoutMs: 5_000,
      onTimeout: 'suppress',
      maxImagePx: 512,
    })
    expect(formToConfirm(confirmToForm(stored))).toEqual(stored)
  })

  it('an enabled gate with only the defaults round-trips (defaults materialised by the parse)', () => {
    const stored = NcConfirmSchema.parse({ enabled: true })
    expect(formToConfirm(confirmToForm(stored))).toEqual(stored)
  })

  it('a DISABLED gate that still carries its configuration is kept, not dropped', () => {
    // Off-but-configured is an admin pausing the gate; clearing it would lose
    // the prompt and expectation they wrote.
    const stored = NcConfirmSchema.parse({ enabled: false, prompt: 'a person?' })
    expect(formToConfirm(confirmToForm(stored))).toEqual(stored)
  })

  it('a blank prompt is omitted, never sent as an empty string', () => {
    const out = formToConfirm({ ...NC_CONFIRM_FORM_DEFAULT, enabled: true, prompt: '   ' })
    expect(out).toBeDefined()
    expect(out?.enabled).toBe(true)
    expect(out !== undefined && 'prompt' in out).toBe(false)
  })
})
