/**
 * SemanticSearchBar — the CLIP text-search input for the events page.
 *
 * The search runs ON CONFIRM, never while typing. It used to run off a 350 ms
 * debounce of the raw input, which meant a server-side CLIP query per pause in
 * a word — "person in red" is four or five embeddings and four or five result
 * sets, all but the last discarded, against a hub the events page is already
 * the heaviest client of.
 *
 * So the field owns a DRAFT (`value`, parent-controlled) and reports it via
 * `onSubmit` when the operator confirms — the magnifier button, the keyboard's
 * `search` key, or `onSubmitEditing` on any platform. CLEARING is the one
 * action that still applies immediately: the X is how you get your grid back,
 * and making that require a second tap would be the annoyance the confirm is
 * meant to remove.
 */
import React, { memo, useCallback } from 'react'
import { View, TextInput, Pressable, StyleSheet } from 'react-native'
import { Search, X } from '../../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SCREEN_GUTTER, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'

export interface SemanticSearchBarProps {
  /** The DRAFT text. Typing it changes nothing else. */
  readonly value: string
  readonly onChange: (text: string) => void
  /** Apply the draft — magnifier tap or keyboard submit. */
  readonly onSubmit: (text: string) => void
  /** Clear the draft AND the applied search, immediately. */
  readonly onClear: () => void
  /** True when the draft differs from what is currently applied — lights the
   *  confirm button so an unapplied edit is visible rather than silent. */
  readonly dirty?: boolean
}

export const SemanticSearchBar = memo(function SemanticSearchBar({
  value, onChange, onSubmit, onClear, dirty = false,
}: SemanticSearchBarProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()

  const submit = useCallback(() => {
    onSubmit(value)
  }, [onSubmit, value])

  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={submit}
        placeholder={t('v2.tracks.searchPlaceholder', 'Search events (e.g. "person in red")')}
        placeholderTextColor={colors.foregroundSubtle}
        style={[styles.input, { color: colors.foreground }]}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={onClear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('v2.tracks.searchClear')}
        >
          <X size={16} color={colors.foregroundMuted} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={submit}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('v2.tracks.searchSubmit')}
        style={[styles.submit, { backgroundColor: dirty ? colors.primary : 'transparent' }]}
      >
        <Search size={16} color={dirty ? colors.primaryForeground : colors.foregroundMuted} />
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    // The Library's one gutter (`SCREEN_GUTTER`), the filter row's and the
    // grid's: at `SPACING.md` this field stood 8 pt wider than both on each
    // side, and its 15 pt type was a size nothing else in the header uses.
    marginHorizontal: SCREEN_GUTTER,
    marginBottom: SPACING.sm,
  },
  input: { flex: 1, fontSize: TYPOGRAPHY.size.md, paddingVertical: SPACING.xs },
  submit: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
