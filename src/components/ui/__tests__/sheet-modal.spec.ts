/**
 * @vitest-environment jsdom
 *
 * SheetModal — the one frame every sheet-style modal opens in. On the web (the
 * PWA, any window width) it is a CENTRED dialog; on a phone it stays a bottom
 * sheet. Asserted on the DOM react-native-web renders, both branches.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Pressable, Text } from 'react-native'

import { clampDrag, dragScrimFactor, shouldCloseOnRelease } from '../sheet-drag.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import {
  DIALOG_MAX_WIDTH,
  SheetModal,
  cardTranslateY,
  scrimOpacity,
  sheetAnimation,
  sheetBackdropStyle,
  sheetPresentation,
} from '../SheetModal.js'

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

function mount(onClose: () => void, onBackdropPress?: () => void) {
  return render(
    createElement(
      SheetModal,
      {
        visible: true,
        onClose,
        ...(onBackdropPress === undefined ? {} : { onBackdropPress }),
        backdropLabel: 'close-backdrop',
        testID: 'sheet-card',
        sheetStyle: { maxHeight: '80%', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
        children: createElement(
          Pressable,
          { accessibilityRole: 'button', accessibilityLabel: 'first-control', onPress: () => undefined },
          createElement(Text, null, 'Done'),
        ),
      },
    ),
  )
}

/**
 * react-native-web marks a modal ACTIVE (Esc handler, focus trap) when its
 * open animation ends — an event jsdom never fires on its own. Each ancestor
 * gets one; only the animated container (target === currentTarget) acts.
 */
function finishOpenAnimation(from: HTMLElement): void {
  act(() => {
    for (let el: HTMLElement | null = from; el !== null; el = el.parentElement) {
      // jsdom has no AnimationEvent, so React listens on the prefixed name.
      el.dispatchEvent(new Event('animationend', { bubbles: true }))
      el.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }))
    }
  })
}

describe('sheetPresentation — the one switch', () => {
  it('is a dialog on the web and a sheet on a phone', () => {
    expect(sheetPresentation('web')).toBe('dialog')
    expect(sheetPresentation('ios')).toBe('sheet')
    expect(sheetPresentation('android')).toBe('sheet')
  })

  it('centres a dialog and bottom-aligns a sheet, fading one and sliding the other', () => {
    expect(sheetBackdropStyle('dialog')).toMatchObject({ justifyContent: 'center', alignItems: 'center' })
    expect(sheetBackdropStyle('sheet')).toMatchObject({ justifyContent: 'flex-end' })
    expect(sheetAnimation('dialog')).toBe('fade')
    expect(sheetAnimation('sheet')).toBe('none')
  })
})

