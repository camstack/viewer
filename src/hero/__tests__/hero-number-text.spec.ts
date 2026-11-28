/**
 * @vitest-environment jsdom
 *
 * Number and text hero controls (types 1.2.559+): the row shows the value as a chip,
 * a tap turns it into an inline field, ✓ / Enter sends it to the control's own call, ✕ nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { HeroControl, HeroRowModel } from '@dominevo/types'
import { mountScreen } from '../../testing/mount.js'
import { HeroControlView } from '../HeroControlView.js'
import { HeroRowBody } from '../HeroRowBody.js'
import { HeroValueEditor, type ValueDisplay, type ValueEditorSpec } from '../HeroValueEditor.js'
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
  runCall: async () => undefined,
  refresh: async () => undefined,
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

  it('an unbounded number is a chip, then an inline field; ✓ sends the base value', async () => {
    mountEditor(numberControl)
    expect(screen.queryByTestId('hero-value-input-setpoint')).toBeNull()
    fireEvent.click(screen.getByTestId('hero-value-setpoint'))
    fireEvent.change(screen.getByTestId('hero-value-input-setpoint'), { target: { value: '22,5' } })
    fireEvent.click(screen.getByLabelText('Save'))
    await waitFor(() =>
      expect(runValue).toHaveBeenCalledWith({ cap: 'climate-control', method: 'setTarget', valueArg: 'temperature' }, 22.5),
    )
    expect(screen.queryByTestId('hero-value-input-setpoint')).toBeNull()
  })

  it('the typed number is converted from the display unit to the base unit', async () => {
    const fahrenheit: ValueDisplay = { unit: '°F', toShown: (c) => c * 1.8 + 32, toBase: (f) => (f - 32) / 1.8 }
    const spec: ValueEditorSpec = {
      id: 'setpoint', label: 'Setpoint', kind: 'number', value: 20, unit: '°C', step: null, display: fahrenheit,
      call: { cap: 'climate-control', method: 'setTarget', valueArg: 'temperature' },
    }
    mountScreen(React.createElement(HeroValueEditor, { spec, caller: stubCaller, disabled: false }), { hub: {} })
    expect(screen.getByTestId('hero-value-setpoint').textContent).toContain('68 °F')
    fireEvent.click(screen.getByTestId('hero-value-setpoint'))
    fireEvent.change(screen.getByTestId('hero-value-input-setpoint'), { target: { value: '86' } })
    fireEvent.click(screen.getByLabelText('Save'))
    await waitFor(() => expect(runValue).toHaveBeenCalledWith(spec.call, 30))
  })

  it('✕ closes the field and sends nothing', () => {
    mountEditor(numberControl)
    fireEvent.click(screen.getByTestId('hero-value-setpoint'))
    fireEvent.change(screen.getByTestId('hero-value-input-setpoint'), { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText('Cancel'))
    expect(runValue).not.toHaveBeenCalled()
    expect(screen.queryByTestId('hero-value-input-setpoint')).toBeNull()
    expect(screen.getByTestId('hero-value-setpoint').textContent).toContain('21 °C')
  })

  it('a text is sent on submit (Enter)', async () => {
    mountEditor(textControl)
    fireEvent.click(screen.getByTestId('hero-value-label'))
    const input = screen.getByTestId('hero-value-input-label')
    fireEvent.change(input, { target: { value: 'Pantry' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(runValue).toHaveBeenCalledWith({ cap: 'switch', method: 'setLabel', valueArg: 'name' }, 'Pantry'),
    )
  })

  it('a number that is not a number cannot be saved', () => {
    mountEditor(numberControl)
    fireEvent.click(screen.getByTestId('hero-value-setpoint'))
    fireEvent.change(screen.getByTestId('hero-value-input-setpoint'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByLabelText('Save'))
    expect(runValue).not.toHaveBeenCalled()
  })

  it('a bounded number keeps its stepper, no chip', () => {
    const slider: HeroControl = {
      kind: 'slider', id: 'level', label: { en: 'Level', it: 'Livello' }, value: 40, min: 0, max: 100, step: 10, unit: '%',
      call, valueArg: 'level',
    }
    expect(controlView(slider)).toMatchObject({ kind: 'stepper', value: 40, up: 50 })
    mountEditor(slider)
    expect(screen.getByTestId('hero-stepper-level')).toBeTruthy()
    expect(screen.queryByTestId('hero-value-level')).toBeNull()
  })

  it('a gated primary gives the row no control at all', () => {
    expect(rowView(rowShell(numberControl), 'en').control).not.toBeNull()
    expect(rowView({ ...rowShell(numberControl), primary: null }, 'en').control).toBeNull()
  })

  it('a control kind this build does not know draws nothing', () => {
    const future = { kind: 'date', id: 'when', label: { en: 'When', it: 'Quando' } } as unknown as HeroControl
    expect(controlView(future)).toBeNull()
    const { container } = mountScreen(
      React.createElement(HeroControlView, { control: future, locale: 'en', caller: stubCaller, online: true }),
      { hub: {} },
    )
    expect(container.querySelector('[data-testid^="hero-"]')).toBeNull()
  })
})
