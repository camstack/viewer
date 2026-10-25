import React from 'react'
import { FlatList, type FlatListProps, View, type ViewProps } from 'react-native'

export interface RenderItemParams<T> {
  readonly item: T
  readonly getIndex: () => number | undefined
  readonly drag: () => void
  readonly isActive: boolean
}

export const ScaleDecorator = ({ children }: ViewProps): React.ReactElement => <View>{children}</View>

export type DraggableFlatListProps<T> = FlatListProps<T> & Record<string, unknown>

export default function DraggableFlatList<T>(props: DraggableFlatListProps<T>): React.ReactElement {
  return React.createElement(FlatList as React.ComponentType<DraggableFlatListProps<T>>, props)
}
