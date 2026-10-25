import React from 'react'
import { View, type ViewProps } from 'react-native'

const Passthrough = ({ children, style }: ViewProps): React.ReactElement => <View style={style}>{children}</View>

export const Tabs = Passthrough
export const TabList = Passthrough
export const TabSlot = (): React.ReactElement => React.createElement(View, null)
export const TabTrigger = Passthrough
