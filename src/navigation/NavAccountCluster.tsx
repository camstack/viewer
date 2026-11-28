/**
 * NavAccountCluster — the item at the end of the navigation: the Activity
 * centre (only while it has something to show). The account is not here: the one
 * avatar sits at the left of the shell's top bar and opens the drawer.
 *
 * Shared by the phone bar (a row at its right edge) and the side rail (a column
 * at its foot) so both surfaces carry it the same way, drawn once.
 */
import type { ViewInstance } from 'react-native'
import React, { memo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { ActivityButton } from '../activity/ActivityButton.js'
import { SPACING } from '../theme/tokens.js'

export interface NavAccountClusterProps {
  readonly orientation: 'row' | 'column'
}

export const NavAccountCluster = memo(function NavAccountCluster({
  orientation,
}: NavAccountClusterProps): React.JSX.Element {
  const row = orientation === 'row'
  // The Activity popover opens against this block.
  const blockRef = useRef<ViewInstance>(null)
  return (
    <View ref={blockRef} collapsable={false} style={row ? styles.row : styles.column}>
      {/* Absent while the Activity centre has nothing undismissed. */}
      <ActivityButton menuAlign={row ? 'end' : 'start'} anchorRef={blockRef} />
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
