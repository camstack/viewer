/**
 * @vitest-environment jsdom
 *
 * The power-source row: a bare "Power" title and two buttons — ONE on/off
 * toggle whose label is the direction it moves the switch, and Restart.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import { mountScreen } from '../../../../testing/mount.js'
import { PowerSourceRow } from '../PowerSourceRow.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => cleanup())

const status = (switchOn: boolean | null, restartInProgress = false): Record<string, unknown> => ({
  linked: true,
  switchName: 'Camera plug',
  switchOn,
  switchOnline: true,
  restartInProgress,
})

function mount(raw: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
  mountScreen(React.createElement(PowerSourceRow, { deviceId: 7 }), {
    hub: { 'powerSource.getStatus': raw, ...extra },
  })
}

describe('PowerSourceRow', () => {
  it('a switched-on source offers Power off, under the bare title, never the switch name', async () => {
    mount(status(true))
    expect(await screen.findByText('Power')).toBeTruthy()
    expect(screen.getByTestId('power-source-toggle').textContent).toContain('Power off')
    expect(screen.queryByText('Power on')).toBeNull()
    expect(screen.queryByText(/Camera plug/)).toBeNull()
    expect(screen.getByText('Restart')).toBeTruthy()
  })

  it('a switched-off source offers Power on', async () => {
    mount(status(false))
    await screen.findByText('Power')
    expect(screen.getByTestId('power-source-toggle').textContent).toContain('Power on')
  })

  it('an unreported switch claims no direction', async () => {
    mount(status(null))
    await screen.findByText('Power')
    const toggle = screen.getByTestId('power-source-toggle')
    expect(toggle.textContent).toContain('unknown')
    expect(screen.queryByText('Power on')).toBeNull()
    expect(screen.queryByText('Power off')).toBeNull()
  })

  describe('a switch that answered whether it can be set', () => {
    it('settable (true) keeps Power on / Power off', async () => {
      mount({ ...status(true), switchSettable: true })
      await screen.findByText('Power')
      expect(screen.getByTestId('power-source-toggle').textContent).toContain('Power off')
      expect(screen.getByText('Restart')).toBeTruthy()
    })

    it('reports-only (false) hides the toggle and keeps Restart', async () => {
      mount({ ...status(true), switchSettable: false })
      await screen.findByText('Power')
      expect(screen.queryByTestId('power-source-toggle')).toBeNull()
      expect(screen.queryByText('Power off')).toBeNull()
      expect(screen.queryByText('Power on')).toBeNull()
      expect(screen.getByText('Restart')).toBeTruthy()
    })

    it('unknown (null) keeps the toggle: not known is never "cannot"', async () => {
      mount({ ...status(false), switchSettable: null })
      await screen.findByText('Power')
      expect(screen.getByTestId('power-source-toggle').textContent).toContain('Power on')
    })

    it('an older hub that sends no field keeps the toggle', async () => {
      mount(status(false))
      await screen.findByText('Power')
      expect(screen.getByTestId('power-source-toggle').textContent).toContain('Power on')
    })
  })

  it('a not-settable refusal that still comes back (a race) is shown as the failure line', async () => {
    mount(status(false), {
      'powerSource.powerOn': { accepted: false, reason: 'not-settable', message: 'The switch only reports its state.' },
    })
    await screen.findByText('Power')
    fireEvent.click(screen.getByTestId('power-source-toggle'))
    expect(
      await screen.findByText('This power switch only reports its state; it cannot be switched from here.'),
    ).toBeTruthy()
  })
})
