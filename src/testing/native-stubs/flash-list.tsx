/**
 * `FlashList` under jsdom renders through `FlatList` — the whole list, no
 * windowing. That is deliberate: a mount smoke test wants every row's render
 * path exercised, and a virtualised list would render none of them.
 */
import React from 'react'
import { FlatList, type FlatListProps } from 'react-native'

export type FlashListProps<T> = FlatListProps<T> & Record<string, unknown>

export function FlashList<T>(props: FlashListProps<T>): React.ReactElement {
  return React.createElement(FlatList as React.ComponentType<FlashListProps<T>>, props)
}

export type ListRenderItemInfo<T> = { item: T; index: number }
export type ListRenderItem<T> = (info: ListRenderItemInfo<T>) => React.ReactElement | null
export type FlashListRef<T> = { scrollToOffset: (o: { offset: number }) => void } & Record<
  string,
  unknown
> & { __item?: T }
