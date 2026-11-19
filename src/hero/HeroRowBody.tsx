/**
 * HeroRowBody — a device row built from `hero-layout.getRowModels` and nothing
 * else: scene tile, name (never the room), the primary control, the
 * trailing fact (tablet width and up, like the web row), chevron.
 *
 * The status line is not drawn: the scene tile carries the state (icon and
 * tone), the primary control carries on/off, and the trailing fact carries the
 * measurement the status line used to repeat. The name IS drawn — a room
 * caption alone cannot tell two devices of one room apart.
 *
 * `model` is always a real model (D315): a pending or failed batch, or a hub
 * with no row for the device, draws the legacy row instead. A model whose
 * `primary` is null (a cap the hero does not cover yet) draws `fallbackControl`; a primary
 * the hub GATED (`primaryGated`) is read-only and draws nothing.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { HeroControl, HeroRowModel, HeroTone, REMOTE_OPEN_ACTION_ID } from '@camstack/types'
import { useRouter } from 'expo-router'
import { CatalogIcon } from '../components/CatalogIcon.js'
import { OfflineBadge } from '../components/device/OfflineBadge.js'
import { isDeviceOffline } from '../components/device/device-reachability.js'
import { hapticTap } from '../lib/haptics.js'
import { ChevronRight, RemoteControl } from '../lib/icons.js'
import { useCanActuate } from '../hooks/use-user-scope.js'
import { remoteRoute } from '../remote/remote-route.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import { HeroControlView } from './HeroControlView.js'
import { HeroIconGroup, isGroupablePress } from './HeroIconGroup.js'
import { HeroSceneTile } from './HeroSceneTile.js'
import { PressableSceneTile } from './PressableSceneTile.js'
import { isPrimaryGated } from './hero-parse.js'
import { heroLocale, rowView, toneColor } from './hero-view.js'
import { RowArmContext, useArmedConfirm, type RowArm } from './row-arm.js'
import { armCaptionKey, resolveTileAction, type TileAction } from './tile-action.js'
import { tileStateKey } from './tile-press.js'
import { useHeroCaller, type HeroCaller } from './use-hero.js'
import { useTileCommand } from './use-tile-command.js'

/** Width from which the trailing fact is drawn: the web row's `sm` breakpoint. */
export const ROW_FACT_MIN_WIDTH = 640

export interface HeroRowBodyProps {
  readonly deviceId: number
  /** What the row is called: the operator's local name, else the hub's (never the model's own). */
  readonly name: string
  readonly online: boolean
  /** A real model: a row without one is the legacy row, drawn by the caller. */
  readonly model: HeroRowModel
  /** An icon the operator picked on this phone; replaces the state icon, keeps the tone. */
  readonly customIcon?: string | null
  /** Local and hidden badges, under the name. Never the room. */
  readonly caption?: string | null
  /**
   * Drawn in the control zone when the hub's row model carries no control for a
   * device that still has one: `hero-layout` does not cover every cap yet (the
   * `LATER_PHASE` entries of `hero-cap-coverage.ts`: climate, lock, cover,
   * brightness, alarm, fan, vacuum…). Removing it would drop a working control;
   * it goes away as each cap gains a hero contribution.
   */
  readonly fallbackControl?: React.ReactNode
  /**
   * A shortcut cluster (a cover's up / stop / down) drawn in the control zone
   * INSTEAD of the model's single primary control, which cannot express it.
   */
  readonly shortcuts?: React.ReactNode
  readonly onOpen: () => void
  readonly openLabel: string
}

/** The action id the row opens the remote with; typed against the hub's constant (type-only import). */
const REMOTE_OPEN: typeof REMOTE_OPEN_ACTION_ID = 'remote.open'

/** `primary` then the hub's `extras` (absent on an older hub = today's single control). */
export function rowControls(model: HeroRowModel): readonly HeroControl[] {
  return model.primary === null ? [] : [model.primary, ...(model.extras ?? [])]
}

/** Two or more controls, every one a plain press (an automation's run · enabled): one icon group. */
function groupedPresses(controls: readonly HeroControl[]): boolean {
  return controls.length >= 2 && controls.every(isGroupablePress)
}

function isRemoteOpen(control: HeroControl): boolean {
  return control.kind === 'action' && control.action.id === REMOTE_OPEN
}

interface RowSceneTileProps {
  readonly deviceId: number
  readonly name: string
  readonly action: TileAction
  readonly stateKey: string
  readonly caller: HeroCaller
  readonly arm: RowArm
  readonly icon: string
  readonly tone: HeroTone
  readonly muted: boolean
}

/** The scene tile as a button: the press, the wait for the device's report, the failure. */
function RowSceneTile({ deviceId, name, action, stateKey, caller, arm, icon, tone, muted }: RowSceneTileProps): React.JSX.Element {
  const { t } = useTranslation()
  const command = useTileCommand({ action, stateKey, caller, arm })
  return (
    <PressableSceneTile
      command={command}
      accessibilityLabel={t('v2.hero.tilePress', { name })}
      icon={icon}
      tone={tone}
      muted={muted}
      testID={`hero-row-scene-${deviceId}`}
    />
  )
}

