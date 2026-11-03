/**
 * @vitest-environment jsdom
 *
 * The compact media-player control, mounted over a stand-in hub. An infrared TV
 * (a `remote` extension, assumed state) gets power, volume steps and a Remote
 * sheet and never claims idle; an Echo-like player keeps its transport row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { mountScreen } from '../../../../testing/mount.js'
import { MediaPlayerControl } from '../controls-lifecycle.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => cleanup())

const IR_STATUS = {
  state: 'on',
  stateSource: 'assumed',
  assumedFields: ['state'],
  volumeLevel: null,
  isMuted: null,
  source: '',
  availableSources: [],
  currentMedia: null,
}
const LAYOUT = {
  columns: 3,
  rows: 2,
  buttons: [
    { id: 'pw', role: 'power', row: 0, col: 0, rowSpan: 1, colSpan: 1, label: 'Power' },
    { id: 'vu', role: 'volume_up', row: 0, col: 1, rowSpan: 1, colSpan: 1, label: 'Vol +' },
    { id: 'nx', role: 'custom:netflix', row: 1, col: 0, rowSpan: 1, colSpan: 1, label: 'Netflix' },
  ],
}
const IR_HUB = {
  'mediaPlayer.getStatus': IR_STATUS,
  'mediaPlayer.volumeUp': undefined,
  'mediaPlayer.volumeDown': undefined,
  'mediaPlayer.turnOn': undefined,
  'remote.listCommands': {
    layoutTemplateId: 'tpl',
    power: { mode: 'toggle' },
    commands: [{ role: 'power', custom: false }, { role: 'volume_up', custom: false }],
  },
  'template.list': [{ id: 'tpl', payload: LAYOUT }],
  'remote.sendCommand': { status: 'sent', sends: 1 },
}
const IR_FEATURES = ['media-player-power', 'media-player-volume-step']

function mountIr(over: Record<string, unknown> = {}) {
  mountScreen(
    React.createElement(MediaPlayerControl, { deviceId: 5478, online: true, features: IR_FEATURES, deviceName: 'TV salone' }),
    { hub: { ...IR_HUB, ...over } },
  )
}

describe('infrared TV', () => {
  it('marks the state as assumed and offers power, volume steps and the remote', async () => {
    mountIr()
    expect(await screen.findByText('On')).toBeTruthy()
    expect(screen.getByText('assumed')).toBeTruthy()
    expect(screen.getByLabelText('Volume up')).toBeTruthy()
    expect(screen.getByLabelText('Volume down')).toBeTruthy()
    expect(screen.getByLabelText('Turn off')).toBeTruthy()
    expect(screen.getByLabelText('Remote')).toBeTruthy()
    // no fake level: no percentage and no transport row
    expect(screen.queryByText(/%/)).toBeNull()
    expect(screen.queryByLabelText('Next')).toBeNull()
  })

  it('volume buttons call volumeUp / volumeDown, one step', async () => {
    mountIr()
    await screen.findByText('On')
    act(() => { fireEvent.click(screen.getByLabelText('Volume up')) })
    await waitFor(() => expect(hubCalls().some((c) => c.path === 'mediaPlayer.volumeUp')).toBe(true))
    expect(hubCalls().find((c) => c.path === 'mediaPlayer.volumeUp')?.input).toEqual({ deviceId: 5478, steps: 1 })
  })

  it('an unknown state says so and never claims idle', async () => {
    mountIr({ 'mediaPlayer.getStatus': { ...IR_STATUS, state: undefined } })
    expect(await screen.findByText('State unknown')).toBeTruthy()
    expect(screen.queryByText('Idle')).toBeNull()
    expect(screen.queryByText('assumed')).toBeNull()
    // power is unknown: both switches are offered, none is guessed
    expect(screen.getByLabelText('Turn on')).toBeTruthy()
    expect(screen.getByLabelText('Turn off')).toBeTruthy()
  })

  it('the Remote button opens the layout and a press sends that role', async () => {
    mountIr()
    await screen.findByText('On')
    act(() => { fireEvent.click(screen.getByLabelText('Remote')) })
    const key = await screen.findByTestId('remote-key-vu')
    act(() => { fireEvent.click(key) })
    await waitFor(() => expect(hubCalls().some((c) => c.path === 'remote.sendCommand')).toBe(true))
    expect(hubCalls().find((c) => c.path === 'remote.sendCommand')?.input).toEqual({ deviceId: 5478, role: 'volume_up', repeat: 1 })
  })

  it('a key with no bound command is drawn but does nothing', async () => {
    mountIr()
    await screen.findByText('On')
    act(() => { fireEvent.click(screen.getByLabelText('Remote')) })
    const key = await screen.findByTestId('remote-key-nx')
    act(() => { fireEvent.click(key) })
    expect(hubCalls().some((c) => c.path === 'remote.sendCommand')).toBe(false)
  })

  it('a refusal is said in words', async () => {
    mountIr({ 'remote.sendCommand': { status: 'refused', reason: 'action-failed' } })
    await screen.findByText('On')
    act(() => { fireEvent.click(screen.getByLabelText('Remote')) })
    const pw = await screen.findByTestId('remote-key-pw')
    act(() => { fireEvent.click(pw) })
    expect(await screen.findByText('The command could not be sent.')).toBeTruthy()
  })
})

describe('player without a remote (Echo, HA players)', () => {
  const ECHO = { state: 'paused', stateSource: 'reported', assumedFields: [], volumeLevel: 40, isMuted: false, source: '', availableSources: [], currentMedia: null }
  it('keeps the transport row and offers no remote, power or step buttons', async () => {
    mountScreen(
      React.createElement(MediaPlayerControl, { deviceId: 9, online: true, features: ['media-player-volume', 'media-player-power'] }),
      { hub: { 'mediaPlayer.getStatus': ECHO } },
    )
    expect(await screen.findByLabelText('Previous')).toBeTruthy()
    expect(screen.getByLabelText('Play')).toBeTruthy()
    expect(screen.getByLabelText('Stop')).toBeTruthy()
    expect(screen.getByLabelText('Next')).toBeTruthy()
    expect(screen.queryByLabelText('Remote')).toBeNull()
    expect(screen.queryByLabelText('Turn on')).toBeNull()
    expect(screen.queryByLabelText('Volume up')).toBeNull()
  })

  it('an unanswered status offers Play, not a claimed idle', async () => {
    mountScreen(
      React.createElement(MediaPlayerControl, { deviceId: 9, online: true }),
      { hub: { 'mediaPlayer.getStatus': { state: 'unheard-of' } } },
    )
    expect(await screen.findByLabelText('Play')).toBeTruthy()
    expect(screen.queryByText('Idle')).toBeNull()
  })

  it('a player with steps and no level gains the two step buttons', async () => {
    mountScreen(
      React.createElement(MediaPlayerControl, { deviceId: 9, online: true, features: ['media-player-volume-step'] }),
      { hub: { 'mediaPlayer.getStatus': ECHO, 'mediaPlayer.volumeDown': undefined } },
    )
    expect(await screen.findByLabelText('Volume down')).toBeTruthy()
    expect(screen.getByLabelText('Volume up')).toBeTruthy()
  })
})
