/**
 * EventKindTree — the macro → sub event-kind picker, shared by every filter.
 *
 * Extracted from `EventsFilterPanel` on 2026-08-01 so the camera timeline's
 * filter can offer the SAME taxonomy. It could not before: the timeline listed
 * only the detection classes present in the loaded window, so a class that had
 * not happened today was un-selectable — and the operator could not express
 * "show me deliveries" on a quiet camera at all.
 *
 * `descriptors` is the server's taxonomy (`useEventKinds`) — pass the query's
 * `data` STRAIGHT THROUGH, including `undefined` while it is in flight. The
 * section renders a loading row then. `observedClasses` are the distinct
 * classes of the rows the caller has LOADED: with a taxonomy they join it as
 * extra macro rows wherever it omits them (2026-09-11: the hub advertised no
 * detection class for a camera armed on motion while its timeline showed 95
 * `person`), and they are the whole flat list ONLY when the query settled and
 * the hub advertised none (older server). Collapsing `undefined` into `[]` at
 * a call site re-creates the 2026-08-01 regression: every cold open showed
 * the lesser flat list. Selection is OWNED BY THE CALLER: the events page
 * keeps it in `events-filter-store`, the timeline in per-camera camera-local, and
 * neither shape belongs in here.
 */
import React, { memo, useMemo, useState } from 'react'
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Check } from '../../lib/icons.js'

import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import {
  expandMacroSelection,
  resolveEventKindTreeSource,
  type EventKindDescriptor,
  type EventKindTreeNode,
} from '../../data/event-kinds.js'
import { macroCheckState, selectedMacroKinds } from '../../store/track-filter.js'
import { resolveEventKindIcon, eventKindLabel } from './event-kind-icons.js'
import { SectionLabel } from '../ui/SectionLabel.js'

interface EventKindTreeSectionProps {
  /** The taxonomy query's data — `undefined` while STILL IN FLIGHT (renders a
   *  loading row, never the fallback), `[]` when the hub advertises none. */
  readonly descriptors: readonly EventKindDescriptor[] | undefined
  readonly observedClasses: readonly string[]
  readonly selected: readonly string[]
  readonly onToggleClass: (kind: string) => void
  readonly onSetClasses: (classes: readonly string[]) => void
  /**
   * Back to the surface's DEFAULT preset, offered next to the section count.
   *
   * A surface whose default is a narrowing needs a way back to it that is not
   * "re-tick the twenty-nine rows you did not mean to change". Absent on a
   * surface with no preset (the per-camera timeline), and the header simply
   * does not draw the button then.
   */
  readonly onReset?: () => void
  readonly resetLabel?: string
  /** True when the preset is what is live — the button reads as the current
   *  state rather than as an action with no visible effect. */
  readonly resetActive?: boolean
}

