/**
 * @vitest-environment jsdom
 *
 * The row's left icon through the real tile: what a tap sends per type, the
 * lock's double-tap arm, a send in flight, and an offline or unread tile that
 * opens the device instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen as dom, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { QuickActionTile, type QuickActionTileProps } from '../QuickActionTile.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const ADMIN = { 'auth.me': { id: 'u1', username: 'operator', isAdmin: true } }

function mountTile(
  hub: Readonly<Record<string, unknown>>,
  props: Partial<QuickActionTileProps> & Pick<QuickActionTileProps, 'controlKind'>,
): { readonly onOpen: () => void } {
  const onOpen = vi.fn()
  mountScreen(
    React.createElement(QuickActionTile, {
      deviceId: 7, name: 'Lamp', online: true, icon: 'lightbulb', tone: 'warning', onOpen, openLabel: 'Open Lamp', ...props,
    }),
    { hub: { ...ADMIN, ...hub } },
  )
  return { onOpen }
}

const sent = (path: string): number => hubCalls().filter((c) => c.path === path).length

describe('QuickActionTile', () => {
  it('a switch tile flips power', async () => {
    mountTile({ 'switch.getStatus': { on: false }, 'switch.setState': {} }, { controlKind: 'switch' })
    fireEvent.click(await dom.findByRole('button', { name: 'Turn on Lamp' }))
    await waitFor(() => expect(hubCalls().find((c) => c.path === 'switch.setState')?.input).toMatchObject({ deviceId: 7, on: true }))
  })

  it('a cover tile closes an open cover', async () => {
    mountTile({ 'cover.getStatus': { state: 'open', position: 100 }, 'cover.close': {} }, { controlKind: 'cover', name: 'Shutter' })
    fireEvent.click(await dom.findByRole('button', { name: 'Close Shutter' }))
    await waitFor(() => expect(sent('cover.close')).toBe(1))
  })

  it('a cover tile stops a moving cover', async () => {
    mountTile({ 'cover.getStatus': { state: 'closing', position: 40 }, 'cover.stop': {} }, { controlKind: 'cover', name: 'Shutter' })
    fireEvent.click(await dom.findByRole('button', { name: 'Stop Shutter' }))
    await waitFor(() => expect(sent('cover.stop')).toBe(1))
  })

  it('a lock locks at once', async () => {
    mountTile({ 'lockControl.getStatus': { state: 'unlocked' }, 'lockControl.lock': {} }, { controlKind: 'lock', name: 'Door' })
    fireEvent.click(await dom.findByRole('button', { name: 'Lock Door' }))
    await waitFor(() => expect(sent('lockControl.lock')).toBe(1))
  })

  it('an unlock is armed by the first tap and sent by the second', async () => {
    mountTile({ 'lockControl.getStatus': { state: 'locked' }, 'lockControl.unlock': {} }, { controlKind: 'lock', name: 'Door' })
    const tile = await dom.findByRole('button', { name: 'Unlock Door' })
    fireEvent.click(tile)
    await new Promise((r) => setTimeout(r, 30))
    expect(sent('lockControl.unlock')).toBe(0)
    fireEvent.click(tile)
    await waitFor(() => expect(sent('lockControl.unlock')).toBe(1))
  })

  it('a lock mid-travel offers no action and opens the device', async () => {
    const { onOpen } = mountTile({ 'lockControl.getStatus': { state: 'unlocking' } }, { controlKind: 'lock', name: 'Door' })
    fireEvent.click(await dom.findByRole('button', { name: 'Open Lamp' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(sent('lockControl.unlock')).toBe(0)
  })

  it('a send in flight disables the tile: a second tap sends nothing', async () => {
    mountTile({ 'switch.getStatus': { on: false }, 'switch.setState': () => new Promise(() => undefined) }, { controlKind: 'switch' })
    const tile = await dom.findByRole('button', { name: 'Turn on Lamp' })
    fireEvent.click(tile)
    await waitFor(() => expect(sent('switch.setState')).toBe(1))
    fireEvent.click(tile)
    await new Promise((r) => setTimeout(r, 30))
    expect(sent('switch.setState')).toBe(1)
  })

  it('an offline tile opens the device and sends nothing', async () => {
    const { onOpen } = mountTile({ 'switch.getStatus': { on: false }, 'switch.setState': {} }, { controlKind: 'switch', online: false })
    fireEvent.click(await dom.findByRole('button', { name: 'Open Lamp' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(sent('switch.setState')).toBe(0)
  })

  it('a switch whose state cannot be read opens the device instead of guessing', async () => {
    const { onOpen } = mountTile({ 'switch.getStatus': () => { throw new Error('boom') } }, { controlKind: 'switch' })
    fireEvent.click(await dom.findByRole('button', { name: 'Open Lamp' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(sent('switch.setState')).toBe(0)
  })
})
