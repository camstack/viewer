/**
 * UserAvatar — the round initial of the signed-in user. The one drawing of it:
 * the bar's avatar button, the drawer button and the drawer's bottom block all
 * render this, so the initial never looks different from one place to the next.
 */
import React, { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { useTheme } from '../theme/theme-provider.js'
import { userInitial } from './user-menu.js'

export const AVATAR_SIZE = 34

export interface UserAvatarProps {
  /** The signed-in user's name; `null` while it is not known (shows `?`). */
  readonly name: string | null
}

export const UserAvatar = memo(function UserAvatar({ name }: UserAvatarProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={[styles.avatar, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
      <Text style={[styles.initial, { color: colors.foreground }]}>{userInitial(name)}</Text>
    </View>
  )
})

const styles = StyleSheet.create({
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 14, fontWeight: '700' },
})