describe('SheetModal on the web', () => {
  it('renders a centred, bounded dialog with every corner rounded', () => {
    setTestPlatform('web')
    mount(vi.fn())
    const card = screen.getByTestId('sheet-card')
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.getAttribute('aria-modal')).toBe('true')
    const style = getComputedStyle(card)
    expect(style.maxWidth).toBe(`${DIALOG_MAX_WIDTH}px`)
    expect(style.maxHeight).toBe('90%')
    expect(style.width).toBe('100%')
    expect(style.borderBottomLeftRadius).toBe('12px')
    expect(style.borderBottomRightRadius).toBe('12px')
    expect(style.overflowY).toBe('hidden')
    const backdrop = card.parentElement
    expect(backdrop).not.toBeNull()
    expect(getComputedStyle(backdrop as HTMLElement).justifyContent).toBe('center')
  })

  it('closes on Escape', () => {
    setTestPlatform('web')
    const onClose = vi.fn()
    mount(onClose)
    finishOpenAnimation(screen.getByTestId('sheet-card'))
    act(() => {
      fireEvent.keyUp(document, { key: 'Escape' })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('puts focus on the dialog own control, never on the backdrop', () => {
    setTestPlatform('web')
    mount(vi.fn())
    finishOpenAnimation(screen.getByTestId('sheet-card'))
    expect(screen.getByTestId('sheet-card').contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('first-control')
    expect(screen.getByLabelText('close-backdrop').getAttribute('tabindex')).toBe('-1')
  })

  it('a backdrop tap still closes it', () => {
    setTestPlatform('web')
    const onClose = vi.fn()
    mount(onClose)
    fireEvent.click(screen.getByLabelText('close-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('SheetModal on a phone', () => {
  it('stays a bottom sheet: no dialog role, the caller card style verbatim', () => {
    setTestPlatform('ios')
    const onBackdrop = vi.fn()
    mount(vi.fn(), onBackdrop)
    const card = screen.getByTestId('sheet-card')
    expect(card.getAttribute('role')).toBeNull()
    const style = getComputedStyle(card)
    expect(style.maxHeight).toBe('80%')
    expect(style.maxWidth).not.toBe(`${DIALOG_MAX_WIDTH}px`)
    const aligned: string[] = []
    for (let el = card.parentElement; el !== null; el = el.parentElement) aligned.push(getComputedStyle(el).justifyContent)
    expect(aligned).toContain('flex-end')
    fireEvent.click(screen.getByLabelText('close-backdrop'))
    expect(onBackdrop).toHaveBeenCalledTimes(1)
  })
})

describe('no bottom sheet bypasses the frame', () => {
  /**
   * A `<Modal animationType="slide">` written by hand is a bottom sheet the web
   * switch cannot reach. These are the full-screen surfaces that slide in on a
   * phone and are not sheets — everything else opens through `SheetModal`.
   */
  const FULL_SCREEN_SLIDES = [
    'src/components/camera/clips/ClipStageView.tsx',
    'src/components/media/MediaViewerModal.tsx',
  ]

  it('every hand-written sliding Modal is a full-screen surface', () => {
    const root = process.cwd()
    const out = execFileSync('grep', ['-rl', '--include=*.tsx', 'animationType="slide"', join(root, 'src')], {
      encoding: 'utf8',
    })
    const files = out
      .split('\n')
      .filter((line) => line.length > 0 && !line.includes('__tests__'))
      .map((line) => line.slice(root.length + 1))
      .sort()
    expect(files).toEqual([...FULL_SCREEN_SLIDES].sort())
  })
})

describe('SheetModal — the backdrop fades in place', () => {
  it('opacity follows the open progress, the card carries the travel', () => {
    expect(scrimOpacity(0)).toBe(0)
    expect(scrimOpacity(0.4)).toBe(0.4)
    expect(cardTranslateY(1, 600)).toBe(0)
    expect(cardTranslateY(0, 600)).toBe(600)
    expect(cardTranslateY(0.5, 600)).toBe(300)
  })

  it('on a phone the backdrop layer has no transform and the Modal does not slide', () => {
    setTestPlatform('ios')
    mount(() => undefined)
    const scrim = screen.getByTestId('sheet-card-scrim')
    expect(scrim.style.transform).toBeFalsy()
    expect(scrim.style.opacity).not.toBe('')
  })
})

describe('sheet drag-to-close', () => {
  it('closes past 30% of the card or on a fling, otherwise springs back', () => {
    expect(shouldCloseOnRelease(100, 0, 500)).toBe(false)
    expect(shouldCloseOnRelease(151, 0, 500)).toBe(true)
    expect(shouldCloseOnRelease(10, 900, 500)).toBe(true)
    expect(shouldCloseOnRelease(10, 799, 500)).toBe(false)
  })
  it('the card only follows downwards; the backdrop fades with the drag', () => {
    expect(clampDrag(-30)).toBe(0)
    expect(clampDrag(42)).toBe(42)
    expect(dragScrimFactor(0, 500)).toBe(1)
    expect(dragScrimFactor(250, 500)).toBe(0.5)
    expect(dragScrimFactor(900, 500)).toBe(0)
  })
})
