/**
 * The app's confirmation / notice surface — one call shape, two renderings.
 *
 * ## Why this exists
 *
 * `Alert.alert` is `static alert() {}` in react-native-web 0.21: an empty
 * function body. Every confirmation in this app was therefore MUTE on the
 * browser and the PWA — no dialog opened, and the `onPress` that performs the
 * write was never called. The operator found it because assigning faces to a
 * group from a browser did nothing whatsoever; the same hole was under ~19
 * confirmations (Settings, Exports, notification Rules/Targets, Review, camera
 * management) and ~30 one-button notices, which meant a failed download or a
 * rejected import reported nothing at all on the web.
 *
 * ## The contract
 *
 * Deliberately the same one `@camstack/ui-library` exposes to the admin UI
 * (`composites/confirm-dialog.tsx`): promise-based, `Promise<boolean>`, options
 * by name. That library's PROVIDER is unusable here — it renders raw `<div>` /
 * `<button>` with Tailwind classes, which have no meaning under React Native —
 * so the contract is reused and the rendering is not.
 *
 * A call site reads the same everywhere, and the gate is structural: the write
 * lives BELOW an early return, so a refused confirmation cannot reach it.
 *
 * ```ts
 * const confirm = useConfirm()
 * if (!(await confirm({ title, message, destructive: true }))) return
 * doTheWrite()
 * ```
 *
 * ## Two renderings
 *
 * - **Native** (`Platform.OS !== 'web'`): the system alert, through
 *   `system-alert.ts`. It always worked there and there is no reason to replace
 *   a platform dialog with a drawn one.
 * - **Web**: a `Modal` rendered by this provider. `Modal` rather than an inline
 *   overlay on purpose — react-native-web portals each modal to the document,
 *   so a confirmation raised from inside another modal (`FaceReviewAnalyzeModal`
 *   is one) stacks ABOVE it instead of behind it.
 *
 * Requests are QUEUED, not replaced: the common sequence is a confirm whose
 * success handler raises a notice, and on the web both can be in flight within
 * the same tick. Dropping one would put back exactly the silence this removes.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
// ui-check-ok: the kit dialog provider owns its Modal, like SheetModal (pre-existing)
import {
  InputAccessoryView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { KeyboardInsetView } from './KeyboardInset.js'
import { presetSelected, togglePreset } from './prompt-presets.js'
import { systemConfirm, systemNotice } from './system-alert.js'

/** Ties the multiline field to its UIKit keyboard bar (iOS only). */
const KEYBOARD_ACCESSORY_ID = 'camstack-prompt-keyboard'

export interface ConfirmOptions {
  readonly title: string
  readonly message?: string
  /** Defaults to `v2.common.confirm`. */
  readonly confirmLabel?: string
  /** Defaults to `v2.common.cancel`. */
  readonly cancelLabel?: string
  /** Red on the web, `destructive` on iOS. Deletions and resets. */
  readonly destructive?: boolean
}

export interface NoticeOptions {
  readonly title: string
  readonly message?: string
  /** Defaults to `v2.common.ok`. */
  readonly dismissLabel?: string
}

export interface PromptOptions {
  readonly title: string
  readonly message?: string
  readonly placeholder?: string
  /** Pre-fills the field — an operator editing an existing note sees it. */
  readonly initialValue?: string
  /** Defaults to `v2.common.confirm`. */
  readonly submitLabel?: string
  /** Defaults to `v2.common.cancel`. */
  readonly cancelLabel?: string
  /** Renders a taller, multi-line field. */
  readonly multiline?: boolean
  /**
   * Canned phrases offered as checkboxes above the field. Ticking one INSERTS
   * it into the text (see `prompt-presets.ts`) — the answer is still one
   * string, so a call site that ignores presets is unaffected and nothing new
   * travels to the server.
   */
  readonly presets?: readonly PromptPreset[]
}

/** One preset checkbox. `phrase` is what lands in the text — already
 *  translated by the caller, because the caller owns the copy. */