/** One row: it owns the double-tap arm its tile and its lock's "Open door" share. */
export function HeroRowBody(props: HeroRowBodyProps): React.JSX.Element {
  const arm = useArmedConfirm()
  return (
    <RowArmContext.Provider value={arm}>
      <HeroRowContent {...props} arm={arm} />
    </RowArmContext.Provider>
  )
}

function HeroRowContent({ deviceId, name, online, model, customIcon = null, caption = null, fallbackControl = null, shortcuts = null, onOpen, openLabel, arm }: HeroRowBodyProps & { readonly arm: RowArm }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const caller = useHeroCaller(deviceId)
  const router = useRouter()
  const controls = rowControls(model)
  const locale = heroLocale(i18n.language)
  const view = rowView(model, locale)
  const offline = isDeviceOffline(online)
  const showFact = view.trailing !== null && width >= ROW_FACT_MIN_WIDTH
  const canActuate = useCanActuate()
  const tileAction = resolveTileAction({ type: model.type, online, canActuate, model })
  const sceneIcon = customIcon ?? view.icon
  const sceneMuted = !online || view.muted
  // A confirmed press (unlock, open the door) is asked in the row, never in a dialog.
  const armedCaption = arm.armedId === null ? null : t(armCaptionKey(arm.armedId))
  return (
    <View style={[styles.row, { borderBottomColor: colors.borderSubtle }]} testID={`hero-row-${deviceId}`}>
      {tileAction === null ? (
        <HeroSceneTile icon={sceneIcon} tone={view.tone} muted={sceneMuted} testID={`hero-row-scene-${deviceId}`} />
      ) : (
        <RowSceneTile
          deviceId={deviceId}
          name={name}
          action={tileAction}
          stateKey={tileStateKey(model)}
          caller={caller}
          arm={arm}
          icon={sceneIcon}
          tone={view.tone}
          muted={sceneMuted}
        />
      )}
      <View style={styles.label}>
        <Text testID={`hero-row-name-${deviceId}`} style={[styles.name, { color: offline ? colors.foregroundMuted : colors.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        {/* The row carries no status line; offline is the one state it names, so a
            device the hub cannot reach never reads as a switched-off one. */}
        {offline ? <OfflineBadge online={online} testID={`device-offline-${deviceId}`} /> : null}
        {armedCaption !== null ? (
          <Text testID={`hero-row-armed-${deviceId}`} style={[styles.caption, { color: colors.warning }]} numberOfLines={1}>
            {armedCaption}
          </Text>
        ) : caption !== null && caption !== '' ? (
          <Text testID={`hero-row-caption-${deviceId}`} style={[styles.caption, { color: colors.foregroundSubtle }]} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {shortcuts !== null ? (
        <View style={styles.control} testID={`hero-row-shortcuts-${deviceId}`}>
          {shortcuts}
        </View>
      ) : controls.length > 0 ? (
        <View style={styles.controls}>
          {groupedPresses(controls) ? (
            <HeroIconGroup controls={controls} locale={locale} caller={caller} online={online} />
          ) : controls.map((control) =>
            isRemoteOpen(control) ? (
              <Pressable
                key={REMOTE_OPEN}
                onPress={() => {
                  hapticTap()
                  router.push(remoteRoute(deviceId, name))
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t('v2.hero.remote')}
                testID={`hero-row-remote-${deviceId}`}
                style={[styles.remote, { borderColor: colors.borderSubtle }]}
              >
                <RemoteControl size={18} color={colors.foreground} />
              </Pressable>
            ) : (
              <HeroControlView key={control.kind === 'action' ? control.action.id : control.id} control={control} locale={locale} caller={caller} online={online} />
            ),
          )}
        </View>
      ) : fallbackControl !== null && !isPrimaryGated(model) ? (
        <View style={styles.control}>{fallbackControl}</View>
      ) : null}
      {showFact && view.trailing !== null ? (
        <View style={styles.fact} testID={`hero-row-fact-${deviceId}`}>
          {view.trailing.icon !== null ? (
            <CatalogIcon iconKey={view.trailing.icon} size={14} color={toneColor(view.trailing.tone, colors)} />
          ) : null}
          <Text style={[styles.factText, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {view.trailing.text}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={() => {
          hapticTap()
          onOpen()
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        testID={`accessory-detail-${deviceId}`}
        style={styles.chevron}
      >
        <ChevronRight size={18} color={colors.foregroundSubtle} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: 64,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1, minWidth: 100, gap: 2 },
  name: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
  caption: { fontSize: TYPOGRAPHY.size.xs },
  // Shrinks (and wraps its own cluster) before it can squeeze the name to nothing.
  control: { flexShrink: 1, maxWidth: '55%' },
  controls: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  remote: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexShrink: 0, maxWidth: 120 },
  factText: { fontSize: TYPOGRAPHY.size.sm },
  chevron: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
})
