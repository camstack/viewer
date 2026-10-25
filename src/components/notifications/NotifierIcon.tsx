/**
 * NotifierIcon — renders a notifier kind's real brand icon (served by the
 * notifiers addon at `/addon/notifiers/icons/<kind>`) instead of its raw icon
 * NAME as text.
 *
 * TWO RENDERERS, ON PURPOSE
 * ─────────────────────────
 * `expo-image` does NOT decode SVG on iOS/Android. Seven of the eight bundled
 * brand icons are `image/svg+xml` (only zentik ships as a raster PNG), so this
 * component used to hand every vector icon to expo-image, hit `onError`, and
 * fall back to the neutral bell — on mobile only, because a browser decodes SVG
 * natively and the web build therefore looked correct. That is the whole bug.
 *
 * The renderer is chosen from `kind.iconMediaType`, which the server stamps
 * beside `iconUrl`: the route path carries no file extension, so the type
 * cannot be inferred from the URL, and guessing from the kind name would encode
 * the addon's asset choices in the client. An ABSENT media type is treated as
 * raster — the safe default for an unknown image, and what a legacy server that
 * does not stamp the field still gets.
 *
 * Falls back to a neutral {@link Bell} glyph when the kind bundles no icon, the
 * hub base is unknown, or the image fails to load — so a picker row is never
 * blank.
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { Image } from 'expo-image'
import { SvgUri } from 'react-native-svg'
import { Bell } from '../../lib/icons.js'
import { useConnection } from '../../connection/ConnectionProvider.js'
import { useServer } from '../../app/ServerProvider.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS } from '../../theme/tokens.js'
import { buildNotifierIconUrl, isSvgMediaType } from './notifier-icon.js'
import type { TargetKind } from '../../data/notification-center.js'

export interface NotifierIconProps {
  readonly kind: TargetKind
  /** Square edge in px. */
  readonly size?: number
}

export function NotifierIcon({ kind, size = 24 }: NotifierIconProps) {
  const { controller } = useConnection()
  const { token } = useServer()
  const { colors } = useTheme()
  const [failed, setFailed] = useState(false)

  const serverUrl = controller.getSystem()?.serverUrl ?? null
  const uri = buildNotifierIconUrl(serverUrl, kind.iconUrl)
  const headers: Record<string, string> | undefined =
    token && uri ? { Authorization: `Bearer ${token}` } : undefined

  if (uri === null || failed) {
    return <Bell size={size} color={colors.foregroundSubtle} />
  }

  const isSvg = isSvgMediaType(kind.iconMediaType)

  return (
    <View style={{ width: size, height: size, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
      {isSvg ? (
        <SvgUri
          uri={uri}
          width={size}
          height={size}
          onError={() => setFailed(true)}
          // The route is `public`, so the header is not required; it is sent
          // for consistency with every other authenticated-image path here.
          {...(headers ? { headers } : {})}
        />
      ) : (
        <Image
          source={headers ? { uri, headers } : { uri }}
          style={{ width: size, height: size }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={100}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  )
}
