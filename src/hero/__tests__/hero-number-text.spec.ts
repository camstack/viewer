/**
 * @vitest-environment jsdom
 *
 * Number and text hero controls exist on the hub model (types 1.2.559+); the
 * viewer does not draw typed inputs for them until layout is co-designed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
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

afterEach(() => cleanup())

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

const stubCaller: HeroCaller = {
  pending: false,
  error: null,
  runAction: async () => undefined,
  runValue: async () => undefined,
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

describe('number and text hero controls are not drawn', () => {
  it('controlView skips them without a drawable view', () => {
    expect(controlView(numberControl)).toBeNull()
    expect(controlView(textControl)).toBeNull()
  })

  it('a row whose primary is number or text has no control widget', () => {
    expect(rowView(rowShell(numberControl), 'en').control).toBeNull()
    expect(rowView(rowShell(textControl), 'en').control).toBeNull()
  })

  it('HeroControlView renders no text inputs for number or text', () => {
    mountScreen(
      React.createElement(React.Fragment, null, [
        React.createElement(HeroControlView, {
          key: 'n',
          control: numberControl,
          locale: 'en',
          caller: stubCaller,
          online: true,
        }),
        React.createElement(HeroControlView, {
          key: 't',
          control: textControl,
          locale: 'en',
          caller: stubCaller,
          online: true,
        }),
      ]),
      { hub: {} },
    )
    expect(screen.queryByTestId('hero-value-setpoint')).toBeNull()
    expect(screen.queryByTestId('hero-value-label')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('a row with number primary and text extra draws neither input', () => {
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
    expect(screen.queryByTestId('hero-value-setpoint')).toBeNull()
    expect(screen.queryByTestId('hero-value-label')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
