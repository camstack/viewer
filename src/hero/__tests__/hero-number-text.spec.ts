/**
 * @vitest-environment jsdom
 *
 * Number and text hero controls (types 1.2.559+): the row shows the value, a tap
 * opens a sheet with the editor, Save sends it to the control's own call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { HeroControl, HeroRowModel } from '@camstack/types'
import { mountScreen } from '../../testing/mount.js'
import { HeroControlView } from '../HeroControlView.js'
import { HeroRowBody } from '../HeroRowBody.js'
import { controlView, rowView } from '../hero-view.js'
import type { HeroCaller } from '../use-hero.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  runValue.mockClear()
})

const call = { cap: 'climate-control', method: 'setTarget', args: {} }

const numberControl: HeroControl = {
  kind: 'number',
  id: 'setpoint',
  label: { en: 'Setpoint', it: 'Setpoint' },
  value: 21,
  step: 0.5,
  unit: '°C',
  call,
  valueArg: 'temperature',
}

const textControl: HeroControl = {
  kind: 'text',
  id: 'label',
  label: { en: 'Label', it: 'Etichetta' },
  value: 'Kitchen',
  call: { cap: 'switch', method: 'setLabel', args: {} },
  valueArg: 'name',
}

const runValue = vi.fn(async () => undefined)
const stubCaller: HeroCaller = {
  pending: false,
  error: null,
  runAction: async () => undefined,
  runValue,
}

const rowShell = (primary: HeroControl, extras?: HeroControl[]): HeroRowModel => ({
  deviceId: 9,
  name: 'Thermostat',
  type: 'climate',
  state: 'on',
  stateAssumed: false,
  look: { icon: 'air-vent', tone: 'info', background: 'plain', animation: 'none' },
  scene: { id: 'generic', mode: null, level: null },
  statusLine: [],
  primary,
  extras,
  timedRun: null,
  trailing: null,
})

describe('number and text hero controls', () => {
  it('controlView maps them to a value view the row can draw', () => {
    expect(controlView(numberControl)).toMatchObject({ kind: 'value', valueKind: 'number', value: 21 })
    expect(controlView(textControl)).toMatchObject({ kind: 'value', valueKind: 'text', value: 'Kitchen' })
  })

  it('a row whose primary is number or text has a control', () => {
    expect(rowView(rowShell(numberControl), 'en').control).not.toBeNull()
    expect(rowView(rowShell(textControl), 'en').control).not.toBeNull()
  })

  it('the row shows the value and no field until it is tapped', () => {
    mountScreen(
      React.createElement(HeroRowBody, {
        deviceId: 9,
        name: 'Thermostat',
        online: true,
        model: rowShell(numberControl, [textControl]),
        onOpen: () => undefined,
        openLabel: 'Open',
      }),
      { hub: {} },
    )
    expect(screen.getByTestId('hero-value-setpoint').textContent).toContain('21 °C')
    expect(screen.getByTestId('hero-value-label').textContent).toContain('Kitchen')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  const mountEditor = (control: HeroControl): void => {
    mountScreen(
      React.createElement(HeroControlView, { control, locale: 'en', caller: stubCaller, online: true }),
      { hub: {} },
    )
  }

  it('a number opens a sheet, steps, and saves the number to its call', async () => {
    mountEditor(numberControl)
    fireEvent.click(screen.getByTestId('hero-value-setpoint'))
    const input = screen.getByTestId('hero-value-input-setpoint')
    fireEvent.change(input, { target: { value: '22,5' } })
    fireEvent.click(screen.getByLabelText('Increase Setpoint'))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(runValue).toHaveBeenCalledWith(
        { cap: 'climate-control', method: 'setTarget', valueArg: 'temperature' },
        23,
      ),
    )
  })

  it('a text opens a sheet and saves the string to its call', async () => {
    mountEditor(textControl)
    fireEvent.click(screen.getByTestId('hero-value-label'))
    fireEvent.change(screen.getByTestId('hero-value-input-label'), { target: { value: 'Pantry' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(runValue).toHaveBeenCalledWith({ cap: 'switch', method: 'setLabel', valueArg: 'name' }, 'Pantry'),
    )
  })

  it('a number that is not a number cannot be saved', () => {
    mountEditor(numberControl)
    fireEvent.click(screen.getByTestId('hero-value-setpoint'))
    fireEvent.change(screen.getByTestId('hero-value-input-setpoint'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('Save'))
    expect(runValue).not.toHaveBeenCalled()
  })
})