export const EventKindTreeSection = memo(function EventKindTreeSection({
  descriptors, observedClasses, selected, onToggleClass, onSetClasses,
  onReset, resetLabel, resetActive = false,
}: EventKindTreeSectionProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const selectedSet = useMemo(() => new Set(selected), [selected])
  // Loading / taxonomy / fallback — the fallback ONLY when the query SETTLED
  // and the hub advertised nothing, never while it is still in flight.
  const source = useMemo(
    () => resolveEventKindTreeSource(descriptors, observedClasses),
    [descriptors, observedClasses],
  )

  const q = query.trim().toLowerCase()
  const matches = (d: EventKindDescriptor): boolean =>
    q.length === 0 || eventKindLabel(d, t).toLowerCase().includes(q)

  const toggleMacro = (node: EventKindTreeNode): void => {
    const ids = expandMacroSelection(node.macro.kind, descriptors ?? [])
    const next = new Set(selectedSet)
    if (selectedSet.has(node.macro.kind)) {
      for (const id of ids) next.delete(id)
    } else {
      for (const id of ids) next.add(id)
    }
    onSetClasses([...next])
  }

  const toggleExpand = (kind: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  /**
   * MACROS touched, not raw ids — the basis every number on this panel shares.
   *
   * It reported `selectedSet.size` and the chip above it reported macros, so
   * one state produced "5" here and "4" there over a tree with nothing visibly
   * ticked. Three numbers on one panel, none of them the tree.
   */
  const selectedCount = selectedMacroKinds(selected, descriptors).length

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <SectionLabel level="group" style={styles.sectionLabel}>
          {t('v2.events.eventKinds', 'Event types')}
        </SectionLabel>
        <View style={styles.sectionHeadRight}>
          {onReset !== undefined ? (
            <Pressable
              onPress={onReset}
              accessibilityRole="button"
              accessibilityState={{ selected: resetActive }}
              style={[
                styles.resetChip,
                { backgroundColor: resetActive ? colors.primary : colors.surface },
              ]}
            >
              <Text
                style={[
                  styles.resetChipText,
                  { color: resetActive ? colors.primaryForeground : colors.foregroundMuted },
                ]}
              >
                {resetLabel ?? t('v2.events.useDefaultClasses', 'Default')}
              </Text>
            </Pressable>
          ) : null}
          <Text style={[styles.sectionCount, { color: colors.foregroundSubtle }]}>
            {selectedCount > 0 ? `${selectedCount}` : t('v2.events.all', 'All')}
          </Text>
        </View>
      </View>
      {source.state === 'loading' ? (
        // Honest "still fetching" — a search box over a list that is not there
        // yet, or the fallback, would both read as the final answer.
        <View style={styles.loadingRow} accessibilityLabel={t('common.loading', 'Loading...')}>
          <ActivityIndicator size="small" color={colors.foregroundSubtle} />
        </View>
      ) : (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('v2.events.searchClasses', 'Search classes…')}
          placeholderTextColor={colors.foregroundSubtle}
          style={[styles.search, { backgroundColor: colors.surface, color: colors.foreground }]}
        />
      )}

      {source.state === 'fallback' ? (
        <View style={styles.list}>
          {observedClasses
            .filter((c) => q.length === 0 || c.toLowerCase().includes(q))
            .map((c) => (
              <CheckRow
                key={c}
                // Il ramo `fallback` rendeva la classe GREZZA (`dog`, `car`)
                // mentre i due rami sotto passano da `eventKindLabel`. Qui il
                // server non ha dato una tassonomia, quindi non esiste un
                // descrittore: si costruisce quello minimo che il locale usa
                // gia' (`eventKind.<classe>`), con la classe grezza come
                // fallback se la chiave manca. E' il ramo che si vede proprio
                // quando l'operatore ha MENO contesto per interpretare una
                // parola inglese, quindi era il posto peggiore dove lasciarla.
                label={eventKindLabel({ labelKey: `eventKind.${c}`, label: c }, t)}
                selected={selectedSet.has(c)}
                onPress={() => onToggleClass(c)}
              />
            ))}
        </View>
      ) : source.state === 'taxonomy' ? (
        <View style={styles.list}>
          {source.tree.map((node) => {
            const macroMatch = matches(node.macro)
            const shownSubs = node.subs.filter(matches)
            // Hide a macro whose label AND every sub label miss the query.
            if (!macroMatch && shownSubs.length === 0) return null
            const isOpen = expanded.has(node.macro.kind) || q.length > 0
            const MacroIcon = resolveEventKindIcon(node.macro.iconId)
            const hasSubs = node.subs.length > 0
            return (
              <View key={node.macro.kind}>
                <View style={styles.macroRow}>
                  {hasSubs ? (
                    <Pressable onPress={() => toggleExpand(node.macro.kind)} hitSlop={8} style={styles.expandBtn}>
                      {isOpen ? (
                        <ChevronDown size={16} color={colors.foregroundSubtle} />
                      ) : (
                        <ChevronRight size={16} color={colors.foregroundSubtle} />
                      )}
                    </Pressable>
                  ) : (
                    <View style={styles.expandBtn} />
                  )}
                  <CheckRow
                    label={eventKindLabel(node.macro, t)}
                    icon={MacroIcon}
                    iconColor={node.macro.color}
                    selected={selectedSet.has(node.macro.kind)}
                    // A macro whose SUBS are ticked but whose own id is not
                    // used to draw as fully empty, so a selection made of subs
                    // showed a tree with nothing ticked while the counts beside
                    // it insisted otherwise. A collapsed row must never hide
                    // that something under it is on.
                    partial={
                      macroCheckState(
                        node.macro.kind,
                        node.subs.map((sub) => sub.kind),
                        selectedSet,
                      ) === 'partial'
                    }
                    onPress={() => toggleMacro(node)}
                    style={styles.macroCheck}
                  />
                </View>
                {isOpen
                  ? shownSubs.map((sub) => {
                      const SubIcon = resolveEventKindIcon(sub.iconId)
                      return (
                        <View key={sub.kind} style={styles.subRow}>
                          <CheckRow
                            label={eventKindLabel(sub, t)}
                            icon={SubIcon}
                            iconColor={sub.color}
                            selected={selectedSet.has(sub.kind)}
                            onPress={() => onToggleClass(sub.kind)}
                          />
                        </View>
                      )
                    })
                  : null}
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
})

// ─── Rows ───────────────────────────────────────────────────────────────────

export interface CheckRowProps {
  /** Some descendant is selected while this row itself is not — see CheckRow. */
  readonly partial?: boolean
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
  readonly icon?: React.ComponentType<{ size?: number; color?: string }>
  readonly iconColor?: string
  readonly style?: object
}

export function CheckRow({
  label,
  selected,
  partial = false,
  onPress,
  icon: Icon,
  iconColor,
  style,
}: CheckRowProps) {
  const { colors } = useTheme()
  // `partial` is "something under this row is on" — drawn as a filled square
  // rather than a tick, so it can never be mistaken for the row itself being
  // selected, and never for nothing at all.
  const marked = selected || partial
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected ? true : partial ? 'mixed' : false }}
      style={[styles.optionRow, { backgroundColor: marked ? colors.primary + '22' : 'transparent' }, style]}
    >
      {Icon ? <Icon size={16} color={iconColor ?? colors.foregroundMuted} /> : null}
      <Text numberOfLines={1} style={[styles.optionLabel, { color: colors.foreground }]}>{label}</Text>
      <View style={[styles.checkbox, { borderColor: marked ? colors.primary : colors.border }]}>
        {selected ? <Check size={14} color={colors.primary} /> : null}
        {!selected && partial ? (
          <View style={[styles.partialMark, { backgroundColor: colors.primary }]} />
        ) : null}
      </View>
    </Pressable>
  )
}

// ─── Reusable searchable multiselect section (cameras) ──────────────────────────

interface MultiselectItem {
  readonly key: string
  readonly label: string
  readonly selected: boolean
}

interface SectionMultiselectProps {
  readonly title: string
  readonly items: readonly MultiselectItem[]
  readonly onToggle: (key: string) => void
  readonly emptyLabel: string
  /**
   * The search box. Present for a list the operator scrolls (cameras, dozens of
   * them); ABSENT for a closed set they can read at a glance — the Library's
   * five Type chips are a list nobody searches, and a box over five rows is
   * chrome that reads as "there is more below this". Omitted ⇒ `query`,
   * `onQuery` and `placeholder` are not required, so a caller with nothing to
   * search carries no unused state for it.
   */
  readonly query?: string
  readonly onQuery?: (q: string) => void
  readonly placeholder?: string
}

export const SectionMultiselect = memo(function SectionMultiselect({
  title, query, onQuery, placeholder, items, onToggle, emptyLabel,
}: SectionMultiselectProps) {
  const { colors } = useTheme()
  const selectedCount = items.filter((i) => i.selected).length

  return (
    <View style={styles.section}>
      <SectionLabel level="group" value={selectedCount > 0 ? `${selectedCount}` : emptyLabel} style={styles.sectionLabel}>
        {title}
      </SectionLabel>
      {onQuery !== undefined ? (
        <TextInput
          value={query ?? ''}
          onChangeText={onQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.foregroundSubtle}
          style={[styles.search, { backgroundColor: colors.surface, color: colors.foreground }]}
        />
      ) : null}
      <View style={styles.list}>
        {items.map((item) => (
          <CheckRow
            key={item.key}
            label={item.label}
            selected={item.selected}
            onPress={() => onToggle(item.key)}
          />
        ))}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  sectionHeadRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  partialMark: { width: 8, height: 8, borderRadius: 1 },
  resetChip: { paddingHorizontal: SPACING.md, paddingVertical: 2, borderRadius: RADIUS.xl },
  resetChipText: { fontSize: 11, fontWeight: '600' },
  checkbox: { width: 22, height: 22, borderRadius: RADIUS.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  expandBtn: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 1 },
  loadingRow: { alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.lg },
  macroCheck: { flex: 1 },
  macroRow: { flexDirection: 'row', alignItems: 'center' },
  optionLabel: { fontSize: 14, flexShrink: 1, marginRight: SPACING.sm, flex: 1 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, justifyContent: 'space-between', paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm + 2, borderRadius: RADIUS.md },
  search: { borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, fontSize: 14 },
  section: { gap: SPACING.xs },
  sectionCount: { fontSize: 11, marginTop: SPACING.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { flexShrink: 1, marginTop: SPACING.sm },
  subRow: { paddingLeft: SPACING['2xl'] },
})
