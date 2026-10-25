/**
 * @vitest-environment jsdom
 *
 * The shared pieces extracted on 2026-10-21 (operator: "anything used in at
 * least two places becomes a shared component"), MOUNTED:
 *
 *  - SectionLabel — one heading look, with an optional value at the end;
 *  - EmptyState / ErrorState — icon, title, body, one action; Retry on error;
 *  - SheetHeader / SheetIconButton — title, actions, the close button;
 *  - MediaBadge — a caption on a picture, or a switch when pressable;
 *  - GlassPanel — the menus' glass under a popover's content;
 *  - Button / ConfirmFooter — the text button and the Cancel + primary pair.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Text } from 'react-native'

import '../../../app/i18n.js'
import i18n from '../../../app/i18n.js'
import { ThemeProvider } from '../../../theme/theme-provider.js'
import { THEME, mediaScrim } from '../../../theme/tokens.js'
import { Plus, Trash2 } from '../../../lib/icons.js'
import { SectionLabel } from '../SectionLabel.js'
import { EmptyState, ErrorState } from '../EmptyState.js'
import { SheetHeader, SheetIconButton } from '../SheetHeader.js'
import { MediaBadge } from '../MediaBadge.js'
import { GlassPanel } from '../GlassPanel.js'
import { Button, ConfirmFooter } from '../Button.js'

vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }))

afterEach(cleanup)

function mount(el: React.ReactElement) {
  return render(React.createElement(ThemeProvider, null, el))
}

describe('SectionLabel', () => {
  // No heading role: react-native-web draws one as an <h1>, whose browser
  // margins pushed every section 8 px down on the web.
  it('states its words, and a value at the line end', () => {
    mount(React.createElement(SectionLabel, { value: '3', testID: 'lbl', children: 'Cameras' }))
    expect(screen.getByText('Cameras')).toBeTruthy()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByTestId('lbl').textContent).toBe('Cameras3')
  })
})

describe('EmptyState / ErrorState', () => {
  it('says what is empty and offers its one action', () => {
    const onPress = vi.fn()
    mount(
      React.createElement(EmptyState, {
        title: 'MARK-No faces',
        body: 'MARK-Faces appear here',
        action: { label: 'MARK-Clear filters', onPress },
      }),
    )
    expect(screen.getByText('MARK-No faces')).toBeTruthy()
    expect(screen.getByText('MARK-Faces appear here')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'MARK-Clear filters' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('draws no body and no button when it has none', () => {
    mount(React.createElement(EmptyState, { title: 'MARK-Nothing' }))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('an error offers Retry only when the page can retry', () => {
    const onRetry = vi.fn()
    const view = mount(React.createElement(ErrorState, { title: 'MARK-Failed', onRetry }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    view.unmount()
    mount(React.createElement(ErrorState, { title: 'MARK-Failed' }))
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('SheetHeader', () => {
  it('draws the title, the sheet\'s actions, then Close', () => {
    const onClose = vi.fn()
    const onDelete = vi.fn()
    mount(
      React.createElement(SheetHeader, {
        title: 'MARK-Pick a vehicle',
        onClose,
        actions: React.createElement(SheetIconButton, { icon: Trash2, tone: 'danger', label: 'MARK-Delete', onPress: onDelete }),
      }),
    )
    expect(screen.getByText('MARK-Pick a vehicle')).toBeTruthy()
    const buttons = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(buttons).toEqual(['MARK-Delete', i18n.t('v2.common.close')])
    fireEvent.click(screen.getByRole('button', { name: 'MARK-Delete' }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('v2.common.close') }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a disabled action does nothing', () => {
    const onPress = vi.fn()
    mount(React.createElement(SheetIconButton, { icon: Plus, label: 'MARK-Add', onPress, disabled: true }))
    fireEvent.click(screen.getByRole('button', { name: 'MARK-Add' }))
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('MediaBadge', () => {
  it('a caption is the theme\'s scrim, never a black overlay', () => {
    mount(React.createElement(MediaBadge, { label: 'MARK-Best shot · 640×480', testID: 'badge' }))
    const badge = screen.getByTestId('badge')
    expect(badge.textContent).toBe('MARK-Best shot · 640×480')
    // The default theme under test is light: a light scrim, dark text.
    expect(getComputedStyle(badge).backgroundColor).toBe(toRgb(mediaScrim(THEME.light)))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a pressable badge is a switch-like button that reports its state', () => {
    const onPress = vi.fn()
    mount(React.createElement(MediaBadge, { label: 'MARK-Full', onPress, active: true }))
    const button = screen.getByRole('button', { name: 'MARK-Full' })
    fireEvent.click(button)
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

describe('GlassPanel', () => {
  it('draws its content over the glass layer', () => {
    mount(React.createElement(GlassPanel, { testID: 'panel' }, React.createElement(Text, null, 'MARK-inside')))
    expect(screen.getByTestId('panel').textContent).toBe('MARK-inside')
    expect(screen.getByText('MARK-inside')).toBeTruthy()
  })
})

describe('Button / ConfirmFooter', () => {
  it('a busy button refuses a second press', () => {
    const onPress = vi.fn()
    mount(React.createElement(Button, { label: 'MARK-Save', onPress, busy: true }))
    fireEvent.click(screen.getByRole('button', { name: 'MARK-Save' }))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('the footer is Cancel then the primary; a read-only footer is Cancel alone', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const view = mount(
      React.createElement(ConfirmFooter, { cancelLabel: 'MARK-Cancel', onCancel, confirmLabel: 'MARK-Save', onConfirm }),
    )
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['MARK-Cancel', 'MARK-Save'])
    fireEvent.click(screen.getByRole('button', { name: 'MARK-Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'MARK-Cancel' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
    view.unmount()
    mount(React.createElement(ConfirmFooter, { cancelLabel: 'MARK-Back', onCancel }))
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('a disabled confirm does nothing', () => {
    const onConfirm = vi.fn()
    mount(
      React.createElement(ConfirmFooter, {
        cancelLabel: 'MARK-Cancel', onCancel: vi.fn(), confirmLabel: 'MARK-Save', onConfirm, confirmDisabled: true,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'MARK-Save' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

/** `rgba(r, g, b, a)` as jsdom reports it back. */
function toRgb(rgba: string): string {
  return rgba.replace(/\s+/g, ' ')
}
