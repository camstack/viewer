/**
 * TargetsTab — the Targets panel of the Notification Center. Lists the caller's
 * OWN delivery targets (server-scoped; no other user's rows) and hosts a
 * create/edit editor driven entirely by the kind catalog. All server access is
 * through the B1 `useNc*` hooks.
 *
 * Editor state machine (mirrors the admin `NotificationTargets` shape, adapted
 * to RN): `closed` → the list; `pick-kind` → choose a kind from
 * `useNcTargetKinds`; `form` → the kind-driven {@link TargetForm}. Per-row the
 * user can toggle the target on/off, send a test, edit, or delete it.
 */
import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Bell, Pencil, Plus, Send, Trash2 } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { Section } from '../../components/ui/Section.js'
import { Row } from '../../components/ui/Row.js'
import { ToggleRow } from '../../components/ui/ToggleRow.js'
import { useConfirm } from '../../components/ui/confirm.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { TargetForm } from '../../components/notifications/TargetForm.js'
import { NotifierIcon } from '../../components/notifications/NotifierIcon.js'
import {
  useNcDeleteTarget,
  useNcSetTargetEnabled,
  useNcTargetKinds,
  useNcTargets,
  useNcTestTarget,
} from '../../data/use-notification-center.js'
import type { Target, TargetKind } from '../../data/notification-center.js'
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.js'

type EditorState =
  | { readonly mode: 'closed' }
  | { readonly mode: 'pick-kind' }
  | { readonly mode: 'form'; readonly kind: TargetKind; readonly target: Target | null }

interface TestOutcome {
  readonly targetId: string
  readonly ok: boolean
  readonly error?: string
}

export function TargetsTab() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { colors } = useTheme()

  const targetsQuery = useNcTargets()
  const kindsQuery = useNcTargetKinds()
  const setEnabled = useNcSetTargetEnabled()
  const deleteTarget = useNcDeleteTarget()
  const testTarget = useNcTestTarget()

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' })
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null)

  const kinds = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data])
  const kindByKey = useMemo(() => {
    const map = new Map<string, TargetKind>()
    for (const kind of kinds) map.set(kind.kind, kind)
    return map
  }, [kinds])

  if (editor.mode === 'pick-kind') {
    return (
      <KindPicker
        kinds={kinds}
        loading={kindsQuery.isLoading}
        onCancel={() => setEditor({ mode: 'closed' })}
        onPick={(kind) => setEditor({ mode: 'form', kind, target: null })}
      />
    )
  }

  if (editor.mode === 'form') {
    return (
      <TargetForm
        kind={editor.kind}
        target={editor.target}
        onCancel={() => setEditor({ mode: 'closed' })}
        onSaved={() => setEditor({ mode: 'closed' })}
      />
    )
  }

  const targets = targetsQuery.data ?? []

  const confirmDelete = (target: Target): void => {
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.nc.targets.deleteConfirmTitle'),
        message: t('v2.nc.targets.deleteConfirmMessage', { name: target.name }),
        confirmLabel: t('v2.nc.targets.delete'),
        cancelLabel: t('v2.nc.targets.cancel'),
        destructive: true,
      })
      if (!ok) return
      deleteTarget.mutate({ targetId: target.id })
    })()
  }

  const runTest = (target: Target): void => {
    setTestOutcome(null)
    testTarget.mutate(
      { targetId: target.id },
      {
        onSuccess: (result) =>
          setTestOutcome({ targetId: target.id, ok: result.success, error: result.error }),
        onError: (err) =>
          setTestOutcome({
            targetId: target.id,
            ok: false,
            error: err instanceof Error ? err.message : undefined,
          }),
      },
    )
  }

  return (
    <View style={{ gap: SPACING.xl }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setEditor({ mode: 'pick-kind' })}
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: SPACING.sm,
          paddingVertical: SPACING.lg,
          borderRadius: RADIUS.lg,
          backgroundColor: colors.primary,
        }}
      >
        <Plus size={18} color={colors.primaryForeground} />
        <Text style={{ color: colors.primaryForeground, fontSize: 15, fontWeight: '600' }}>
          {t('v2.nc.targets.add')}
        </Text>
      </Pressable>

      {targetsQuery.isLoading ? (
        <View style={{ paddingVertical: SPACING['3xl'], alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.foregroundSubtle} />
        </View>
      ) : targetsQuery.isError ? (
        <ErrorState fill={false} title={t('v2.nc.targets.loadError')} onRetry={() => { void targetsQuery.refetch() }} />
      ) : targets.length === 0 ? (
        <EmptyState fill={false} icon={Bell} title={t('v2.nc.targets.empty')} />
      ) : (
        targets.map((target) => {
          const kind = kindByKey.get(target.kind)
          const outcome = testOutcome?.targetId === target.id ? testOutcome : null
          const testing = testTarget.isPending && testTarget.variables?.targetId === target.id
          return (
            <Section key={target.id}>
              <ToggleRow
                label={target.name}
                description={kind?.label ?? target.kind}
                value={target.enabled}
                onValueChange={(next) => setEnabled.mutate({ targetId: target.id, enabled: next })}
              />
              <Row
                icon={Send}
                label={testing ? t('v2.nc.targets.testing') : t('v2.nc.targets.test')}
                onPress={() => runTest(target)}
                right={
                  outcome ? (
                    <Text
                      style={{
                        color: outcome.ok ? colors.success : colors.danger,
                        fontSize: 13,
                        fontWeight: '600',
                        maxWidth: '55%',
                      }}
                      numberOfLines={1}
                    >
                      {outcome.ok
                        ? t('v2.nc.targets.testOk')
                        : (outcome.error ?? t('v2.nc.targets.testFail'))}
                    </Text>
                  ) : undefined
                }
              />
              <Row
                icon={Pencil}
                label={t('v2.nc.targets.edit')}
                onPress={
                  kind ? () => setEditor({ mode: 'form', kind, target }) : undefined
                }
                value={kind ? undefined : t('v2.nc.targets.kindUnavailable')}
              />
              <Row
                icon={Trash2}
                label={t('v2.nc.targets.delete')}
                danger
                onPress={() => confirmDelete(target)}
                last
              />
            </Section>
          )
        })
      )}
    </View>
  )
}

// ── kind picker ──────────────────────────────────────────────────────────────

interface KindPickerProps {
  readonly kinds: readonly TargetKind[]
  readonly loading: boolean
  readonly onPick: (kind: TargetKind) => void
  readonly onCancel: () => void
}

function KindPicker({ kinds, loading, onPick, onCancel }: KindPickerProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={{ gap: SPACING.xl }}>
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '600' }}>
        {t('v2.nc.targets.pickKind')}
      </Text>

      {loading ? (
        <View style={{ paddingVertical: SPACING['3xl'], alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.foregroundSubtle} />
        </View>
      ) : kinds.length === 0 ? (
        <EmptyState fill={false} icon={Bell} title={t('v2.nc.targets.noKinds')} />
      ) : (
        <Section>
          {kinds.map((kind, index) => (
            <Row
              key={`${kind.addonId}:${kind.kind}`}
              label={kind.label}
              onPress={() => onPick(kind)}
              right={<NotifierIcon kind={kind} size={24} />}
              last={index === kinds.length - 1}
            />
          ))}
        </Section>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        style={{
          alignItems: 'center',
          paddingVertical: SPACING.lg,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>
          {t('v2.nc.targets.cancel')}
        </Text>
      </Pressable>
    </View>
  )
}

