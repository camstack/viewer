/**
 * @vitest-environment jsdom
 *
 * The grid share dialog (operator-approved, 2026-10-21): the link carries a
 * `{TOKEN}` placeholder; a token minted here for the grid's cameras fills it;
 * an existing token is offered only when it covers EVERY camera, and picking
 * it keeps the placeholder (its secret is never shown again); the Home
 * Assistant card needs no token.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { GridShareDialog } from '../GridShareDialog.js'
import type { Grid } from '../../../store/grid-store.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)
vi.mock('../../../app/ServerProvider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../app/ServerProvider.js')>()
  return {
    ...actual,
    useServer: () => ({ ...actual.useServer(), server: { id: 's1', serverUrl: 'https://hub.test' } }),
  }
})

const DAY = 86_400_000
const NOW = Date.now()
const GRID: Grid = { id: 'g1', name: 'Wall', serverId: 's1', cameraIds: [1, 2] }

const row = (id: string, deviceIds: number[]) => ({
  id,
  subjectId: 'u1',
  label: `Token ${id}`,
  scopes: [{ type: 'share-view', grant: { kind: 'grid-view', deviceIds } }],
  createdAt: NOW - DAY,
  expiresAt: NOW + 10 * DAY,
  lastUsedAt: null,
  revokedAt: null,
})

const HUB = {
  'auth.me': { id: 'u1', username: 'operator', isAdmin: false },
  'auth.listTokens': [row('covers', [1, 2, 3]), row('partial', [1])],
  'auth.mintToken': { token: 'minted.jwt', record: row('new', [1, 2]) },
}

afterEach(cleanup)

const snippet = (): string => screen.getByTestId('share-snippet').textContent ?? ''

describe('GridShareDialog', () => {
  it('shows the link with the placeholder, then fills it with a token minted for the grid', async () => {
    mountScreen(React.createElement(GridShareDialog, { grid: GRID, onClose: () => {} }), { hub: HUB })
    expect(snippet()).toContain('#t={TOKEN}')
    expect(snippet()).toContain('devices=1,2')
    act(() => {
      fireEvent.click(screen.getByTestId('share-token-create'))
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.mintToken')?.input).toEqual({
        label: 'Wall',
        scopes: [{ type: 'share-view', grant: { kind: 'grid-view', deviceIds: [1, 2] } }],
        expiresIn: 30 * 86_400,
      })
    })
    await waitFor(() => expect(snippet()).toContain('#t=minted.jwt'))
    expect(snippet()).not.toContain('{TOKEN}')
  })

  it('offers only the tokens covering every camera, and keeps the placeholder for one', async () => {
    mountScreen(React.createElement(GridShareDialog, { grid: GRID, onClose: () => {} }), { hub: HUB })
    act(() => {
      fireEvent.click(screen.getByText('Existing token'))
    })
    const covering = await screen.findByTestId('share-token-existing-covers')
    expect(screen.queryByTestId('share-token-existing-partial')).toBeNull()
    act(() => {
      fireEvent.click(covering)
    })
    expect(snippet()).toContain('#t={TOKEN}')
    expect(screen.getByText(/never shown again/)).toBeTruthy()
  })

  it('the Home Assistant card carries no token and no token choice', () => {
    mountScreen(React.createElement(GridShareDialog, { grid: GRID, onClose: () => {} }), { hub: HUB })
    act(() => {
      fireEvent.click(screen.getByText('Home Assistant'))
    })
    expect(snippet()).toContain('type: custom:camstack-grid-card')
    expect(snippet()).not.toContain('{TOKEN}')
    expect(screen.queryByTestId('share-token-panel')).toBeNull()
  })
})
