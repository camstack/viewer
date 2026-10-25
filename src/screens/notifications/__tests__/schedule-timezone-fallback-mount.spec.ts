/**
 * @vitest-environment jsdom
 *
 * The time-zone TEXT BOX — the branch a runtime without
 * `Intl.supportedValuesOf` (some Hermes builds) gets. Node lists its zones, so
 * the listing is stubbed to `null` here; the validator stays REAL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import React, { useState } from 'react'

import { mountScreen } from '../../../testing/mount.js'
import type { NcSchedule } from '../../../data/notification-center.js'
import { ScheduleTimeZoneField } from '../rule-editor/sections/ScheduleTimeZoneField.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)
vi.mock('../../../components/notifications/rule-field-choices.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../components/notifications/rule-field-choices.js')>()),
  timeZoneChoices: (): readonly string[] | null => null,
}))

const INVALID = /Not a known time zone/
const BASE: NcSchedule = { windows: [{ days: [1], startMinute: 0, endMinute: 60 }], invert: true }

let saved: NcSchedule | null = null

function Host({ initial }: { readonly initial: NcSchedule }): React.ReactElement {
  const [schedule, setSchedule] = useState<NcSchedule>(initial)
  return React.createElement(ScheduleTimeZoneField, {
    schedule,
    onChange: (next: NcSchedule) => {
      saved = next
      setSchedule(next)
    },
  })
}

async function type(box: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(box, { target: { value } })
  })
}

afterEach(() => {
  cleanup()
  saved = null
})

describe('the time-zone text box (no Intl zone list)', () => {
  it('flags a zone that does not exist and does NOT save it', async () => {
    const screen = mountScreen(React.createElement(Host, { initial: BASE }))
    const box = screen.getByPlaceholderText('e.g. Europe/Rome')
    expect(screen.queryByText(INVALID)).toBeNull()
    await type(box, 'Mars/Base')
    expect(screen.queryByText(INVALID)).not.toBeNull()
    expect(saved).toBeNull()
  })

  it('saves a valid zone, keeping the rest of the schedule', async () => {
    const screen = mountScreen(React.createElement(Host, { initial: BASE }))
    await type(screen.getByPlaceholderText('e.g. Europe/Rome'), 'Europe/Rome')
    expect(screen.queryByText(INVALID)).toBeNull()
    expect(saved).toEqual({ ...BASE, timezone: 'Europe/Rome' })
  })

  it('blank goes back to the hub’s zone — the field is removed, not blanked', async () => {
    const screen = mountScreen(React.createElement(Host, { initial: { ...BASE, timezone: 'Europe/Rome' } }))
    await type(screen.getByDisplayValue('Europe/Rome'), '')
    expect(saved).toEqual(BASE)
    expect(saved !== null && 'timezone' in saved).toBe(false)
  })
})
