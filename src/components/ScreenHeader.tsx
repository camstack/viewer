import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import { ChevronLeft, type LucideIcon } from '../lib/icons.js'
import { GlassButton } from './ui/GlassButton.js'
import { GlassGroup } from './ui/GlassSurface.js'
import {
  HEADER_ACTION_GAP,
  HEADER_BUTTON_SIZE,
  HEADER_PADDING_BOTTOM,
  HEADER_PADDING_TOP,
  HEADER_PADDING_X,
  HEADER_SLOT_GAP,
  HEADER_SUBTITLE,
  HEADER_TITLE,
} from './screen-header-metrics.js'

/** One glass action button on the right of the header. */
export interface HeaderAction {
  readonly id: string
  readonly icon: LucideIcon
  /** Accessible name — the action, never the state. */
  readonly label: string
  readonly onPress: () => void
  readonly active?: boolean
  readonly disabled?: boolean
  readonly testID?: string
  /** Receives the button's box, for a menu that anchors to it (`measureInWindow`). */
  readonly anchorRef?: React.Ref<View>
  /**
   * Draw the label beside the icon — a glass PILL instead of a disc. For a
   * page's ONE primary action ("+ Person"); everything else stays an icon,
   * usually behind the page's `⋯` menu (`HeaderOverflowMenu`).
   */
  readonly showLabel?: boolean
}

interface ScreenHeaderProps {
  /** App-bar title (fills the available width between the slots). Optional: the
   *  tab nav already names the active section, so list screens omit it — the bar
   *  then just provides the safe-area inset + any left/right actions. */
  readonly title?: string
  /** A second, quieter line under the title (a count, a camera name). */
  readonly subtitle?: string
  /** Optional element before the title. Ignored if `onBack` is set. */
  readonly left?: React.ReactNode
  /** Glass action buttons after the title — the ONLY way a screen adds buttons here. */
  readonly actions?: readonly HeaderAction[]
  /** Non-button content after the actions (a text label, a status). */
  readonly right?: React.ReactNode
  /** When set, renders a glass back button on the left that calls this. */
  readonly onBack?: () => void
  /** Draw a bottom hairline. */
  readonly bordered?: boolean
  /**
   * Spend the top safe-area inset (default). `false` for a header drawn BELOW
   * something that already spent it (the Library's scope bar), so the notch is
   * cleared once, not twice.
   */
  readonly inset?: boolean
}

const pillStyles = StyleSheet.create({
  content: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  label: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
})

/**
 * The glass action buttons of a header — discs, and a pill for a labelled
 * (`showLabel`) primary action. Exported so a header row that is not a
 * `ScreenHeader` (the Library filter bar's right end) draws the SAME buttons
 * rather than a look-alike; `size` is the only thing such a row changes.
 */
export function HeaderActionCluster({
  actions,
  size = HEADER_BUTTON_SIZE,
}: {
  readonly actions: readonly HeaderAction[]
  readonly size?: number
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <GlassGroup style={{ flexDirection: 'row', alignItems: 'center', gap: HEADER_ACTION_GAP }}>
      {actions.map((a) => (
        <View key={a.id} ref={a.anchorRef} collapsable={false}>
          {a.showLabel === true ? (
            <GlassButton
              label={a.label}
              onPress={a.onPress}
              active={a.active}
              disabled={a.disabled}
              shape="pill"
              style={{ height: size }}
              contentStyle={[pillStyles.content, { height: size }]}
              testID={a.testID}
            >
              <a.icon size={Math.round(size * 0.42)} color={colors.foreground} />
              <Text style={[pillStyles.label, { color: colors.foreground }]} numberOfLines={1}>
                {a.label}
              </Text>
            </GlassButton>
          ) : (
            <GlassButton
              icon={a.icon}
              label={a.label}
              onPress={a.onPress}
              active={a.active}
              disabled={a.disabled}
              size={size}
              testID={a.testID}
            />
          )}
        </View>
      ))}
    </GlassGroup>
  )
}

/** THE back button: the glass chevron at a header's start — the app bar's,
 *  and the floating one over a grid wall. One call so the size and the label
 *  cannot drift between the three places that draw it. */
export function HeaderBackButton({ onPress, testID }: { readonly onPress: () => void; readonly testID?: string }) {
  const { t } = useTranslation()
  return <GlassButton icon={ChevronLeft} label={t('common.back')} onPress={onPress} size={HEADER_BUTTON_SIZE} testID={testID} />
}

/** The single place srcV2 applies the top safe-area inset, and THE header of
 *  every screen: a frosted app-bar (iOS/Android real blur, web backdrop-filter)
 *  with a glass back button, one title style and glass action buttons, all
 *  sized by `screen-header-metrics.ts`. Screens compose this instead of reading
 *  insets or drawing their own back/action buttons. */
export function ScreenHeader({ title, subtitle, left, actions, right, onBack, bordered = false, inset = true }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets()
  const { colors, mode } = useTheme()
  const { t } = useTranslation()
  const leftSlot = onBack ? (
    <HeaderBackButton onPress={onBack} testID="header-back" />
  ) : (
    left
  )

  return (
    <BlurView
      tint={mode === 'dark' ? 'dark' : 'light'}
      intensity={50}
      style={{
        borderBottomWidth: bordered ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: colors.border,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: HEADER_SLOT_GAP,
          paddingHorizontal: HEADER_PADDING_X,
          paddingTop: (inset ? insets.top : 0) + HEADER_PADDING_TOP,
          paddingBottom: HEADER_PADDING_BOTTOM,
          // Translucent tint over the blur — frosted look, legible everywhere
          // (incl. web/Android where the blur may render faint).
          backgroundColor: colors.background + 'a6',
        }}
      >
        {leftSlot}
        {/* Render the title line ONLY when there's a title — an empty <Text>
            still reserves a ~24px line, which read as extra/"double" space on
            the title-less list screens. A flex spacer keeps `right` aligned. */}
        {title ? (
          <View style={{ flex: 1 }}>
            <Text style={[HEADER_TITLE, { color: colors.foreground }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={[HEADER_SUBTITLE, { color: colors.foregroundSubtle }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {actions && actions.length > 0 ? <HeaderActionCluster actions={actions} /> : null}
        {right}
      </View>
    </BlurView>
  )
}
