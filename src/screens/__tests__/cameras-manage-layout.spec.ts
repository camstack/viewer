/**
 * Cameras-manage list layout: last rows must rest above the home indicator
 * and remain tappable. `gap` on the scroll content box is forbidden — on
 * RN-web it paints space without growing scroll height, so the last cameras
 * are only visible during overscroll and miss hit-testing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SPACING } from '../../theme/tokens.js'
import {
  CAMERAS_MANAGE_CONTAINER_STYLE,
  camerasManageListContentStyle,
} from '../cameras-manage-layout.js'

const SCREEN_SRC = readFileSync(join(__dirname, '..', 'CamerasManageScreen.tsx'), 'utf8')

describe('camerasManageListContentStyle', () => {
  it('adds the safe-area below the uniform padding, without a content gap', () => {
    const style = camerasManageListContentStyle(34)
    expect(style.padding).toBe(SPACING.md)
    expect(style.paddingBottom).toBe(SPACING.md + 34 + SPACING['2xl'])
    expect('gap' in style).toBe(false)
  })

  it('still clears a resting thumb when the inset is zero (web chrome)', () => {
    const style = camerasManageListContentStyle(0)
    expect(style.paddingBottom).toBeGreaterThan(style.padding)
  })
})

/**
 * WHERE `flex: 1` GOES IS THE WHOLE BUG.
 *
 * `react-native-draggable-flatlist@4` renders an outer `Animated.View` styled
 * with `containerStyle` and spreads everything else — `style` included — onto
 * the INNER FlatList (`DraggableFlatList.tsx:378` and `:386`). Putting
 * `flex: 1` on `style` therefore stretches the inner list inside a wrapper
 * whose own height is content-driven, and the list collapses: the manage
 * screen renders no rows at all. That shipped in v1.0.337 while fixing the
 * hit-testing of the last rows, and it is why the list stopped working.
 *
 * The stretch belongs on the wrapper the library actually lays out.
 */
describe('cameras-manage list stretch', () => {
  it('stretches the DRAGGABLE WRAPPER, not the inner list', () => {
    expect(CAMERAS_MANAGE_CONTAINER_STYLE).toEqual({ flex: 1 })
  })

  it('the screen hands that stretch to `containerStyle`', () => {
    expect(SCREEN_SRC).toContain('containerStyle={CAMERAS_MANAGE_CONTAINER_STYLE}')
  })

  it('the screen never puts a bare `style` on the draggable list', () => {
    const listProps = SCREEN_SRC.slice(
      SCREEN_SRC.indexOf('<DraggableFlatList'),
      SCREEN_SRC.indexOf('/>', SCREEN_SRC.indexOf('<DraggableFlatList')),
    )
    expect(listProps).not.toMatch(/\bstyle=\{styles\.list\}/)
  })
})
