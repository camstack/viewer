/**
 * The ONE place `Alert.alert` is allowed to be called.
 *
 * On a phone the system alert is the right surface and always worked; nothing
 * here replaces it. What this module adds is the promise shape the rest of the
 * app talks in (`confirm.tsx`), so a call site reads the same on every
 * platform: `if (!(await confirm(...))) return`.
 *
 * On the web `Alert.alert` is `static alert() {}` — react-native-web 0.21 ships
 * an empty body — which is why `confirm.tsx` never routes here on that
 * platform. `no-system-alert.spec.ts` is the guard that keeps every other
 * module out of this import.
 */
import { Alert } from 'react-native'

export interface SystemConfirmSpec {
  readonly title: string
  readonly message?: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly destructive: boolean
}

export interface SystemNoticeSpec {
  readonly title: string
  readonly message?: string
  readonly dismissLabel: string
}

/**
 * A two-button system alert as a promise.
 *
 * Settles FALSE on the cancel button and on an Android back-dismiss
 * (`onDismiss`, which is Android-only — an iOS alert with buttons cannot be
 * dismissed any other way). `settled` guards against a platform that fires both
 * a button and the dismiss callback: a second `resolve` is a silent no-op in
 * JS, but a second run of the caller's write would not be.
 */
export function systemConfirm(spec: SystemConfirmSpec): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    Alert.alert(
      spec.title,
      spec.message,
      [
        { text: spec.cancelLabel, style: 'cancel', onPress: () => settle(false) },
        {
          text: spec.confirmLabel,
          style: spec.destructive ? 'destructive' : 'default',
          onPress: () => settle(true),
        },
      ],
      { cancelable: true, onDismiss: () => settle(false) },
    )
  })
}

/** A one-button system alert: informative, nothing to refuse. */
export function systemNotice(spec: SystemNoticeSpec): void {
  Alert.alert(spec.title, spec.message, [{ text: spec.dismissLabel }])
}
