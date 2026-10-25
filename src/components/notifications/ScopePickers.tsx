/**
 * The system family's node and package pickers (D637): the device picker's UX
 * (chips, search, groups) over a different source — `ItemPicker<string>`. No
 * free text: a node id is minted by the cluster and a package name by the
 * registry, and a typed value that does not exist is a rule that can never
 * fire. The admin UI's `scope-pickers.tsx` is the same pair.
 *
 * Each reads its list only while the sheet is open or a stored id needs
 * naming — the same rule as `useDeviceCatalogue(open)`.
 *
 * What a stored id missing from the list reads as is `scope-pickers.helpers.ts`
 * (D315); every one stays a removable chip (D49). A node directory that is not
 * `complete` says so under the picker, because it may lack offline nodes the
 * hub does know.
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { SPACING } from '../../theme/tokens.js'
import { useAddonPackages } from '../../data/use-addon-packages.js'
import { useNodeDirectory } from '../../data/use-node-directory.js'
import type { PickerGroup } from './device-picker-model.js'
import { offListSelections, type SelectedDeviceRow } from './device-selection.js'
import { ItemPicker, PickerLine } from './ItemPicker.js'
import { nodeScopeState, packageScopeState, type ScopePickerState } from './scope-pickers.helpers.js'

const PICKER = 'v2.nc.devicePicker'

/** A node group's role (`nodePickerItems`' `type`) → its title key. */
const NODE_ROLE_KEY: Readonly<Record<string, string>> = {
  hub: `${PICKER}.nodeGroup.hub`,
  agent: `${PICKER}.nodeGroup.agent`,
}

/** A package group's kind (`packagePickerItems`' `type`) → its title key. */
const PACKAGE_KIND_KEY: Readonly<Record<string, string>> = {
  server: `${PICKER}.packageGroup.server`,
  framework: `${PICKER}.packageGroup.framework`,
  wrapper: `${PICKER}.packageGroup.wrapper`,
  addon: `${PICKER}.packageGroup.addon`,
}

export interface ScopePickerProps {
  readonly value: readonly string[]
  readonly onChange: (next: string[]) => void
  readonly testID?: string
}

/** The judged rows for the stored ids the drawn list lacks. */
function judgedOf(
  state: ScopePickerState<string>,
  value: readonly string[],
): SelectedDeviceRow<string>[] {
  return offListSelections(value, state.items, state.fleet.devices, state.fleet.state)
}

export function NodePicker({ value, onChange, testID }: ScopePickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const query = useNodeDirectory(open || value.length > 0)
  const state = nodeScopeState(query)
  const groupTitle = (group: PickerGroup<string>): string => {
    const role = t(NODE_ROLE_KEY[group.type ?? ''] ?? `${PICKER}.nodeGroup.other`)
    return group.location === 'offline' ? t(`${PICKER}.nodeGroup.offline`, { role }) : role
  }
  return (
    <View style={{ gap: SPACING.xs }}>
      <ItemPicker<string>
        items={state.items}
        state={state.listState}
        judged={judgedOf(state, value)}
        value={value}
        onChange={onChange}
        emptyMeansAll
        emptyLabel={t(`${PICKER}.everyNode`)}
        title={t(`${PICKER}.nodeTitle`)}
        widensLabel={t(`${PICKER}.nodesEmptyWidens`)}
        unavailableLabel={t(`${PICKER}.nodesUnavailable`)}
        searchLabel={t(`${PICKER}.nodeSearch`)}
        noMatchesLabel={t(`${PICKER}.nodeNoMatches`)}
        removedLabel={(id) => t(`${PICKER}.nodeRemoved`, { id })}
        unknownLabel={(id) => id}
        groupTitle={groupTitle}
        onOpenChange={setOpen}
        {...(testID !== undefined ? { testID } : {})}
      />
      {query.data?.complete === false ? (
        <View testID="node-directory-incomplete">
          <PickerLine text={t(`${PICKER}.nodeDirectoryIncomplete`)} />
        </View>
      ) : null}
    </View>
  )
}

export function PackagePicker({ value, onChange, testID }: ScopePickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const query = useAddonPackages(open || value.length > 0)
  const state = packageScopeState(query)
  const groupTitle = (group: PickerGroup<string>): string =>
    t(PACKAGE_KIND_KEY[group.type ?? ''] ?? `${PICKER}.packageGroup.other`)
  return (
    <ItemPicker<string>
      items={state.items}
      state={state.listState}
      judged={judgedOf(state, value)}
      value={value}
      onChange={onChange}
      emptyMeansAll
      emptyLabel={t(`${PICKER}.everyPackage`)}
      title={t(`${PICKER}.packageTitle`)}
      widensLabel={t(`${PICKER}.packagesEmptyWidens`)}
      unavailableLabel={t(`${PICKER}.packagesUnavailable`)}
      searchLabel={t(`${PICKER}.packageSearch`)}
      noMatchesLabel={t(`${PICKER}.packageNoMatches`)}
      removedLabel={(id) => t(`${PICKER}.packageNotInstalled`, { name: id })}
      unknownLabel={(id) => id}
      groupTitle={groupTitle}
      onOpenChange={setOpen}
      {...(testID !== undefined ? { testID } : {})}
    />
  )
}
