/**
 * @vitest-environment jsdom
 *
 * The shared Library tile, MOUNTED: a tile without an image says so (icon +
 * "No image") instead of drawing an empty box, a failed image becomes that
 * placeholder, and the row's action reaches the page but not in selection mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import i18n from '../../../app/i18n.js'
import { Check } from '../../../lib/icons.js'
import { LibraryTile, type LibraryTileProps } from '../LibraryTile.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)
// A source that fails, the way a hub that refused the crop does.
vi.mock('expo-image', async () => {
  const R = await import('react')
  function Image(props: { source?: { uri?: string }; onError?: () => void }) {
    R.useEffect(() => {
      if (props.source?.uri?.includes('broken') === true) props.onError?.()
    }, [props.source?.uri])
    return R.createElement('img', { 'data-testid': 'tile-image', alt: '' })
  }
  return { Image, default: Image }
})

afterEach(cleanup)

const base: LibraryTileProps = {
  width: 185,
  source: null,
  when: '10:22 · 21/10',
  where: 'MARK-front-door',
  title: 'MARK-Alice',
  onPress: () => undefined,
  accessibilityLabel: 'tile',
  testID: 'tile',
}

function mount(props: Partial<LibraryTileProps> = {}) {
  return mountScreen(React.createElement(LibraryTile, { ...base, ...props }))
}

describe('LibraryTile', () => {
  it('without an image draws the placeholder with its text, not an empty box', () => {
    const { getByTestId, queryByTestId } = mount()
    expect(getByTestId('tile-placeholder').textContent).toBe(i18n.t('v2.library.noImage'))
    expect(queryByTestId('tile-image')).toBeNull()
  })

  it('draws the image it was given, and no placeholder', () => {
    const { getByTestId, queryByTestId } = mount({ source: { uri: 'https://hub/face.jpg' } })
    expect(getByTestId('tile-image')).toBeTruthy()
    expect(queryByTestId('tile-placeholder')).toBeNull()
  })

  it('turns a failed image into the placeholder', async () => {
    const { getByTestId } = mount({ source: { uri: 'https://hub/broken.jpg' } })
    await waitFor(() => expect(getByTestId('tile-placeholder')).toBeTruthy())
  })

  it('is a skeleton, not "No image", while its source is still being fetched', () => {
    const { queryByTestId } = mount({ loading: true })
    expect(queryByTestId('tile-placeholder')).toBeNull()
  })

  it('carries when and where on the image and one row with the title', () => {
    const { container } = mount()
    expect(container.textContent).toContain('10:22 · 21/10')
    expect(container.textContent).toContain('MARK-front-door')
    expect(container.textContent).toContain('MARK-Alice')
  })

  it('draws where and when as two separate full-width lines, camera first', () => {
    const { getByTestId } = mount()
    const where = getByTestId('tile-where')
    const when = getByTestId('tile-when')
    expect(where.textContent).toBe('MARK-front-door')
    expect(when.textContent).toBe('10:22 · 21/10')
    // Two siblings: never one text node (or one flex row) shared by both.
    expect(where.contains(when)).toBe(false)
    expect(where.nextElementSibling).toBe(when)
  })

  it('without a camera still draws the time line', () => {
    const { getByTestId, queryByTestId } = mount({ where: undefined })
    expect(queryByTestId('tile-where')).toBeNull()
    expect(getByTestId('tile-when').textContent).toBe('10:22 · 21/10')
  })

  it('runs the row action, and hides it in selection mode', () => {
    const onConfirm = vi.fn()
    const actions = [{ id: 'confirm', icon: Check, label: 'MARK-Assign', tone: 'primary' as const, onPress: onConfirm }]
    const first = mount({ actions })
    fireEvent.click(first.getByLabelText('MARK-Assign'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    first.unmount()
    const selecting = mount({ actions, selectionMode: true })
    expect(selecting.queryByLabelText('MARK-Assign')).toBeNull()
  })

  it('rows="two" gives the title its own full-width row; badge and action share the row under it', () => {
    const actions = [{ id: 'confirm', icon: Check, label: 'MARK-Assign', tone: 'primary' as const, onPress: () => undefined }]
    const badge = React.createElement('span', { 'data-testid': 'tile-badge' }, 'MARK-quasi certo')
    const { getByTestId } = mount({ rows: 'two', actions, badge })
    const row = getByTestId('tile-row')
    // The name is NOT on the badge's row — on one row the three overlapped.
    expect(row.contains(getByTestId('tile-title'))).toBe(false)
    expect(row.contains(getByTestId('tile-badge'))).toBe(true)
    expect(row.textContent).not.toContain('MARK-Alice')
    expect(getByTestId('tile-title').textContent).toBe('MARK-Alice')
  })

  it('the default single row keeps title, badge and action together', () => {
    const badge = React.createElement('span', { 'data-testid': 'tile-badge' }, 'MARK-quasi certo')
    const { getByTestId } = mount({ badge })
    expect(getByTestId('tile-row').contains(getByTestId('tile-title'))).toBe(true)
  })
})