export interface PromptPreset {
  readonly id: string
  readonly phrase: string
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>
/** Resolves the typed text, or `null` when the operator cancelled. An empty
 *  string is a real answer ("I deliberately left it blank") and is NOT null. */
export type PromptFn = (options: PromptOptions) => Promise<string | null>
/** Fire-and-forget: a notice has nothing to answer. */
export type NoticeFn = (options: NoticeOptions) => void

interface ConfirmContextValue {
  readonly confirm: ConfirmFn
  readonly notice: NoticeFn
  readonly prompt: PromptFn
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

/**
 * Throws without a provider, on purpose. A silent fallback would recreate the
 * defect this module exists to remove: a confirmation that answers nothing and
 * a write that never runs.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (ctx === null) throw new Error('useConfirm must be used inside a ConfirmProvider')
  return ctx.confirm
}

export function useNotice(): NoticeFn {
  const ctx = useContext(ConfirmContext)
  if (ctx === null) throw new Error('useNotice must be used inside a ConfirmProvider')
  return ctx.notice
}

export function usePrompt(): PromptFn {
  const ctx = useContext(ConfirmContext)
  if (ctx === null) throw new Error('usePrompt must be used inside a ConfirmProvider')
  return ctx.prompt
}

interface ConfirmRequest {
  readonly kind: 'confirm'
  readonly title: string
  readonly message?: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly destructive: boolean
  readonly resolve: (value: boolean) => void
}

interface NoticeRequest {
  readonly kind: 'notice'
  readonly title: string
  readonly message?: string
  readonly dismissLabel: string
}

interface PromptRequest {
  readonly kind: 'prompt'
  readonly title: string
  readonly message?: string
  readonly placeholder?: string
  readonly initialValue: string
  readonly submitLabel: string
  readonly cancelLabel: string
  readonly multiline: boolean
  readonly presets: readonly PromptPreset[]
  readonly resolve: (value: string | null) => void
}

type DialogRequest = ConfirmRequest | NoticeRequest | PromptRequest

export function ConfirmProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [queue, setQueue] = useState<readonly DialogRequest[]>([])

  const enqueue = useCallback((request: DialogRequest): void => {
    setQueue((current) => [...current, request])
  }, [])

  const confirm = useCallback<ConfirmFn>(
    (options) => {
      const confirmLabel = options.confirmLabel ?? t('v2.common.confirm')
      const cancelLabel = options.cancelLabel ?? t('v2.common.cancel')
      const destructive = options.destructive ?? false
      if (Platform.OS !== 'web') {
        return systemConfirm({
          title: options.title,
          message: options.message,
          confirmLabel,
          cancelLabel,
          destructive,
        })
      }
      return new Promise<boolean>((resolve) => {
        enqueue({
          kind: 'confirm',
          title: options.title,
          message: options.message,
          confirmLabel,
          cancelLabel,
          destructive,
          resolve,
        })
      })
    },
    [enqueue, t],
  )

  const notice = useCallback<NoticeFn>(
    (options) => {
      const dismissLabel = options.dismissLabel ?? t('v2.common.ok')
      if (Platform.OS !== 'web') {
        systemNotice({ title: options.title, message: options.message, dismissLabel })
        return
      }
      enqueue({
        kind: 'notice',
        title: options.title,
        message: options.message,
        dismissLabel,
      })
    },
    [enqueue, t],
  )

  /**
   * Always rendered IN-APP, on every platform — unlike `confirm`/`notice`,
   * which hand off to the OS on native. `Alert.prompt` exists on iOS only, so
   * a system hand-off would leave Android and the web with no way to type at
   * all: the same silence this module was written to remove.
   */
  const prompt = useCallback<PromptFn>(
    (options) =>
      new Promise<string | null>((resolve) => {
        enqueue({
          kind: 'prompt',
          title: options.title,
          message: options.message,
          placeholder: options.placeholder,
          initialValue: options.initialValue ?? '',
          submitLabel: options.submitLabel ?? t('v2.common.confirm'),
          cancelLabel: options.cancelLabel ?? t('v2.common.cancel'),
          multiline: options.multiline ?? false,
          presets: options.presets ?? [],
          resolve,
        })
      }),
    [enqueue, t],
  )

  const value = useMemo<ConfirmContextValue>(
    () => ({ confirm, notice, prompt }),
    [confirm, notice, prompt],
  )

