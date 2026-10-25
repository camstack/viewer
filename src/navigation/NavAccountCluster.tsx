/**
 * NavAccountCluster — the items at the end of the navigation: the Activity
 * centre (only while it has something to show) and the account menu.
 *
 * Shared by the phone bar (a row at its right edge) and the side rail (a column
 * at its foot) so both surfaces carry the same two controls in the same order,
 * drawn once.
 */
import React, { memo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { ActivityButton } from '../activity/ActivityButton.js'
import { useViewportSize } from '../hooks/use-viewport-size.js'
import { SPACING } from '../theme/tokens.js'
import type { NavItemWrapper } from './BottomNavBar.js'
import { UserMenuButton } from './UserMenuButton.js'

/** Width from which the bar has room to print the user's name. */
const NAME_MIN_WIDTH = 560

export interface NavAccountClusterProps {
  readonly orientation: 'row' | 'column'
  /** `TabTrigger` wrapper for the Settings entry, when inside `<Tabs>` (see `settingsRoute`). */
  readonly wrapSettings?: NavItemWrapper
}

export const NavAccountCluster = memo(function NavAccountCluster({
  orientation,
  wrapSettings,
}: NavAccountClusterProps): React.JSX.Element {
  const { width } = useViewportSize()
  const row = orientation === 'row'
  // BOTH popovers open against this block (avatar + Activity), so they open in
  // the same place with the same width.
  const blockRef = useRef<View>(null)
  return (
    <View ref={blockRef} collapsable={false} style={row ? styles.row : styles.column}>
      {/* Before the avatar (left of it in the bar, above it in the rail), and
          absent while the Activity centre has nothing undismissed. */}
      <ActivityButton menuAlign={row ? 'end' : 'start'} anchorRef={blockRef} />
      <UserMenuButton
        showName={row && width >= NAME_MIN_WIDTH}
        menuAlign={row ? 'end' : 'start'}
        menuPlacement="above"
        anchorRef={blockRef}
        wrapSettings={wrapSettings}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xl,
  },
  column: {
    alignItems: 'center',
    gap: SPACING.lg,
    paddingTop: SPACING.lg,
  },
})
