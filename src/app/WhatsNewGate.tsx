/**
 * WhatsNewGate — what changed, said ONCE.
 *
 * Two announcements, each once and each with an escape:
 *  - the notes of the version that just started (`whats-new.ts`), the first
 *    time this version runs — Settings → Info shows them again on demand;
 *  - a newer NATIVE build the hub publishes (`native-release.ts`), the first
 *    time this build number is seen, with the store as the confirm.
 *
 * Both persist what they announced (AsyncStorage), so a reload never repeats
 * them, and both wait a moment after mount: a dialog over the boot sequence
 * is a dialog nobody reads.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, Platform } from 'react-native'
import { useNativeRelease } from '../data/use-native-release.js'
import { log } from '../lib/logger.js'
import { useConfirm } from '../components/ui/confirm.js'
import { nativeReleaseState, storeUrlFor } from './native-release.js'
import { runningBuildNumber } from './running-bundle.js'
import { shouldShowWhatsNew, whatsNewHistory, type WhatsNewEntry } from './whats-new.js'
import { WhatsNewModal } from './WhatsNewModal.js'

const SEEN_VERSION_KEY = 'camstack.v2.whats-new.seen'
const PROMPTED_BUILD_KEY = 'camstack.v2.native-release.prompted'
/** Let the first screen paint before a dialog asks for attention. */
const ANNOUNCE_DELAY_MS = 2_500

export function WhatsNewGate() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { data: latest } = useNativeRelease()
  const announcedRef = useRef(false)
  // The notes now open a PANEL, not a one-button notice: the running build is
  // the subject and every earlier one is reachable underneath it. Held here so
  // the same component serves the launch announcement and Settings → Info.
  const [notes, setNotes] = useState<{
    readonly latest: WhatsNewEntry | null
    readonly past: readonly WhatsNewEntry[]
  } | null>(null)

  // The version's notes, once.
  useEffect(() => {
    const version = Constants.expoConfig?.version ?? null
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const seen = await AsyncStorage.getItem(SEEN_VERSION_KEY)
          if (cancelled || !shouldShowWhatsNew(seen, version)) return
          const history = whatsNewHistory(version)
          if (history.latest === null || version === null) return
          await AsyncStorage.setItem(SEEN_VERSION_KEY, version)
          setNotes(whatsNewHistory(version))
        } catch (err) {
          log.debug('app', "what's new could not be shown", { error: err instanceof Error ? err.message : String(err) })
        }
      })()
    }, ANNOUNCE_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  // A newer native build, once per build number.
  useEffect(() => {
    if (!latest || announcedRef.current) return
    const running = { version: Constants.expoConfig?.version, buildNumber: runningBuildNumber() }
    if (nativeReleaseState(running, latest) !== 'newer-available') return
    announcedRef.current = true
    void (async () => {
      try {
        const prompted = await AsyncStorage.getItem(PROMPTED_BUILD_KEY)
        if (prompted === String(latest.buildNumber)) return
        await AsyncStorage.setItem(PROMPTED_BUILD_KEY, String(latest.buildNumber))
        const url = storeUrlFor(latest, Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web', Constants.expoConfig?.ios?.bundleIdentifier ?? '')
        const open = await confirm({
          title: t('v2.updates.nativeNewerTitle'),
          message: t('v2.updates.nativeNewerBody', { version: latest.version, build: latest.buildNumber }),
          confirmLabel: latest.channel === 'testflight' ? t('v2.updates.openTestFlight') : t('v2.updates.openStore'),
          cancelLabel: t('v2.updates.later'),
        })
        if (open && url !== null) await Linking.openURL(url)
      } catch (err) {
        log.debug('app', 'native release announcement failed', { error: err instanceof Error ? err.message : String(err) })
      }
    })()
  }, [latest, confirm, t])

  return (
    <WhatsNewModal
      visible={notes !== null}
      latest={notes?.latest ?? null}
      past={notes?.past ?? []}
      onClose={() => {
        setNotes(null)
      }}
    />
  )
}
