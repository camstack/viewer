/**
 * Layout contract for CamerasManageScreen's DraggableFlatList.
 *
 * Do not put `gap` on the scroll content box: on RN-web it paints space
 * without growing the scroll height, so the last rows are only visible
 * during overscroll and miss hit-testing. Row spacing is `marginBottom`
 * on each row instead.
 *
 * And the vertical stretch goes on `containerStyle`, never on `style`.
 * `react-native-draggable-flatlist@4` styles its outer `Animated.View` with
 * `containerStyle` and spreads the remaining props — `style` among them —
 * onto the inner FlatList. `flex: 1` on the inner list inside a wrapper whose
 * height is content-driven collapses the list to nothing, which is how
 * v1.0.337 fixed the hit-testing of the last rows and lost the whole list.
 */
import { SPACING } from '../theme/tokens.js'

export const CAMERAS_MANAGE_ROW_GAP = SPACING.md

export function camerasManageListContentStyle(safeBottom: number): {
  readonly padding: number
  readonly paddingBottom: number
} {
  return {
    padding: SPACING.md,
    paddingBottom: SPACING.md + safeBottom + SPACING['2xl'],
  }
}

/**
 * The stretch for the list's own wrapper. Passed as `containerStyle` so the
 * library lays the wrapper out at full height and the inner FlatList inherits
 * a real box to scroll inside.
 */
export const CAMERAS_MANAGE_CONTAINER_STYLE: { readonly flex: number } = { flex: 1 }