  const head = queue[0]
  const [draft, setDraft] = useState<string>('')
  // Whether the software keyboard is up. Drives the backdrop's two meanings
  // and the "Done" affordance over a multiline field, which has no return key
  // of its own to close with.
  const [keyboardUp, setKeyboardUp] = useState<boolean>(false)
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardUp(true)
    })
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardUp(false)
    })
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])

  // Seed the field when a prompt reaches the head of the queue — including the
  // second of two queued prompts, which would otherwise inherit the first's text.
  const headKey = head === undefined ? null : `${head.kind}:${head.title}`
  const seededFor = React.useRef<string | null>(null)
  if (headKey !== seededFor.current) {
    seededFor.current = headKey
    if (head !== undefined && head.kind === 'prompt') setDraft(head.initialValue)
  }

  const settle = useCallback(
    (request: DialogRequest, accepted: boolean, text?: string): void => {
      if (request.kind === 'confirm') request.resolve(accepted)
      if (request.kind === 'prompt') request.resolve(accepted ? (text ?? '') : null)
      setQueue((current) => current.slice(1))
    },
    [],
  )

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {head !== undefined ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => settle(head, false)}
        >
          <KeyboardInsetView
            style={styles.backdrop}
            // The dialog's buttons sit BELOW its text field, so with a keyboard
            // up they were behind it — and on a multiline field there is no
            // return key to close it with. The operator could neither confirm
            // nor cancel: "non c'è modo di premere ok, la tastiera non scende
            // in nessun caso" (2026-09-08). Padded by the measured overlap, on
            // iOS and Android alike (a Modal's window is not resized for it).
          >
            {/* Tapping outside dismisses the KEYBOARD while it is up, and only
                then refuses the dialog. One tap that both closed the keyboard
                and threw the note away would be the same trap from the other
                side. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel={head.kind === 'notice' ? head.dismissLabel : head.cancelLabel}
              onPress={() => {
                if (keyboardUp) {
                  Keyboard.dismiss()
                  return
                }
                settle(head, false)
              }}
            />
            <View
              accessibilityRole="alert"
              style={[
                styles.card,
                { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.title, { color: colors.foreground }]}>{head.title}</Text>
              {head.message !== undefined && head.message.length > 0 ? (
                <Text style={[styles.message, { color: colors.foregroundMuted }]}>
                  {head.message}
                </Text>
              ) : null}
              {head.kind === 'prompt' && head.presets.length > 0 ? (
                <View style={styles.presets}>
                  {head.presets.map((preset) => {
                    const on = presetSelected(draft, preset.phrase)
                    return (
                      <Pressable
                        key={preset.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={preset.phrase}
                        onPress={() => {
                          setDraft((current) => togglePreset(current, preset.phrase, !on))
                        }}
                        style={[
                          styles.preset,
                          {
                            borderColor: on ? colors.primary : colors.border,
                            backgroundColor: on ? `${colors.primary}22` : 'transparent',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.presetLabel,
                            { color: on ? colors.primary : colors.foregroundMuted },
                          ]}
                        >
                          {preset.phrase}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}
              {head.kind === 'prompt' ? (
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={head.placeholder}
                  placeholderTextColor={colors.foregroundMuted}
                  multiline={head.multiline}
                  inputAccessoryViewID={
                    Platform.OS === 'ios' && head.multiline ? KEYBOARD_ACCESSORY_ID : undefined
                  }
                  autoFocus
                  accessibilityLabel={head.title}
                  onSubmitEditing={() => {
                    if (!head.multiline) settle(head, true, draft)
                  }}
                  style={[
                    styles.input,
                    head.multiline ? styles.inputMultiline : null,
                    { color: colors.foreground, borderColor: colors.border },
                  ]}
                />
              ) : null}
              <View style={styles.actions}>
                {head.kind !== 'notice' ? (
                  <Pressable
                    accessibilityRole="button"
                    style={[styles.button, { borderColor: colors.border }]}
                    onPress={() => settle(head, false)}
                  >
                    <Text style={[styles.buttonLabel, { color: colors.foregroundMuted }]}>
                      {head.cancelLabel}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.button,
                    styles.buttonPrimary,
                    {
                      backgroundColor:
                        head.kind === 'confirm' && head.destructive ? colors.danger : colors.primary,
                    },
                  ]}
                  onPress={() => settle(head, true, draft)}
                >
                  <Text style={[styles.buttonLabel, styles.buttonPrimaryLabel]}>
                    {head.kind === 'confirm'
                      ? head.confirmLabel
                      : head.kind === 'prompt'
                        ? head.submitLabel
                        : head.dismissLabel}
                  </Text>
                </Pressable>
              </View>
            </View>
            {/* A multiline field has no return key of its own, so iOS gets the
                native affordance for this: a bar docked to the keyboard, drawn
                by UIKit above it rather than a button competing for room
                inside the card. Android's system back key already closes the
                keyboard, so it needs nothing. */}
            {Platform.OS === 'ios' && head.kind === 'prompt' && head.multiline ? (
              <InputAccessoryView nativeID={KEYBOARD_ACCESSORY_ID}>
                <View style={[styles.accessoryBar, { backgroundColor: colors.surface }]}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      Keyboard.dismiss()
                    }}
                    style={styles.accessoryButton}
                  >
                    <Text style={[styles.accessoryLabel, { color: colors.primary }]}>
                      {t('v2.common.done')}
                    </Text>
                  </Pressable>
                </View>
              </InputAccessoryView>
            ) : null}
          </KeyboardInsetView>
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // ui-check-ok: modal scrim; no scrim token in tokens.ts yet (pre-existing)
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: SPACING.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  title: { fontSize: 16, fontWeight: '600' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: 14,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  accessoryBar: { alignItems: 'flex-end', paddingHorizontal: SPACING.md, paddingVertical: 6 },
  accessoryButton: { paddingVertical: 4, paddingHorizontal: 8 },
  accessoryLabel: { fontSize: 15, fontWeight: '600' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  preset: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  presetLabel: { fontSize: 12 },
  message: { fontSize: 14, lineHeight: 20 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  button: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  buttonPrimary: { borderColor: 'transparent' },
  buttonLabel: { fontSize: 14, fontWeight: '600' },
  // ui-check-ok: label over primary AND danger fills; no on-danger token (pre-existing)
  buttonPrimaryLabel: { color: '#ffffff' },
})
